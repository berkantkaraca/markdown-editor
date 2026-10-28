import { CodeHighlight } from "./code-highlight";
import { prepareTaskLists, taskCheckbox } from "./task-lists";
import { decodeSource } from "../shared/md-utils";
import { Editor, Extension, Node as TiptapNode } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { Plugin, PluginKey, EditorState, TextSelection } from "@tiptap/pm/state";
import { DOMSerializer } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { SelectionBookmark } from "@tiptap/pm/state";
import DOMPurify from "dompurify";
import { createMdPipeline } from "../shared/md-pipeline";
import { createTurndown } from "../shared/md-turndown";

const pipeline = createMdPipeline();
const converter = createTurndown();
const findKey = new PluginKey<DecorationSet>("documentFind");

converter.addRule("preserved-source", {
  filter: (node) => (node as HTMLElement).hasAttribute("data-md-source"),
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const raw = decodeSource(el.getAttribute("data-md-source") || "");
    return el.tagName === "SPAN" ? raw : `\n\n${raw}\n\n`;
  },
});
converter.addRule("document-task", {
  filter: (node) => node.nodeName === "LI" && (node as HTMLElement).dataset.type === "taskItem",
  replacement: (content, node) => {
    const checked = (node as HTMLElement).dataset.checked === "true";
    return `- [${checked ? "x" : " "}] ${content.trim().replace(/\n/g, "\n  ")}\n`;
  },
});

function preserved(inline: boolean) {
  return TiptapNode.create({
    name: inline ? "preservedInline" : "preservedSection",
    group: inline ? "inline" : "block",
    inline,
    atom: true,
    draggable: false,
    addAttributes: () => ({ source: { default: "", rendered: false }, html: { default: "", rendered: false } }),
    parseHTML: () => [{
      tag: `${inline ? "span" : "div"}[data-md-source]`,
      getAttrs: (el) => ({ source: decodeSource(el.getAttribute("data-md-source") || ""), html: el.innerHTML }),
    }],
    renderHTML: ({ node }) => [inline ? "span" : "div", { "data-md-source": encodeURIComponent(node.attrs.source) }, node.attrs.source],
    addNodeView: () => ({ node }) => {
      const dom = document.createElement(inline ? "span" : "div");
      dom.className = "preserved-content";
      dom.setAttribute("data-md-source", encodeURIComponent(node.attrs.source));
      dom.setAttribute("title", "Kaynağı düzenlemek için Kaynak modunu kullanın");
      dom.innerHTML = DOMPurify.sanitize(node.attrs.html);
      return { dom, ignoreMutation: () => true };
    },
  });
}

// Images keep filesystem paths in the document. Resolved webview URLs are view-only.
const DocumentImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("img");
      dom.src = node.attrs.src;
      dom.alt = node.attrs.alt || "";
      dom.title = node.attrs.title || "";
      dom.dataset.origsrc = node.attrs.src;
      return { dom, ignoreMutation: () => true };
    };
  },
});

function importMarkdown(text: string): string {
  // Parse in an inert document, extract source before sanitization, then sanitize
  // the result. DOMPurify intentionally rejects comment-like attribute values
  // (including Mermaid arrows), so source attributes use URI encoding.
  const host = new DOMParser().parseFromString(pipeline.renderFullWithFm(text), "text/html").body;
  host.querySelectorAll(".frontmatter, .mermaid, .katex-display, .katex").forEach((el) => {
    if (!host.contains(el)) return;
    const display = el.matches(".frontmatter, .mermaid, .katex-display");
    const tex = el.querySelector("annotation")?.textContent || "";
    const source = el.classList.contains("frontmatter") ? (el as HTMLElement).dataset.raw || ""
      : el.classList.contains("mermaid") ? `\`\`\`mermaid\n${decodeSource((el as HTMLElement).dataset.source || "")}\`\`\``
      : display ? `$$${tex}$$` : `$${tex}$`;
    const wrapper = document.createElement(display ? "div" : "span");
    wrapper.dataset.mdSource = encodeURIComponent(source);
    wrapper.appendChild(el.cloneNode(true));
    el.replaceWith(wrapper);
  });
  // Keep HTML constructs outside the editing schema as source-preserving inline
  // objects, rather than silently dropping them when another paragraph changes.
  host.querySelectorAll("details, summary, u, sub, sup, kbd, abbr, small, ins").forEach((el) => {
    if (!host.contains(el) || el.closest("[data-md-source]")) return;
    const wrapper = document.createElement(el.matches("details,summary") ? "div" : "span");
    wrapper.dataset.mdSource = encodeURIComponent(el.outerHTML);
    wrapper.appendChild(el.cloneNode(true)); el.replaceWith(wrapper);
  });
  // Import plain code text into the model. Rendered token spans can trigger
  // whitespace normalization in the HTML parser; decorations restore colors.
  host.querySelectorAll("pre code").forEach((code) => {
    code.replaceChildren(document.createTextNode(code.textContent || ""));
  });
  prepareTaskLists(host);
  host.querySelectorAll('li[data-type="taskItem"]').forEach((item) => taskCheckbox(item)?.remove());
  return DOMPurify.sanitize(host.innerHTML);
}

export interface DocumentEditorOptions {
  element: HTMLElement;
  changed(markdown: string): void;
  selectionChanged(): void;
  pasteImage(file: File): void;
  openLink(href: string, wiki: string | null): void;
}

export class DocumentEditor {
  readonly editor: Editor;
  private markdown = "";
  private bookmarks = new Map<string, SelectionBookmark>();
  private matches: { from: number; to: number }[] = [];
  private query: RegExp | null = null;
  private activeMatch = 0;

