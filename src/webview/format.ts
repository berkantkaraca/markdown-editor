// Biçim çubuğu: hedeflique düzenleme komutları, açılır menüler, diyaloglar.
// Düzenleyici durumu deps üzerinden akar; DOM kimlikleri bu modüle aittir.
import { EditorView } from "@codemirror/view";
import type { Block } from "../shared/md-pipeline";
import {
  togglePrefix,
  toggleTaskLine,
  toggleHeadingLine,
  setHeadingLevel,
  editTable,
  listEnterAction,
} from "../shared/md-utils";
import type { TableOp } from "../shared/md-utils";

export interface FormatDeps {
  getMode(): string;
  getEditingIndex(): number | null;
  setEditingIndex(i: number | null): void;
  getBlocks(): Block[];
  liveRoot: HTMLElement;
  getCmView(): EditorView | null;
  record(force?: boolean): void;
  replaceBlock(index: number, text: string): void;
  undoState(): { canUndo: boolean; canRedo: boolean };
  undoRedo(cmd: "undo" | "redo"): void;
}

export interface FormatApi {
  refreshBar(): void;
}

export function autoGrow(ta: HTMLTextAreaElement) {
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + 6 + "px";
}

type Target = { kind: "cm" } | { kind: "ta"; el: HTMLTextAreaElement; index: number } | null;

const TABLE_TEMPLATE = "\n| Başlık 1 | Başlık 2 |\n| --- | --- |\n|  |  |\n";

// Kaynak modda liste Enter davranışı (bulamazsa false → varsayılan Enter)
export function cmListEnter(
  view: EditorView,
  record: (force?: boolean) => void
): boolean {
  if (!view.state.selection.main.empty) {
    return false;
  }
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const act = listEnterAction(line.text);
  if (act.kind === "none") {
    return false;
  }
  record(true);
  if (act.kind === "exit") {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: "" } });
  } else if (act.kind === "outdent") {
    const m = line.text.match(/^(\t| {1,2})/);
    if (m) {
      view.dispatch({ changes: { from: line.from, to: line.from + m[0].length, insert: "" } });
    } else {
      view.dispatch({ changes: { from: line.from, to: line.to, insert: "" } });
    }
  } else {
    const at = head - line.from;
    const marker = act.marker ?? "";
    view.dispatch({
      changes: {
        from: line.from,
        to: line.to,
        insert: line.text.slice(0, at) + "\n" + marker + line.text.slice(at),
      },
      selection: { anchor: line.from + at + 1 + marker.length },
    });
  }
  view.focus();
  return true;
}

// ---------- Açılır menü (H seviyeleri, tablo işlemleri) ----------
let openMenuEl: HTMLElement | null = null;

// Menü/diyalog açık mı? (odak koruma kontrolleri için)
export function isMenuOpen(): boolean {
  return openMenuEl !== null || openDialogEl !== null;
}

function closeMenu() {
  openMenuEl?.remove();
  openMenuEl = null;
  document.removeEventListener("mousedown", menuOutside, true);
  // NOT: burada commit YOK. İşlem (it.run) kapatmadan önce çalışır ve odağı
  // editöre döndürür; menü dışı tıklamada blur zaten commit'i tetikler.
}

function menuOutside(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (
    openMenuEl &&
    !(t?.closest?.(".kmenu") || t?.closest?.("[data-cmd$='-menu']") || t?.closest?.(".tablebar"))
  ) {
    closeMenu();
  }
}

