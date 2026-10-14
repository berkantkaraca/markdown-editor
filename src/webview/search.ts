// Bulma çubuğu (Canlı/Okuma/Split önizleme): bul + vurgula + değiştir.
// DOM + seçim mantığı buradadır; doküman durumu deps üzerinden akar.
import { buildFindRegex as makeFindRegex } from "../shared/md-utils";

export interface SearchDeps {
  getMode(): string;
  getText(): string;
  record(force?: boolean): void;
  applyFullText(text: string): void;
  roots: {
    live: HTMLElement;
    reading: HTMLElement;
    split: HTMLElement;
  };
}

export interface FindApi {
  openFind(): void;
  closeFind(): void;
  refresh(): void;
  isOpen(): boolean;
}

export function attachFindbar(deps: SearchDeps): FindApi {
  const findbar = document.getElementById("findbar")!;
  const findInput = document.getElementById("find-input") as HTMLInputElement;
  const findCount = document.getElementById("find-count")!;
  const replaceRow = document.getElementById("replace-row")!;
  const replaceInput = document.getElementById("replace-input") as HTMLInputElement;
  let findOpen = false;
  let findMarks: HTMLElement[] = [];
  let findIdx = -1;
  let findCase = false;
  let findWord = false;
  let findRegex = false;
  let replaceOpen = false;

  function currentPreviewRoot(): HTMLElement | null {
    const mode = deps.getMode();
    if (mode === "live") {
      return deps.roots.live;
    }
    if (mode === "reading") {
      return deps.roots.reading;
    }
    if (mode === "split") {
      return deps.roots.split;
    }
    return null;
  }

  function openFind() {
    findOpen = true;
    findbar.classList.remove("hidden");
    findInput.focus();
    findInput.select();
    updateFind();
  }

  function closeFind() {
    findOpen = false;
    findbar.classList.add("hidden");
    clearFindMarks();
  }

  function clearFindMarks() {
    document.querySelectorAll("mark.find-hit").forEach((node) => {
      const m = node as HTMLElement;
      const parent = m.parentNode;
      if (!parent) {
        return;
      }
      parent.replaceChild(document.createTextNode(m.textContent || ""), m);
      parent.normalize();
    });
    findMarks = [];
    findIdx = -1;
    updateFindCount();
  }

  function buildFindRegex(): RegExp | null {
    return makeFindRegex(findInput.value, {
      caseSensitive: findCase,
      wholeWord: findWord,
      regex: findRegex,
    });
  }

  function updateFind() {
    clearFindMarks();
    const q = findInput.value;
    if (!q) {
      return;
    }
    const root = currentPreviewRoot();
    if (!root) {
      return;
    }
    const re = buildFindRegex();
    if (!re) {
      findCount.textContent = "hatalı ifade";
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      nodes.push(n as Text);
    }
    for (const node of nodes) {
      const text = node.textContent || "";
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      let i = 0;
      let found = false;
      const frag = document.createDocumentFragment();
      while ((m = re.exec(text))) {
        found = true;
        frag.appendChild(document.createTextNode(text.slice(i, m.index)));
        const mark = document.createElement("mark");
        mark.className = "find-hit";
        mark.textContent = m[0].length > 0 ? m[0] : text.slice(m.index, m.index + 1) || " ";
        frag.appendChild(mark);
        findMarks.push(mark);
        i = m.index + (m[0].length || 1);
        if (m[0].length === 0) {
          re.lastIndex = i;
        }
      }
      if (!found) {
        continue;
      }
      frag.appendChild(document.createTextNode(text.slice(i)));
      node.parentNode?.replaceChild(frag, node);
    }
    if (findMarks.length > 0) {
      findIdx = 0;
      showFindMark(0);
    }
    updateFindCount();
  }

  // Doküman üzerindeki eşleşmeler (Değiştir işlemleri için, kaynak offset'li)
  function docMatches(): Array<[number, number]> {
    const re = buildFindRegex();
    if (!re) {
      return [];
    }
    re.lastIndex = 0;
    const out: Array<[number, number]> = [];
    let m: RegExpExecArray | null;
    const currentText = deps.getText();
    while ((m = re.exec(currentText))) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      out.push([m.index, m.index + m[0].length]);
    }
    return out;
  }

  function applyReplaceAll() {
    const re = buildFindRegex();
    if (!re) {
      return;
    }
    deps.record(true);
    // String.replace $1, $& gibi desenleri kendi genişletir
    deps.applyFullText(deps.getText().replace(re, replaceInput.value));
  }

  function applyReplaceOne() {
    const all = docMatches();
    if (all.length === 0) {
      return;
    }
    const re = buildFindRegex();
    if (!re) {
      return;
    }
    const [s, e] = all[((findIdx % all.length) + all.length) % all.length];
    const single = new RegExp(`^(?:${re.source})$`, re.flags.replace("g", ""));
    const currentText = deps.getText();
    const rep = currentText.slice(s, e).replace(single, replaceInput.value);
    deps.record(true);
    deps.applyFullText(currentText.slice(0, s) + rep + currentText.slice(e));
  }

  function refreshFindButtons() {
    findbar.querySelectorAll("button[data-ffind]").forEach((node) => {
      const b = node as HTMLButtonElement;
      const cmd = b.dataset.ffind || "";
      b.classList.toggle(
        "on",
        (cmd === "case" && findCase) || (cmd === "word" && findWord) || (cmd === "regex" && findRegex)
      );
    });
  }

  function updateFindCount() {
    if (!findInput.value) {
      findCount.textContent = "";
      return;
    }
    findCount.textContent =
      findMarks.length === 0 ? "bulunamadı" : `${findIdx + 1} / ${findMarks.length}`;
  }

  function showFindMark(i: number) {
    findMarks.forEach((m, j) => m.classList.toggle("current", i === j));
    const el = findMarks[i];
    if (el) {
      el.scrollIntoView({ block: "center" });
    }
  }

  function stepFind(dir: 1 | -1) {
    if (findMarks.length === 0) {
      return;
    }
    findIdx = (findIdx + dir + findMarks.length) % findMarks.length;
    showFindMark(findIdx);
    updateFindCount();
  }

  findInput.addEventListener(
    "input",
    debounceLocal(() => updateFind(), 150)
  );
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      stepFind(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeFind();
    }
    // NOT: stopPropagation yok — örn. Delete document dinleyicisine ulaşmalı.
  });
  findbar.querySelectorAll("button[data-ffind]").forEach((node) => {
    const b = node as HTMLButtonElement;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.preventDefault();
      const cmd = b.dataset.ffind || "";
      if (cmd === "close") {
        closeFind();
      } else if (cmd === "prev") {
        stepFind(-1);
      } else if (cmd === "next") {
        stepFind(1);
      } else if (cmd === "case") {
        findCase = !findCase;
        refreshFindButtons();
        updateFind();
      } else if (cmd === "word") {
        findWord = !findWord;
        refreshFindButtons();
        updateFind();
      } else if (cmd === "regex") {
        findRegex = !findRegex;
        refreshFindButtons();
        updateFind();
      } else if (cmd === "toggle-replace") {
        replaceOpen = !replaceOpen;
        replaceRow.classList.toggle("hidden", !replaceOpen);
        if (replaceOpen) {
          replaceInput.focus();
        } else {
          findInput.focus();
        }
      } else if (cmd === "replace") {
        applyReplaceOne();
      } else if (cmd === "replace-all") {
        applyReplaceAll();
      }
    });
  });

  return {
    openFind,
    closeFind,
    refresh: updateFind,
    isOpen: () => findOpen,
  };
}

function debounceLocal<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...args: any[]) => {
    if (t !== undefined) {
      clearTimeout(t);
    }
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}
