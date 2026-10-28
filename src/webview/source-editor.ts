import { t } from "./i18n";
import { EditorState, Compartment, Transaction } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, undo, redo, undoDepth, redoDepth } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { listEnterAction } from "../shared/md-utils";

export class SourceEditor {
  readonly view: EditorView;
  private applying = false;
  private wrapping = new Compartment();
  private numbers = new Compartment();
  private theme = new Compartment();
  private locale = new Compartment();
  private bookmarks = new Map<string, number>();

  constructor(element: HTMLElement, changed: (text: string) => void, pasteImage: (file: File) => void) {
    this.view = new EditorView({ parent: element, state: EditorState.create({
      extensions: [
        history(), markdown(), highlightActiveLine(), search({ top: true }), highlightSelectionMatches(),
        this.wrapping.of(EditorView.lineWrapping), this.numbers.of(lineNumbers()), this.theme.of([]), this.locale.of([]),
        keymap.of([{ key: "Enter", run: (view) => {
          const selection = view.state.selection.main;
          if (!selection.empty) return false;
          const line = view.state.doc.lineAt(selection.head);
          const action = listEnterAction(line.text);
          if (action.kind === "none") return false;
          if (action.kind === "exit") {
            view.dispatch({ changes: { from: line.from, to: line.to, insert: "" }, selection: { anchor: line.from } });
          } else if (action.kind === "outdent") {
            const prefix = /^(\t| {1,2})/.exec(line.text)?.[0] || "";
            view.dispatch({ changes: { from: line.from, to: line.from + prefix.length, insert: "" } });
          } else {
            const insert = "\n" + (action.marker || "");
            view.dispatch({ changes: { from: selection.head, insert }, selection: { anchor: selection.head + insert.length } });
          }
          return true;
        } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.domEventHandlers({ paste: (event) => {
          const file = Array.from(event.clipboardData?.files || []).find((f) => f.type.startsWith("image/"));
          if (!file) return false;
          event.preventDefault(); pasteImage(file); return true;
        } }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          this.bookmarks.forEach((pos, key) => this.bookmarks.set(key, update.changes.mapPos(pos)));
          if (!this.applying) changed(update.state.doc.toString());
        }),
      ],
    }) });
  }

  load(text: string): void {
    const old = this.view.state.doc.toString();
    if (old === text) return;
    // Apply the smallest replacement so selections outside the changed range survive.
    let from = 0;
    while (from < old.length && from < text.length && old[from] === text[from]) from++;
    let to = old.length, end = text.length;
    while (to > from && end > from && old[to - 1] === text[end - 1]) { to--; end--; }
    this.applying = true;
    try {
      this.view.dispatch({ changes: { from, to, insert: text.slice(from, end) }, annotations: Transaction.addToHistory.of(false) });
    } finally { this.applying = false; }
  }

  configure(wrap: boolean, numbers: boolean, dark: boolean): void {
    this.view.dispatch({ effects: [this.wrapping.reconfigure(wrap ? EditorView.lineWrapping : []),
      this.numbers.reconfigure(numbers ? lineNumbers() : []), this.theme.reconfigure(dark ? oneDark : []),
      this.locale.reconfigure(EditorState.phrases.of(t("Kaynak") === "Kaynak" ? {
        "Find": "Bul", "Replace": "Değiştir", "next": "sonraki", "previous": "önceki", "all": "tümü",
        "match case": "büyük/küçük harf", "regexp": "normal ifade", "by word": "tüm sözcük",
        "replace": "değiştir", "replace all": "tümünü değiştir", "close": "kapat", "Go to line": "Satıra git",
        "go": "git", "No matches": "Eşleşme yok",
      } : {}))] });
  }
  undo(): void { undo(this.view); }
  redo(): void { redo(this.view); }
  get canUndo(): boolean { return undoDepth(this.view.state) > 0; }
  get canRedo(): boolean { return redoDepth(this.view.state) > 0; }
  bookmark(key: string): void { this.bookmarks.set(key, this.view.state.selection.main.head); }
  insertImage(key: string, src: string): void {
    const pos = this.bookmarks.get(key);
    this.bookmarks.delete(key);
    if (pos === undefined) return;
    this.view.dispatch({ changes: { from: pos, insert: `![${t("görsel")}](${src})` } });
  }
}