export function openMenu(
  anchor: HTMLElement,
  items: Array<{ label: string; title?: string; run: () => void }>
) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "kmenu";
  menu.addEventListener("mousedown", (e) => e.preventDefault());
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  });
  for (const it of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = it.label;
    if (it.title) {
      b.title = it.title;
    }
    b.addEventListener("click", (e) => {
      e.preventDefault();
      // Önce işlem (odak ve içerik yerindeyken), sonra kapat
      it.run();
      closeMenu();
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(4, r.left)}px`;
  menu.style.top = `${r.bottom + 4}px`;
  openMenuEl = menu;
  document.addEventListener("mousedown", menuOutside, true);
  const first = menu.querySelector("button") as HTMLButtonElement | null;
  first?.focus();
}

// ---------- Popover diyalog (bağlantı / görsel) ----------
let openDialogEl: HTMLElement | null = null;

function closeDialog() {
  openDialogEl?.remove();
  openDialogEl = null;
  document.removeEventListener("mousedown", dialogOutside, true);
}

function dialogOutside(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (openDialogEl && !(t?.closest?.(".kdialog") || t?.closest?.("[data-cmd='link'],[data-cmd='image']"))) {
    closeDialog();
  }
}

interface DialogField {
  key: string;
  label: string;
  value: string;
}

function openDialog(
  opts: {
    title: string;
    fields: DialogField[];
    okLabel: string;
    focusSecond?: boolean;
    onOk: (vals: Record<string, string>) => void;
  },
  target: Target,
  cmView: EditorView | null
) {
  closeMenu();
  closeDialog();
  // Hedef + seçim dondurulur (odak diyaloğa geçecek)
  let cmSel: { anchor: number; head: number } | null = null;
  let taCtx: { el: HTMLTextAreaElement; index: number; s: number; e: number } | null = null;
  if (target?.kind === "cm" && cmView) {
    const r = cmView.state.selection.main;
    cmSel = { anchor: r.anchor, head: r.head };
  } else if (target?.kind === "ta") {
    taCtx = {
      el: target.el,
      index: target.index,
      s: target.el.selectionStart ?? 0,
      e: target.el.selectionEnd ?? 0,
    };
  } else {
    return;
  }
  const box = document.createElement("div");
  box.className = "kdialog";
  const title = document.createElement("div");
  title.className = "kdialog-title";
  title.textContent = opts.title;
  box.appendChild(title);
  const inputs: Record<string, HTMLInputElement> = {};
  for (const f of opts.fields) {
    const label = document.createElement("label");
    label.textContent = f.label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = f.value;
    inputs[f.key] = input;
    label.appendChild(input);
    box.appendChild(label);
  }
  const row = document.createElement("div");
  row.className = "kdialog-row";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Vazgeç";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.textContent = opts.okLabel;
  ok.className = "primary";
  row.appendChild(cancel);
  row.appendChild(ok);
  box.appendChild(row);
  const done = (commit: boolean) => {
    const vals: Record<string, string> = {};
    for (const k of Object.keys(inputs)) {
      vals[k] = inputs[k].value;
    }
    closeDialog();
    if (!commit) {
      return;
    }
    // Seçimi geri kur, sonra ekle
    if (cmSel && cmView) {
      cmView.dispatch({
        selection: {
          anchor: Math.min(cmSel.anchor, cmView.state.doc.length),
          head: Math.min(cmSel.head, cmView.state.doc.length),
        },
      });
      cmView.focus();
    } else if (taCtx && taCtx.el.isConnected) {
      taCtx.el.focus();
      taCtx.el.selectionStart = Math.min(taCtx.s, taCtx.el.value.length);
      taCtx.el.selectionEnd = Math.min(taCtx.e, taCtx.el.value.length);
    } else {
      return;
    }
    opts.onOk(vals);
  };
  cancel.addEventListener("click", (e) => {
    e.preventDefault();
    done(false);
  });
  ok.addEventListener("click", (e) => {
    e.preventDefault();
    done(true);
  });
  box.addEventListener("mousedown", (e) => e.preventDefault());
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      done(false);
    } else if (e.key === "Enter" && (e.target as HTMLElement)?.tagName === "INPUT") {
      e.preventDefault();
      done(true);
    }
    // NOT: stopPropagation yok — document dinleyicileri çalışmaya devam etmeli.
  });
  document.body.appendChild(box);
  openDialogEl = box;
  document.addEventListener("mousedown", dialogOutside, true);
  const fields = Object.values(inputs);
  const focusEl = opts.focusSecond && fields.length > 1 ? fields[1] : fields[0];
  focusEl?.focus();
  focusEl?.select();
}

export function attachFormatbar(deps: FormatDeps): FormatApi {
  const formatbar = document.getElementById("formatbar")!;
  const fmtButtons = Array.from(
    formatbar.querySelectorAll("button[data-cmd]")
  ) as HTMLButtonElement[];

  function getTarget(): Target {
    if ((deps.getMode() === "source" || deps.getMode() === "split") && deps.getCmView()) {
      return { kind: "cm" };
    }
    if (deps.getMode() === "live" && deps.getEditingIndex() !== null) {
      const ta = deps.liveRoot.querySelector(
        "div.block.editing textarea"
      ) as HTMLTextAreaElement | null;
      if (ta) {
        return { kind: "ta", el: ta, index: deps.getEditingIndex() as number };
      }
    }
    return null;
  }

  function cmWrap(before: string, after: string, placeholder: string) {
    const cmView = deps.getCmView();
    if (!cmView) {
      return;
    }
    const r = cmView.state.selection.main;
    const sel = cmView.state.doc.sliceString(r.from, r.to) || placeholder;
    deps.record(true);
    cmView.dispatch({
      changes: { from: r.from, to: r.to, insert: before + sel + after },
      selection: { anchor: r.from + before.length, head: r.from + before.length + sel.length },
    });
    cmView.focus();
  }

  function cmEachLine(fn: (text: string) => string | null) {
    const cmView = deps.getCmView();
    if (!cmView) {
      return;
    }
    const doc = cmView.state.doc;
    const r = cmView.state.selection.main;
    const l1 = doc.lineAt(r.from).number;
    const l2 = doc.lineAt(r.to).number;
    const changes: { from: number; to: number; insert: string }[] = [];
    for (let n = l1; n <= l2; n++) {
      const line = doc.line(n);
      const nt = fn(line.text);
      if (nt !== null && nt !== line.text) {
        changes.push({ from: line.from, to: line.to, insert: nt });
      }
    }
    if (changes.length === 0) {
      cmView.focus();
      return;
    }
    deps.record(true);
    cmView.dispatch({ changes });
    cmView.focus();
  }

  function cmInsert(text: string, selAnchor?: number, selHead?: number) {
    const cmView = deps.getCmView();
    if (!cmView) {
      return;
    }
    const r = cmView.state.selection.main;
    deps.record(true);
    cmView.dispatch({
      changes: { from: r.from, to: r.to, insert: text },
      selection:
        selAnchor !== undefined
          ? { anchor: r.from + selAnchor, head: r.from + (selHead ?? selAnchor) }
          : undefined,
    });
    cmView.focus();
  }

  function taWrap(before: string, after: string, placeholder: string) {
    const t = getTarget();
    if (!t || t.kind !== "ta") {
      return;
    }
    const el = t.el;
    const s = el.selectionStart ?? 0;
    const e = el.selectionEnd ?? 0;
    const sel = el.value.slice(s, e) || placeholder;
    deps.record(true);
    el.setRangeText(before + sel + after, s, e, "end");
    el.selectionStart = s + before.length;
    el.selectionEnd = s + before.length + sel.length;
    el.focus();
    autoGrow(el);
    deps.replaceBlock(t.index, el.value);
  }

  function taEachLine(fn: (text: string) => string | null) {
    const t = getTarget();
    if (!t || t.kind !== "ta") {
      return;
    }
    const el = t.el;
    const s = el.selectionStart ?? 0;
    const e = el.selectionEnd ?? 0;
    const v = el.value;
    const ls = v.slice(0, s).split("\n").length - 1;
    const le = v.slice(0, e).split("\n").length - 1;
    const arr = v.split("\n");
    let changed = false;
    for (let i = ls; i <= le; i++) {
      const nt = fn(arr[i]);
      if (nt !== null && nt !== arr[i]) {
        arr[i] = nt;
        changed = true;
      }
    }
    if (!changed) {
      el.focus();
      return;
    }
    deps.record(true);
    el.value = arr.join("\n");
    el.focus();
    autoGrow(el);
    deps.replaceBlock(t.index, el.value);
  }

  function taInsert(text: string, selAnchor?: number, selHead?: number) {
    const t = getTarget();
    if (!t || t.kind !== "ta") {
      return;
    }
    const el = t.el;
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? s;
    deps.record(true);
    el.setRangeText(text, s, e, "end");
    if (selAnchor !== undefined) {
      el.selectionStart = s + selAnchor;
      el.selectionEnd = s + (selHead ?? selAnchor);
    }
    el.focus();
    autoGrow(el);
    deps.replaceBlock(t.index, el.value);
  }

  function selText(): string {
    const t = getTarget();
    if (!t) {
      return "";
    }
    if (t.kind === "cm") {
      const cmView = deps.getCmView();
      if (!cmView) {
        return "";
      }
      const r = cmView.state.selection.main;
      return cmView.state.doc.sliceString(r.from, r.to);
    }
    const s = t.el.selectionStart ?? 0;
    const e = t.el.selectionEnd ?? 0;
    return t.el.value.slice(s, e);
  }

  function wrapSel(before: string, after: string, ph: string) {
    const t = getTarget();
    if (!t) {
      return;
    }
    if (t.kind === "cm") {
      cmWrap(before, after, ph);
    } else {
      taWrap(before, after, ph);
    }
  }

  function eachLineSel(fn: (text: string) => string | null) {
    const t = getTarget();
    if (!t) {
      return;
    }
    if (t.kind === "cm") {
      cmEachLine(fn);
    } else {
      taEachLine(fn);
    }
  }

  function insertAtCursor(text: string, selAnchor?: number, selHead?: number) {
    const t = getTarget();
    if (!t) {
      return;
    }
    if (t.kind === "cm") {
      cmInsert(text, selAnchor, selHead);
    } else {
      taInsert(text, selAnchor, selHead);
    }
  }

  function tableOp(op: TableOp) {
    const t = getTarget();
    if (!t) {
      return;
    }
    if (t.kind === "cm") {
      const cmView = deps.getCmView();
      if (!cmView) {
        return;
      }
      const doc = cmView.state.doc;
      const cur = doc.lineAt(cmView.state.selection.main.head).number;
      let s = cur;
      let e = cur;
      const isT = (n: number) => n >= 1 && n <= doc.lines && doc.line(n).text.trim().startsWith("|");
      while (isT(s - 1)) {
        s--;
      }
      while (isT(e + 1)) {
        e++;
      }
      const src = doc.sliceString(doc.line(s).from, doc.line(e).to);
      const out = editTable(src, op);
      if (out === null) {
        return;
      }
      deps.record(true);
      cmView.dispatch({ changes: { from: doc.line(s).from, to: doc.line(e).to, insert: out } });
      cmView.focus();
      return;
    }
    const out = editTable(t.el.value, op);
    if (out === null) {
      return;
    }
    deps.record(true);
    t.el.value = out;
    t.el.focus();
    autoGrow(t.el);
    deps.replaceBlock(t.index, out);
  }

  function runFormat(cmd: string) {
    if (!getTarget()) {
      return;
    }
    switch (cmd) {
      case "bold":
        wrapSel("**", "**", "metin");
        break;
      case "italic":
        wrapSel("*", "*", "metin");
        break;
      case "strike":
        wrapSel("~~", "~~", "metin");
        break;
      case "heading-menu": {
        const btn = fmtButtons.find((x) => x.dataset.cmd === "heading-menu");
        openMenu(
          btn ?? document.body,
          [1, 2, 3, 4, 5, 6]
            .map((n) => ({
              label: `H${n}`,
              title: `Başlık ${n}`,
              run: () => eachLineSel(setHeadingLevel(n)),
            }))
            .concat([{ label: "Temizle", title: "Başlığı kaldır", run: () => eachLineSel(toggleHeadingLine) }])
        );
        break;
      }
      case "table-menu": {
        const btn = fmtButtons.find((x) => x.dataset.cmd === "table-menu");
        openMenu(btn ?? document.body, [
          { label: "Tablo Ekle", run: () => insertAtCursor(TABLE_TEMPLATE) },
          { label: "+ Satır", run: () => tableOp("add-row") },
          { label: "− Satır", run: () => tableOp("del-row") },
          { label: "+ Sütun", run: () => tableOp("add-col") },
          { label: "− Sütun", run: () => tableOp("del-col") },
        ]);
        break;
      }
      case "image": {
        const label = selText() || "açıklama";
        openDialog({
          title: "Görsel ekle",
          fields: [
            { key: "alt", label: "Açıklama", value: label },
            { key: "src", label: "Yol", value: "resim.png" },
          ],
          okLabel: "Ekle",
          focusSecond: true,
          onOk: (vals) => {
            const a = vals.alt.trim() || "açıklama";
            const s = vals.src.trim() || "resim.png";
            insertAtCursor(`![${a}](${s})`);
          },
        },
        getTarget(),
        deps.getCmView()
      );
        break;
      }
      case "bullet":
        eachLineSel(togglePrefix("- "));
        break;
      case "numbered":
        eachLineSel(togglePrefix("1. "));
        break;
      case "task":
        eachLineSel(toggleTaskLine);
        break;
      case "quote":
        eachLineSel(togglePrefix("> "));
        break;
      case "code":
        if (selText().includes("\n")) {
          wrapSel("```\n", "\n```", "kod");
        } else {
          wrapSel("`", "`", "kod");
        }
        break;
      case "link": {
        const label = selText() || "metin";
        openDialog({
          title: "Bağlantı ekle",
          fields: [
            { key: "text", label: "Metin", value: label },
            { key: "url", label: "Adres", value: "https://" },
          ],
          okLabel: "Ekle",
          focusSecond: true,
          onOk: (vals) => {
            const t = vals.text.trim() || "metin";
            const u = vals.url.trim() || "https://";
            const ins = `[${t}](${u})`;
            // URL'yi seçili bırak ki üstüne yazılabilsin
            const pos = t.length + 3;
            const tgt = getTarget();
            if (!tgt) {
              return;
            }
            if (tgt.kind === "cm") {
              cmInsert(ins, pos, pos + u.length);
            } else {
              taInsert(ins, pos, pos + u.length);
            }
          },
        },
        getTarget(),
        deps.getCmView()
      );
        break;
      }
    }
    refreshBar();
  }

  function refreshBar() {
    const show = deps.getMode() !== "reading";
    formatbar.classList.toggle("hidden", !show);
    if (!show) {
      return;
    }
    const t = getTarget();
    const { canUndo, canRedo } = deps.undoState();
    for (const b of fmtButtons) {
      const cmd = b.dataset.cmd || "";
      if (cmd === "undo") {
        b.disabled = !canUndo;
      } else if (cmd === "redo") {
        b.disabled = !canRedo;
      } else {
        b.disabled = t === null;
      }
    }
  }

  fmtButtons.forEach((b) => {
    // mousedown'da odağı çalma: canlı blok editi kapanmasın, komut hedefsiz kalmasın
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.preventDefault();
      const cmd = b.dataset.cmd || "";
      if (cmd === "undo" || cmd === "redo") {
        deps.undoRedo(cmd);
      } else {
        runFormat(cmd);
      }
    });
  });

  return { refreshBar };
}
