// Seçim işlemleri: bloklar-arası toplu silme + markdown olarak kopyalama.
// DOM + seçim mantığı buradadır; doküman durumu deps üzerinden akar.
import type { Block } from "../shared/md-pipeline";
import { joinKeptLines, listItemLineSpans } from "../shared/md-utils";

export interface SelectionDeps {
  getMode(): string;
  getEditingIndex(): number | null;
  setEditingIndex(i: number | null): void;
  getBlocks(): Block[];
  liveRoot: HTMLElement;
  getText(): string;
  applyDeleteResult(text: string): void;
  commit(): void;
  render(): void;
  record(force?: boolean): void;
}

export function attachSelectionHandlers(deps: SelectionDeps): void {
  // ---------- Canlı modda bloklar-arası toplu silme ----------
  // Not: document seviyesinde dinlenir — sürükle-seç sonrası odak body'de olur,
  // liveRoot'a bağlı olsaydı tuş olayı hiç ulaşmazdı
  document.addEventListener("keydown", (e) => {
    if (deps.getMode() !== "live") {
      return; // okuma salt okunur, split'te kaynak panelden silinir
    }
    if (e.key !== "Delete" && e.key !== "Backspace") {
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      return;
    }
    // Aralığı dondur: aşağıdaki blur() bazı ortamlarda canlı seçimi sıfırlar,
    // klonlanmış aralık düğümlere tutunmaya devam eder.
    const range = sel.getRangeAt(0).cloneRange();
    const anchorNode = range.startContainer;
    const focusNode = range.endContainer;
    // Seçim bir girdi alanındaysa native davranışa bırak (textarea, bulma kutusu,
    // CM arama kutusu). Açık edit kutusu dahil: içerideki seçim oraya aittir.
    const inField = (n: Node | null): boolean => {
      const el = (n as HTMLElement)?.parentElement;
      return !!el?.closest?.("input, textarea, [contenteditable='true'], #cm-host");
    };
    if (inField(anchorNode) || inField(focusNode)) {
      return;
    }
    // Odak yabancı bir girdideyse (örn. seçim önizlemede, odak bulma kutusunda)
    // önce odağı boşa al; yoksa native silme de çalışıp çift işlem olur.
    // Açık edit kutusu hariç: o aşağıda commit ile kapanır.
    const ae = document.activeElement as HTMLElement | null;
    if (
      ae &&
      ae !== document.body &&
      !(ae instanceof HTMLTextAreaElement && ae.closest?.("div.block.editing")) &&
      (ae.tagName === "INPUT" || ae.tagName === "BUTTON" || ae.isContentEditable)
    ) {
      ae.blur();
    }
    const liveRoot = deps.liveRoot;
    const blocks = deps.getBlocks();
    if (!liveRoot.contains(anchorNode) || !liveRoot.contains(focusNode)) {
      return;
    }
    const contained = (el: HTMLElement): boolean => {
      try {
        const r2 = document.createRange();
        r2.selectNodeContents(el);
        return (
          range.compareBoundaryPoints(Range.START_TO_START, r2) <= 0 &&
          range.compareBoundaryPoints(Range.END_TO_END, r2) >= 0
        );
      } catch {
        return false;
      }
    };
    const blockDivOf = (n: Node | null): { div: HTMLElement; idx: number } | null => {
      const el = (n as HTMLElement)?.parentElement;
      const host = el?.closest?.("div.block[data-index]:not(.editing)") as HTMLElement | null;
      if (!host) {
        return null;
      }
      const idx = Number(host.dataset.index);
      if (Number.isNaN(idx) || !blocks[idx]) {
        return null;
      }
      return { div: host, idx };
    };
    const victims: number[] = [];
    liveRoot.querySelectorAll("div.block:not(.editing)").forEach((node) => {
      const div = node as HTMLElement;
      const idx = Number(div.dataset.index);
      if (Number.isNaN(idx) || !blocks[idx]) {
        return;
      }
      if (contained(div)) {
        victims.push(idx);
      }
    });
    const victimSet = new Set(victims);
    // Kenar bloklarda kısmi seçim: liste öğeleri (<li>) satır satır eşlenir.
    // Böylece "orta + komşu öğeler" gibi seçimlerde liste içi silinir.
    const edgeSpans: Array<[number, number]> = [];
    const mapEdgeLis = (info: { div: HTMLElement; idx: number } | null) => {
      if (!info || victimSet.has(info.idx)) {
        return;
      }
      const b = blocks[info.idx];
      const srcLines = b.source.split("\n");
      if (!srcLines.some((l) => /^\s*(?:[-*+]|\d+[.)])(?:\s|$)/.test(l))) {
        return; // liste bloğu değil
      }
      const items = listItemLineSpans(srcLines);
      const allLi = Array.from(info.div.querySelectorAll("li"));
      if (allLi.length !== items.length) {
        return; // yapı uyuşmazsa güvenli tarafta kal
      }
      allLi.forEach((liNode, k) => {
        if (contained(liNode as HTMLElement)) {
          const [s, en] = items[k];
          edgeSpans.push([b.startLine + s, b.startLine + en]);
        }
      });
    };
    mapEdgeLis(blockDivOf(anchorNode));
    mapEdgeLis(blockDivOf(focusNode));
    if (victims.length === 0 && edgeSpans.length === 0) {
      // Kısmi seçim: çapa bloğu düzenlemeye aç (ikinci Delete içeride çalışır)
      const info = blockDivOf(anchorNode);
      if (info && deps.getEditingIndex() !== info.idx) {
        e.preventDefault();
        if (deps.getEditingIndex() !== null) {
          deps.commit();
        }
        deps.setEditingIndex(info.idx);
        deps.render();
        // Bayat seçimi temizle: düğümler yıkıldı, ikinci Delete TA içinde çalışsın
        sel.removeAllRanges();
      }
      return;
    }
    e.preventDefault();
    // Seçim varken açık edit varsa önce kapat (metin zaten senkron, harita tazelenir)
    if (deps.getEditingIndex() !== null) {
      deps.commit();
    }
    deps.record(true);
    const spans: Array<[number, number]> = victims
      .map((i) => blocks[i])
      .filter((b) => !!b)
      .map((b) => [b.startLine, b.endLine] as [number, number])
      .concat(edgeSpans);
    const lines = deps.getText().split("\n");
    const removed = new Array<boolean>(lines.length).fill(false);
    for (const [s, en] of spans) {
      for (let i = Math.max(0, s); i < Math.min(en, lines.length); i++) {
        removed[i] = true;
      }
    }
    deps.applyDeleteResult(joinKeptLines(lines, removed));
    sel.removeAllRanges();
    deps.render();
  });

  // ---------- Markdown olarak kopyalama (canlı önizleme) ----------
  document.addEventListener("copy", (e) => {
    // Açık edit kutusu varsa native kopya zaten markdown'dır
    if (deps.getEditingIndex() !== null) {
      return;
    }
    if (deps.getMode() !== "live") {
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      return;
    }
    const ae = document.activeElement as HTMLElement | null;
    if (
      ae &&
      (ae.tagName === "INPUT" ||
        ae.tagName === "TEXTAREA" ||
        (ae.closest && ae.closest("#cm-host")))
    ) {
      return;
    }
    const liveRoot = deps.liveRoot;
    const blocks = deps.getBlocks();
    if (!liveRoot.contains(sel.anchorNode) || !liveRoot.contains(sel.focusNode)) {
      return;
    }
    const range = sel.getRangeAt(0);
    const victims: number[] = [];
    liveRoot.querySelectorAll("div.block:not(.editing)").forEach((node) => {
      const div = node as HTMLElement;
      const idx = Number(div.dataset.index);
      if (Number.isNaN(idx) || !blocks[idx]) {
        return;
      }
      try {
        const r2 = document.createRange();
        r2.selectNodeContents(div);
        if (
          range.compareBoundaryPoints(Range.START_TO_START, r2) <= 0 &&
          range.compareBoundaryPoints(Range.END_TO_END, r2) >= 0
        ) {
          victims.push(idx);
        }
      } catch {
        /* yoksay */
      }
    });
    if (victims.length === 0) {
      // Tek blok tam metin seçimi mi? (örn. başlığa üç kez tıklandı)
      const anchorEl = sel.anchorNode?.parentElement;
      const host = anchorEl?.closest?.("div.block[data-index]:not(.editing)") as HTMLElement | null;
      if (host && host.contains(sel.focusNode)) {
        const idx = Number(host.dataset.index);
        const b = blocks[idx];
        const norm = (s: string) => s.replace(/\s+/g, " ").trim();
        if (b && norm(sel.toString()) === norm(host.textContent || "") && norm(host.textContent || "") !== "") {
          victims.push(idx);
        }
      }
    }
    if (victims.length === 0) {
      // Tek başlık bloğunda kısmi seçim: işaretleri onararak kopyala
      // ("Başlık"ın yarısı seçilse bile pano "# ..." olarak gider)
      const anchorEl2 = sel.anchorNode?.parentElement;
      const host2 = anchorEl2?.closest?.("div.block[data-index]:not(.editing)") as HTMLElement | null;
      if (host2 && host2.contains(sel.focusNode)) {
        const b2 = blocks[Number(host2.dataset.index)];
        const hm = b2 ? b2.source.match(/^(#{1,6}\s+)/) : null;
        const txt = sel.toString();
        if (b2 && hm && txt.trim() !== "" && e.clipboardData) {
          e.preventDefault();
          e.clipboardData.setData("text/plain", hm[0] + txt.replace(/^#+\s*/, ""));
          return;
        }
      }
    }
    if (victims.length === 0 || !e.clipboardData) {
      return;
    }
    e.preventDefault();
    const parts = victims
      .map((i) => blocks[i].source.replace(/(?:\n[ \t]*)+$/, "").trim())
      .filter((s) => s !== "");
    e.clipboardData.setData("text/plain", parts.join("\n\n").replace(/\n{3,}/g, "\n\n"));
    try {
      const tmp = document.createElement("div");
      tmp.appendChild(range.cloneContents());
      e.clipboardData.setData("text/html", tmp.innerHTML);
    } catch {
      /* html olmazsa düz metin yeter */
    }
  });
}
