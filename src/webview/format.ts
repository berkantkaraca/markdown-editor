import { t } from "./i18n";
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@codemirror/view";
import { editTable, setHeadingLevel, togglePrefix, toggleTaskLine } from "../shared/md-utils";
import type { TableOp } from "../shared/md-utils";
import { createTablePicker } from "./table-picker";

interface FormatDeps {
  getMode(): string;
  getEditor(): Editor;
  getSource(): EditorView;
  insertSpecial(kind: "math" | "mermaid"): void;
  undo(): void;
  redo(): void;
  history(): { undo: boolean; redo: boolean };
}

// The toolbar sends document commands. It never edits the rendered DOM.
export function attachFormatbar(deps: FormatDeps) {
  const bar = document.getElementById("formatbar")!;
  const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>("button[data-cmd]"));
  let popup: HTMLElement | null = null;
  const close = () => { popup?.remove(); popup = null; };
  const live = () => deps.getMode() === "live";
  const source = () => deps.getSource();
  const editor = () => deps.getEditor();
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  function insert(text: string, before = "", after = "") {
    const view = source();
    const range = view.state.selection.main;
    const selected = view.state.sliceDoc(range.from, range.to) || text;
    view.dispatch({ changes: { from: range.from, to: range.to, insert: before + selected + after },
      selection: { anchor: range.from + before.length, head: range.from + before.length + selected.length } });
    view.focus();
  }
  function lines(transform: (line: string) => string | null) {
    const view = source();
    const { from, to } = view.state.selection.main;
    const changes = [];
    const last = view.state.doc.lineAt(to > from && view.state.doc.lineAt(to).from === to ? to - 1 : to).number;
    for (let n = view.state.doc.lineAt(from).number; n <= last; n++) {
      const line = view.state.doc.line(n);
      const value = transform(line.text);
      if (value !== null && value !== line.text) changes.push({ from: line.from, to: line.to, insert: value });
    }
    view.dispatch({ changes }); view.focus();
  }
  function table(operation: TableOp) {
    if (live()) {
      const chain = editor().chain().focus();
      if (operation === "add-row") chain.addRowAfter().run();
      if (operation === "del-row") chain.deleteRow().run();
      if (operation === "add-col") chain.addColumnAfter().run();
      if (operation === "del-col") chain.deleteColumn().run();
      return;
    }
    const view = source(), doc = view.state.doc;
    let first = doc.lineAt(view.state.selection.main.head).number, last = first;
    const isRow = (n: number) => n > 0 && n <= doc.lines && doc.line(n).text.trim().startsWith("|");
    while (isRow(first - 1)) first--;
    while (isRow(last + 1)) last++;
    const result = editTable(doc.sliceString(doc.line(first).from, doc.line(last).to), operation);
    if (result !== null) view.dispatch({ changes: { from: doc.line(first).from, to: doc.line(last).to, insert: result } });
    view.focus();
  }
  function menu(anchor: HTMLElement, items: { label: string; run(): void }[]) {
    close();
    popup = document.createElement("div"); popup.className = "kmenu"; popup.setAttribute("role", "menu");
    const bookmark = live() ? editor().state.selection.getBookmark() : null;
    for (const item of items) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = item.label;
      button.setAttribute("role", "menuitem");
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        if (bookmark) editor().view.dispatch(editor().state.tr.setSelection(bookmark.resolve(editor().state.doc)));
        item.run(); close(); refreshBar();
      });
      popup.appendChild(button);
    }
    const rect = anchor.getBoundingClientRect();
    popup.style.left = `${Math.max(4, rect.left)}px`; popup.style.top = `${rect.bottom + 4}px`;
    document.body.appendChild(popup);
    popup.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const choices = Array.from(popup!.querySelectorAll<HTMLButtonElement>("button"));
      const index = choices.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
      choices[next]?.focus();
    });
    popup.querySelector("button")?.focus();
  }
  function dialog(kind: "link" | "image") {
    close();
    const targetLive = live();
    const selection = targetLive ? editor().state.selection.getBookmark() : source().state.selection.main;
    const selected = targetLive ? editor().state.doc.textBetween(editor().state.selection.from, editor().state.selection.to)
      : source().state.sliceDoc(source().state.selection.main.from, source().state.selection.main.to);
    popup = document.createElement("form"); popup.className = "kdialog";
    popup.setAttribute("role", "dialog"); popup.setAttribute("aria-label", kind === "link" ? t("Bağlantı ekle") : t("Görsel ekle"));
    const title = document.createElement("strong"); title.textContent = kind === "link" ? t("Bağlantı ekle") : t("Görsel ekle"); popup.appendChild(title);
    const fields = [selected, kind === "link" ? "https://" : ""] .map((value, i) => {
      const label = document.createElement("label"); label.textContent = i ? t("Adres / dosya yolu") : t("Metin / açıklama");
      const input = document.createElement("input"); input.value = value; label.appendChild(input); popup!.appendChild(label); return input;
    });
    const row = document.createElement("div"); row.className = "kdialog-row";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = t("Vazgeç"); cancel.onclick = close;
    const ok = document.createElement("button"); ok.type = "submit"; ok.textContent = t("Ekle"); ok.className = "primary";
    row.append(cancel, ok); popup.appendChild(row);
    popup.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = fields[0].value || (kind === "link" ? t("bağlantı") : t("görsel")), url = fields[1].value.trim();
      if (!url || /^(javascript|vbscript|data):/i.test(url)) { fields[1].focus(); return; }
      close();
      if (targetLive) {
        const bookmark = selection as ReturnType<Editor["state"]["selection"]["getBookmark"]>;
        editor().view.dispatch(editor().state.tr.setSelection(bookmark.resolve(editor().state.doc)));
        if (kind === "image") editor().chain().focus().setImage({ src: url, alt: text }).run();
        else editor().chain().focus().insertContent(`<a href="${escape(url)}">${escape(text)}</a>`).run();
      } else {
        const range = selection as { from: number; to: number };
        const snippet = `${kind === "image" ? "!" : ""}[${text.replace(/([\\\[\]])/g, "\\$1")}](${url.replace(/ /g, "%20")})`;
        source().dispatch({ changes: { from: range.from, to: range.to, insert: snippet } }); source().focus();
      }
    });
    document.body.appendChild(popup); fields[1].focus(); fields[1].select();
  }

  function pickTable(anchor: HTMLElement) {
    close();
    const targetLive = live();
    const bookmark = targetLive ? editor().state.selection.getBookmark() : null;
    const range = targetLive ? null : source().state.selection.main;
    popup = createTablePicker(anchor, (rows, cols) => {
      close();
      if (bookmark) {
        editor().view.dispatch(editor().state.tr.setSelection(bookmark.resolve(editor().state.doc)));
        editor().chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
      } else if (range) {
        const view = source();
        const header = `| ${Array.from({ length: cols }, (_, i) => `${t("Başlık")} ${i + 1}`).join(" | ")} |`;
        const divider = `| ${Array(cols).fill("---").join(" | ")} |`;
        const body = Array(rows - 1).fill(`| ${Array(cols).fill("").join(" | ")} |`);
        const snippet = "\n\n" + [header, divider, ...body].join("\n") + "\n\n";
        view.dispatch({ changes: { from: range.from, to: range.to, insert: snippet }, selection: { anchor: range.from + 4 } });
        view.focus();
      }
      refreshBar();
    }, close);
    document.body.appendChild(popup); popup.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }

  function run(command: string, anchor: HTMLElement) {
    if (command === "undo") return deps.undo();
    if (command === "redo") return deps.redo();
    if (command === "heading-menu") {
      menu(anchor, [...[1, 2, 3, 4, 5, 6].map((level) => ({ label: `${t("Başlık")} ${level}`, run: () => {
        if (live()) editor().chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
        else lines(setHeadingLevel(level));
      } })), { label: t("Normal metin"), run: () => {
        if (live()) editor().chain().focus().setParagraph().run(); else lines((line) => line.replace(/^#{1,6}\s+/, ""));
      } }]); return;
    }
    if (command === "table-menu") {
      const inTable = live() ? editor().isActive("table") : source().state.doc.lineAt(source().state.selection.main.head).text.trim().startsWith("|");
      if (!inTable) { pickTable(anchor); return; }
      menu(anchor, [{ label: t("Yeni tablo…"), run: () => { setTimeout(() => pickTable(anchor), 0); } }, ...(["add-row", "del-row", "add-col", "del-col"] as TableOp[]).map((operation, i) => ({
        label: [t("+ Satır"), t("− Satır"), t("+ Sütun"), t("− Sütun")][i], run: () => table(operation),
      }))]); return;
    }
    if (command === "link" || command === "image") return dialog(command);
    if (command === "math" || command === "mermaid") {
      if (live()) deps.insertSpecial(command);
      else insert(command === "math" ? "$$x^2$$" : "\n```mermaid\nflowchart LR\n    A --> B\n```\n");
      return;
    }
    if (live()) {
      const chain = editor().chain().focus();
      if (command === "bold") chain.toggleBold().run();
      if (command === "italic") chain.toggleItalic().run();
      if (command === "strike") chain.toggleStrike().run();
      if (command === "code") chain.toggleCode().run();
      if (command === "bullet") chain.toggleBulletList().run();
      if (command === "numbered") chain.toggleOrderedList().run();
      if (command === "task") chain.toggleTaskList().run();
      if (command === "quote") chain.toggleBlockquote().run();
    } else {
      if (command === "bold") insert(t("metin"), "**", "**");
      if (command === "italic") insert(t("metin"), "*", "*");
      if (command === "strike") insert(t("metin"), "~~", "~~");
      if (command === "code") insert(t("kod"), "`", "`");
      if (command === "bullet") lines(togglePrefix("- "));
      if (command === "numbered") lines(togglePrefix("1. "));
      if (command === "task") lines(toggleTaskLine);
      if (command === "quote") lines(togglePrefix("> "));
    }
    refreshBar();
  }
  function refreshBar() {
    bar.classList.remove("hidden");
    const reading = deps.getMode() === "reading", history = deps.history();
    const actions = bar.querySelector<HTMLElement>(".toolbar-actions");
    actions?.classList.toggle("reading-tools", reading);
    actions?.setAttribute("aria-hidden", String(reading));
    actions?.toggleAttribute("inert", reading);
    bar.querySelectorAll<HTMLElement>(".fsep").forEach((separator) => { separator.hidden = reading; });
    const states: Record<string, string> = { bold: "bold", italic: "italic", strike: "strike", code: "code",
      bullet: "bulletList", numbered: "orderedList", task: "taskList", quote: "blockquote" };
    for (const button of buttons) {
      const command = button.dataset.cmd!;
      button.hidden = false;
      button.disabled = command === "undo" ? !history.undo : command === "redo" ? !history.redo : reading;
      const active = live() && !!states[command] && editor().isActive(states[command]);
      button.classList.toggle("on", active);
      if (states[command]) button.setAttribute("aria-pressed", String(active));
    }
  }
  bar.querySelector(".toolbar-actions")?.addEventListener("keydown", (raw) => {
    const event = raw as KeyboardEvent;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const available = buttons.filter((button) => !button.hidden && !button.disabled);
    const index = available.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + available.length) % available.length;
    available[next]?.focus();
  });
  buttons.forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => run(button.dataset.cmd!, button));
  });
  document.addEventListener("mousedown", (event) => {
    if (popup && !popup.contains(event.target as Node) && !(event.target as HTMLElement).closest("[data-cmd]")) close();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  return { refreshBar, close };
}
