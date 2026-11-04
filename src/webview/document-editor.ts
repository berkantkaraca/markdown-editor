import { t } from "./i18n";
import { richGitPlugin, richGitKey, gitTitle } from "./git-markers";
import { characterChanges, changeForRange } from "../shared/git-diff";
import { listSource } from "../shared/list-source";
import { normalizeClipboardHTML, clipboardHasText } from "./clipboard-html";
import { markdownWhitespace } from "../shared/blank-paragraphs";
import { tableKeyDown } from "./table-actions";
import { SourcePreserver } from "./source-preserver";
import { openSourceDialog, type SpecialKind } from "./source-dialog";
import { CodeHighlight } from "./code-highlight";
import { prepareTaskLists, taskCheckbox } from "./task-lists";
import { decodeSource, normalizeNewlines } from "../shared/md-utils";
import { Editor, Extension, Node as TiptapNode } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { Plugin, PluginKey, EditorState, TextSelection } from "@tiptap/pm/state";
import { DOMSerializer } from "@tiptap/pm/model";
import type { Node as DocumentNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { SelectionBookmark } from "@tiptap/pm/state";
import DOMPurify from "dompurify";
import { createMdPipeline } from "../shared/md-pipeline";
import { createTurndown } from "../shared/md-turndown";

const pipeline = createMdPipeline({ sourceMap: true });
const contentPipeline = createMdPipeline();
const converter = createTurndown({ preserveEmptyMarkers: true });
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
    addNodeView: () => ({ node, getPos, editor }) => {
      const dom = document.createElement(inline ? "span" : "div");
      dom.className = "preserved-content";
      dom.setAttribute("data-md-source", encodeURIComponent(node.attrs.source));
      dom.setAttribute("title", t("Düzenlemek için çift tıklayın"));
      dom.addEventListener("dblclick", (event) => {
        event.preventDefault();
        const source = String(node.attrs.source);
        const kind: SpecialKind = source.startsWith("$") ? "math" : source.startsWith("```mermaid") ? "mermaid" : "html";
        openSourceDialog({ kind, source, save: (markdown) => {
          const position = getPos();
          if (typeof position !== "number" || editor.state.doc.nodeAt(position)?.type !== node.type) return;
          editor.chain().focus().insertContentAt({ from: position, to: position + node.nodeSize }, importMarkdown(markdown)).run();
        } });
      });
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

function importMarkdown(text: string, sourceMap = false): string {
  // Parse in an inert document, extract source before sanitization, then sanitize
  // the result. DOMPurify intentionally rejects comment-like attribute values
  // (including Mermaid arrows), so source attributes use URI encoding.
  const host = new DOMParser().parseFromString("<body></body>", "text/html").body;
  host.innerHTML = (sourceMap ? pipeline : contentPipeline).renderFullWithFm(text);
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
    const equation = el.classList.contains("katex-display") ? el.closest("eqn") : null;
    const target = equation?.parentElement?.tagName === "SECTION" ? equation.parentElement : el;
    if (target.hasAttribute("data-md-range")) wrapper.setAttribute("data-md-range", target.getAttribute("data-md-range")!);
    target.replaceWith(wrapper);
  });
  // Keep HTML constructs outside the editing schema as source-preserving inline
  // objects, rather than silently dropping them when another paragraph changes.
  host.querySelectorAll("details, summary, u, sub, sup, kbd, abbr, small, ins, mark, time, span[style], span[class], article, section, aside, header, footer, nav, figure, figcaption, address, dl, dt, dd, video, audio, picture, div, table").forEach((el) => {
    if (!host.contains(el) || el.closest("pre,code,[data-md-source]")) return;
    if (el.tagName === "TABLE") return;
    const wrapper = document.createElement(el.matches("details,summary,article,section,aside,header,footer,nav,figure,figcaption,address,dl,dt,dd,video,audio,picture,div,table") ? "div" : "span");
    const clean = el.cloneNode(true) as HTMLElement;
    clean.removeAttribute("data-md-range");
    clean.querySelectorAll("[data-md-range]").forEach((child) => child.removeAttribute("data-md-range"));
    wrapper.dataset.mdSource = encodeURIComponent(clean.outerHTML);
    if (el.hasAttribute("data-md-range")) wrapper.setAttribute("data-md-range", el.getAttribute("data-md-range")!);
    wrapper.appendChild(clean); el.replaceWith(wrapper);
  });
  const comments: Comment[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_COMMENT);
  let comment: Node | null;
  while ((comment = walker.nextNode())) comments.push(comment as Comment);
  for (const comment of comments) {
    if (comment.parentElement?.closest("[data-md-source],pre,code")) continue;
    const marker = document.createElement(comment.parentElement?.closest("p,li,h1,h2,h3,h4,h5,h6") ? "span" : "div");
    marker.dataset.mdSource = encodeURIComponent(`<!--${comment.data}-->`);
    comment.replaceWith(marker);
  }
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
  private serialized = new WeakMap<DocumentNode, string>();
  private provenance = new SourcePreserver();
  private pending = false;
  private pendingSince = 0;
  private serializeTimer: ReturnType<typeof setTimeout> | undefined;
  private bookmarks = new Map<string, SelectionBookmark>();
  private matches: { from: number; to: number }[] = [];
  private query: RegExp | null = null;
  private gitBase: string | null = null;
  private activeMatch = 0;

  constructor(private readonly options: DocumentEditorOptions) {
    this.editor = new Editor({
      element: options.element,
      injectCSS: false,
      extensions: [
        Extension.create({ name: "gitChanges", addProseMirrorPlugins: () => [richGitPlugin()] }),
        StarterKit.configure({ link: { openOnClick: false }, underline: false, codeBlock: { HTMLAttributes: { class: "hljs" } } }),
        TableKit.configure({ table: { resizable: false } }),
        TaskList, TaskItem.configure({ nested: true, HTMLAttributes: { "data-type": "taskItem" } }), DocumentImage,
        preserved(false), preserved(true), CodeHighlight,
        Extension.create({
          name: "markdownOrigins",
          addGlobalAttributes: () => [{ types: ["paragraph", "heading", "bulletList", "orderedList", "taskList", "codeBlock", "blockquote", "table", "image", "preservedSection"], attributes: {
            markdownRange: { default: null, rendered: false, keepOnSplit: true,
              parseHTML: (element) => element.closest("[data-md-range]")?.getAttribute("data-md-range") || null },
          } }],
        }),
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
        handleKeyDown: (_view,event) => tableKeyDown(this.editor,event),
        transformPastedHTML: normalizeClipboardHTML,
        clipboardTextSerializer: (slice) => {
          const container = document.createElement("div");
          container.appendChild(DOMSerializer.fromSchema(this.editor.schema).serializeFragment(slice.content));
          return markdownWhitespace(converter.turndown(container));
        },
        attributes: { role: "textbox", "aria-label": t("Belge düzenleyici"), "aria-multiline": "true", spellcheck: "true" },
        handlePaste: (view, event, slice) => {
          const text = event.clipboardData?.getData("text/plain") || event.clipboardData?.getData("Text") || "";
          const html = event.clipboardData?.getData("text/html") || "";
          const file = Array.from(event.clipboardData?.files || []).find((f) => f.type.startsWith("image/"));
          // A rich selection may also contain a bitmap representation. Prefer
          // editable text over treating the whole selection as a pasted image.
          if (!file || text || html && clipboardHasText(html)) {
            if (!slice.content.size && text) { view.pasteText(text); return true; }
            return false;
          }
          options.pasteImage(file);
          return true;
        },
        handleClick: (_view, _pos, event) => {
          const link = (event.target as HTMLElement).closest("a");
          if (!link) return false;
          event.preventDefault();
          options.openLink(link.getAttribute("href") || "", link.getAttribute("data-wikilink"));
          return true;
        },
      },
      onTransaction: ({ transaction }) => {
        this.provenance.inherit(transaction.before, transaction.doc);
        this.bookmarks.forEach((bookmark, key) => this.bookmarks.set(key, bookmark.map(transaction.mapping)));
      },
      onSelectionUpdate: () => options.selectionChanged(),
      onUpdate: () => {
        if (!this.pending) this.pendingSince = Date.now();
        this.pending = true;
        clearTimeout(this.serializeTimer);
        this.serializeTimer = setTimeout(() => this.flush(), Math.min(100, Math.max(0, 750 - (Date.now() - this.pendingSince))));
        options.selectionChanged();
        if (this.query) this.find(this.query, this.activeMatch);
      },
    });
  }

  get composing(): boolean { return this.editor.view.composing; }
  scrollRanges(): { from: number; to: number; element: HTMLElement }[] {
    const positions = new Map<DocumentNode, number>();
    this.editor.state.doc.forEach((node, position) => positions.set(node, position));
    return this.provenance.sourceRanges(this.editor.state.doc).flatMap(range => {
      const position = positions.get(range.node), element = position === undefined ? null : this.editor.view.nodeDOM(position);
      return element instanceof HTMLElement ? [{ from: range.from, to: range.to, element }] : [];
    });
  }
  setGitBaseline(base: string | null): void {
    this.gitBase = base;
    this.refreshGit();
  }
  refreshGit(): void {
    if (this.gitBase === null && !(richGitKey.getState(this.editor.state)?.find().length)) return;
    if (this.pending && !this.flush()) return;
    const doc = this.editor.state.doc, marks: Decoration[] = [];
    if (this.gitBase !== null) {
      const changes = characterChanges(this.gitBase, this.markdown), positions = new Map<DocumentNode, number>();
      doc.forEach((node, position) => positions.set(node, position));
      const ranges = this.provenance.sourceRanges(doc).filter(range => positions.has(range.node)).sort((a,b) => a.from-b.from);
      for (const hunk of changes) {
        if (hunk.kind === "deleted") {
          const target = ranges.find(range => range.to > hunk.from);
          marks.push(Decoration.widget(target ? positions.get(target.node)! : doc.content.size, () => {
            const point = document.createElement("span"); point.className = "git-deleted-point"; point.title = gitTitle("deleted"); point.contentEditable = "false"; return point;
          }, { side: -1, key: `git-deleted-${hunk.from}` }));
        }
      }
      const marked = ranges.map(range => ({ ...range, kind: changeForRange(changes, range.from, range.to) }));
      for (let i=0; i<marked.length; i++) {
        const item=marked[i]; if(!item.kind) continue;
        if (/^(bulletList|orderedList|taskList)$/.test(item.node.type.name)) continue;
        const position=positions.get(item.node)!, next=marked[i+1];
        const dom=this.editor.view.nodeDOM(position), nextDom=next ? this.editor.view.nodeDOM(positions.get(next.node)!) : null;
        const joined=next?.kind===item.kind && dom instanceof HTMLElement && nextDom instanceof HTMLElement && dom.nextElementSibling===nextDom;
        const gap=joined ? Math.max(0, nextDom.getBoundingClientRect().top-dom.getBoundingClientRect().bottom) : 0;
        marks.push(Decoration.node(position,position+item.node.nodeSize,{class:`git-${item.kind}${joined?" git-joined":""}`,"data-git-change":item.kind,style:joined?`--git-gap:${gap}px`:""}));
      }
      const items = listSource(this.markdown).items;
      let index = 0;
      const listMarks: {node: DocumentNode; position: number; kind: "added" | "modified"}[] = [];
      doc.descendants((node, position) => {
        if (node.type.name !== "listItem" && node.type.name !== "taskItem") return;
        const source = items[index++]; if (!source) return;
        const kinds = source.own.map(range => changeForRange(changes,range.from,range.to));
        const kind = kinds.includes("modified") ? "modified" : kinds.includes("added") ? "added" : null;
        if (kind) listMarks.push({node,position,kind});
      });
      for (const item of listMarks) {
        const dom = this.editor.view.nodeDOM(item.position);
        const next = listMarks.find(other => other.position === item.position+item.node.nodeSize && other.kind === item.kind);
        const nextDom = next ? this.editor.view.nodeDOM(next.position) : null;
        const joined = dom instanceof HTMLElement && nextDom instanceof HTMLElement && dom.nextElementSibling === nextDom;
        const gap = joined ? Math.max(0,nextDom.getBoundingClientRect().top-dom.getBoundingClientRect().bottom) : 0;
        marks.push(Decoration.node(item.position,item.position+item.node.nodeSize,{class:`git-${item.kind}${joined ? " git-joined" : ""}`,"data-git-change":item.kind,style:joined?`--git-gap:${gap}px`:""}));
      }
    }
    this.editor.view.dispatch(this.editor.state.tr.setMeta(richGitKey, DecorationSet.create(doc, marks)));
  }
  flush(): boolean {
    clearTimeout(this.serializeTimer);
    if (!this.pending) return true;
    if (this.composing) { this.serializeTimer = setTimeout(() => this.flush(), 50); return false; }
    this.pending = false;
    this.markdown = this.serializeDocument();
    this.options.changed(this.markdown);
    return true;
  }
  prepareSave(): boolean {
    if (!this.flush()) return false;
    const markdown = this.serializeDocument();
    if (markdown !== this.markdown) { this.markdown = markdown; this.options.changed(markdown); }
    return true;
  }

  private serializeNode(node: DocumentNode): string {
    let text = this.serialized.get(node);
    if (text === undefined) {
      const container = document.createElement("div");
      container.appendChild(DOMSerializer.fromSchema(this.editor.schema).serializeNode(node));
      text = converter.turndown(container); this.serialized.set(node, text);
    }
    return text;
  }
  private serializeDocument(): string {
    const doc = this.editor.state.doc;
    if (doc.childCount === 1 && doc.firstChild?.type.name === "paragraph" && doc.firstChild.content.size === 0) return "";
    return this.provenance.render(doc, (node) => this.serializeNode(node));
  }

  load(markdown: string): void {
    markdown = normalizeNewlines(markdown);
    this.flush();
    if (markdown === this.markdown) return;
    const { from, to } = this.editor.state.selection;
    this.markdown = markdown;
    // Loading another revision resets native history; undo may never resurrect another revision.
    this.bookmarks.clear();
    this.editor.commands.setContent(importMarkdown(markdown, true), { emitUpdate: false });
    const loaded = this.editor.state;
    this.editor.view.updateState(EditorState.create({ schema: loaded.schema, doc: loaded.doc, plugins: loaded.plugins }));
    const max = this.editor.state.doc.content.size;
    const doc = this.editor.state.doc;
    this.editor.view.dispatch(this.editor.state.tr.setSelection(TextSelection.between(
      doc.resolve(Math.min(from, max)), doc.resolve(Math.min(to, max)))));
    this.provenance.reset(markdown, doc);
    if (this.query) this.find(this.query, this.activeMatch);
  }

  replaceMarkdown(markdown: string): void {
    markdown = normalizeNewlines(markdown);
    this.editor.commands.setContent(importMarkdown(markdown, true));
    this.provenance.reset(markdown, this.editor.state.doc);
  }

  insertSpecial(kind: "math" | "mermaid"): void {
    const bookmark = this.editor.state.selection.getBookmark();
    openSourceDialog({ kind, source: kind === "math" ? "$$x^2 + y^2 = z^2$$" : "```mermaid\nflowchart LR\n    A[Start] --> B[End]\n```", save: (source) => {
      this.editor.view.dispatch(this.editor.state.tr.setSelection(bookmark.resolve(this.editor.state.doc)));
      this.editor.chain().focus().insertContent(importMarkdown(source)).run();
    } });
  }

  bookmark(key: string): void { this.bookmarks.set(key, this.editor.state.selection.getBookmark()); }
  pastePlainText(key: string, text: string): void {
    const bookmark = this.bookmarks.get(key); this.bookmarks.delete(key);
    if (!bookmark || !text) return;
    this.editor.view.dispatch(this.editor.state.tr.setSelection(bookmark.resolve(this.editor.state.doc)));
    this.editor.view.pasteText(text);
  }
  insertImage(key: string, src: string): void {
    const bookmark = this.bookmarks.get(key);
    this.bookmarks.delete(key);
    if (!bookmark) return;
    const selection = bookmark.resolve(this.editor.state.doc);
    this.editor.commands.setTextSelection({ from: selection.from, to: selection.to });
    this.editor.commands.setImage({ src, alt: t("görsel") });
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

  destroy(): void { clearTimeout(this.serializeTimer); this.editor.destroy(); }
}
