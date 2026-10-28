import { Extension } from "@tiptap/core";
import type { Node as DocumentNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { highlightCode } from "../shared/code-highlight";

type TokenRange = { from: number; to: number; className: string };
const tokens = new WeakMap<DocumentNode, TokenRange[]>();
function highlight(doc: DocumentNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (node.type.name !== "codeBlock") return;
    let ranges = tokens.get(node);
    if (!ranges) {
      ranges = [];
      const language = node.attrs.language;
      const html = language ? highlightCode(node.textContent, language) : null;
      if (html !== null) {
        const container = document.createElement("div"); container.innerHTML = html;
        const visit = (element: Node, offset: number): number => {
          const length = element.textContent?.length || 0;
          if (element instanceof HTMLElement && element.className && length) ranges!.push({ from: offset, to: offset + length, className: element.className });
          let cursor = offset;
          for (const child of Array.from(element.childNodes)) cursor += visit(child, cursor);
          return length;
        };
        visit(container, 0);
      }
      tokens.set(node, ranges);
    }
    for (const range of ranges) decorations.push(Decoration.inline(position + 1 + range.from, position + 1 + range.to, { class: range.className }));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

// Use the preview's highlighter as model decorations, without touching source
// or replacing the editable code DOM when the caret moves.
export const CodeHighlight = Extension.create({
  name: "codeHighlight",
  addProseMirrorPlugins: () => [new Plugin({
    state: { init: (_config, state) => highlight(state.doc), apply: (tr, value) => tr.docChanged ? highlight(tr.doc) : value },
    props: { decorations(state) { return this.getState(state); } },
  })],
});