  constructor(private readonly options: DocumentEditorOptions) {
    this.editor = new Editor({
      element: options.element,
      injectCSS: false,
      extensions: [
        StarterKit.configure({ link: { openOnClick: false }, underline: false, codeBlock: { HTMLAttributes: { class: "hljs" } } }),
        TableKit.configure({ table: { resizable: false } }),
        TaskList, TaskItem.configure({ nested: true, HTMLAttributes: { "data-type": "taskItem" } }), DocumentImage,
        preserved(false), preserved(true), CodeHighlight,
        Extension.create({
          name: "wikiLinks",
          addGlobalAttributes: () => [{ types: ["link"], attributes: {
            wiki: { default: null, parseHTML: (el) => el.getAttribute("data-wikilink"),
              renderHTML: (attrs) => attrs.wiki ? { "data-wikilink": attrs.wiki } : {} },
          } }],
        }),
        Extension.create({
          name: "documentFind",
          addProseMirrorPlugins: () => [new Plugin({
            key: findKey,
            state: {
              init: () => DecorationSet.empty,
              apply: (tr, value) => tr.getMeta(findKey) ?? value.map(tr.mapping, tr.doc),
            },
            props: { decorations: (state) => findKey.getState(state) },
          })],
        }),
      ],
      editorProps: {
        clipboardTextSerializer: (slice) => {
          const container = document.createElement("div");
          container.appendChild(DOMSerializer.fromSchema(this.editor.schema).serializeFragment(slice.content));
          return converter.turndown(container);
        },
        attributes: { role: "textbox", "aria-label": "Belge düzenleyici", "aria-multiline": "true", spellcheck: "true" },
        handlePaste: (_view, event) => {
          const file = Array.from(event.clipboardData?.files || []).find((f) => f.type.startsWith("image/"));
          if (!file) return false;
          options.pasteImage(file);
          return true;
        },
        handleClick: (_view, _pos, event) => {
          const link = (event.target as HTMLElement).closest("a");
          if (!link) return false;
          event.preventDefault();
          if (event.ctrlKey || event.metaKey) options.openLink(link.getAttribute("href") || "", link.getAttribute("data-wikilink"));
          return true;
        },
      },
      onTransaction: ({ transaction }) => {
        this.bookmarks.forEach((bookmark, key) => this.bookmarks.set(key, bookmark.map(transaction.mapping)));
      },
      onSelectionUpdate: () => options.selectionChanged(),
      onUpdate: () => {
        const doc = this.editor.state.doc;
        this.markdown = doc.childCount === 1 && doc.firstChild?.type.name === "paragraph" && doc.firstChild.content.size === 0
          ? "" : converter.turndown(this.editor.getHTML());
        options.changed(this.markdown);
        if (this.query) this.find(this.query, this.activeMatch);
      },
    });
  }

  load(markdown: string): void {
    if (markdown === this.markdown) return;
    const { from, to } = this.editor.state.selection;
    this.markdown = markdown;
    // Loading another revision resets native history; undo may never resurrect another revision.
    this.bookmarks.clear();
    this.editor.commands.setContent(importMarkdown(markdown), { emitUpdate: false });
    const loaded = this.editor.state;
    this.editor.view.updateState(EditorState.create({ schema: loaded.schema, doc: loaded.doc, plugins: loaded.plugins }));
    const max = this.editor.state.doc.content.size;
    const doc = this.editor.state.doc;
    this.editor.view.dispatch(this.editor.state.tr.setSelection(TextSelection.between(
      doc.resolve(Math.min(from, max)), doc.resolve(Math.min(to, max)))));
    if (this.query) this.find(this.query, this.activeMatch);
  }

  replaceMarkdown(markdown: string): void {
    this.editor.commands.setContent(importMarkdown(markdown));
  }

  bookmark(key: string): void { this.bookmarks.set(key, this.editor.state.selection.getBookmark()); }
  insertImage(key: string, src: string): void {
    const bookmark = this.bookmarks.get(key);
    this.bookmarks.delete(key);
    if (!bookmark) return;
    const selection = bookmark.resolve(this.editor.state.doc);
    this.editor.commands.setTextSelection({ from: selection.from, to: selection.to });
    this.editor.commands.setImage({ src, alt: "görsel" });
  }

  find(query: RegExp | null, active = 0): number {
    this.query = query;
    this.activeMatch = active;
    this.matches = [];
    if (query) this.editor.state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return;
      const text = node.textBetween(0, node.content.size, "", "\ufffc");
      query.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = query.exec(text))) {
        if (!match[0].length) { query.lastIndex++; continue; }
        this.matches.push({ from: pos + 1 + match.index, to: pos + 1 + match.index + match[0].length });
      }
      return false;
    });
    const decorations = this.matches.map((match, i) => Decoration.inline(match.from, match.to, {
      class: `find-hit${i === active ? " current" : ""}`,
    }));
    this.editor.view.dispatch(this.editor.state.tr.setMeta(findKey, DecorationSet.create(this.editor.state.doc, decorations)));
    return this.matches.length;
  }

  focusMatch(index: number): void {
    this.find(this.query, index);
    const match = this.matches[index];
    if (match) this.editor.view.domAtPos(match.from).node.parentElement?.scrollIntoView({ block: "center" });
  }

  replaceMatch(index: number, replacement: string, all: boolean): void {
    if (!this.query) return;
    const chosen = all ? [...this.matches] : this.matches.slice(index, index + 1);
    const tr = this.editor.state.tr;
    for (const match of chosen.reverse()) {
      const text = this.editor.state.doc.textBetween(match.from, match.to);
      const regex = new RegExp(this.query.source, this.query.flags.replace("g", ""));
      tr.insertText(text.replace(regex, replacement), match.from, match.to);
    }
    if (tr.docChanged) this.editor.view.dispatch(tr);
  }

  destroy(): void { this.editor.destroy(); }
}
