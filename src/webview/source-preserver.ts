import type { Node as DocumentNode } from "@tiptap/pm/model";
import { listSource } from "../shared/list-source";
import { EMPTY_PARAGRAPH, markdownWhitespace } from "../shared/blank-paragraphs";

interface Group { key: string; from: number; to: number; nodes: DocumentNode[] }
interface CurrentGroup { key: string | null; nodes: DocumentNode[] }
export interface SourceRange { node: DocumentNode; from: number; to: number }
interface Patch { from: number; to: number; text: string; ranges: SourceRange[] }

function patchListText(before: DocumentNode, after: DocumentNode, raw: string, serialize: (node: DocumentNode) => string): string | null {
  if (!/^(bulletList|orderedList|taskList)$/.test(before.type.name)) return null;
  if (before.sameMarkup(after) && after.childCount > before.childCount &&
      Array.from({ length: before.childCount }, (_value,index) => before.child(index).eq(after.child(index))).every(Boolean)) {
    const attrs = before.type.name === "orderedList" ? { ...after.attrs, start: (after.attrs.start || 1) + before.childCount } : after.attrs;
    const tail = serialize(after.type.create(attrs,Array.from({ length: after.childCount-before.childCount }, (_value,index) => after.child(before.childCount+index))));
    const separator = "\n".repeat(Math.max(0,2-(raw.match(/\n*$/)?.[0].length || 0)));
    return raw+separator+tail+(raw.endsWith("\n") && !tail.endsWith("\n") ? "\n" : "");
  }
  const edits: { index: number; old: DocumentNode; next: DocumentNode }[] = [];
  let paragraph = 0;
  const visit = (old: DocumentNode, next: DocumentNode): boolean => {
    if (!old.sameMarkup(next)) return false;
    if (old.type.name === "paragraph") {
      const index = paragraph++;
      if (!old.eq(next)) edits.push({ index, old, next });
      return true;
    }
    if (old.childCount !== next.childCount) return false;
    for (let i = 0; i < old.childCount; i++) if (!visit(old.child(i), next.child(i))) return false;
    return old.isLeaf ? old.eq(next) : true;
  };
  if (!visit(before, after)) return null;
  const paragraphs = listSource(raw).paragraphs;
  if (paragraphs.length !== paragraph) return null;
  const patches: { from: number; to: number; text: string }[] = [];
  for (const edit of edits) {
    const span = paragraphs[edit.index], source = raw.slice(span.from, span.to);
    const old = serialize(edit.old), next = serialize(edit.next);
    // Multi-line or structural edits use the normal serializer. Only replace an
    // unambiguous inline span; never reconstruct untouched list siblings.
    if (!old || old.includes("\n") || next.includes("\n")) return null;
    const at = source.indexOf(old);
    if (at < 0 || source.indexOf(old, at + 1) >= 0) return null;
    patches.push({ from: span.from + at, to: span.from + at + old.length, text: next });
  }
  for (const patch of patches.sort((a,b) => b.from-a.from)) raw = raw.slice(0,patch.from)+patch.text+raw.slice(patch.to);
  return raw;
}

// Provenance is metadata on the single document, never a second editing surface.
// Untouched source ranges, whitespace and reference definitions stay byte-for-byte
// unchanged (within the document's normalized LF representation).
export class SourcePreserver {
  private original = "";
  private groups: Group[] = [];
  private extras = new WeakSet<DocumentNode>();
  private complete = false;
  private ranges = new WeakMap<DocumentNode, SourceRange[]>();
  sourceRanges(doc: DocumentNode): SourceRange[] { return this.ranges.get(doc) || []; }
  private contexts = new WeakMap<DocumentNode, { original: string; groups: Group[]; extras: WeakSet<DocumentNode>; complete: boolean }>();
  inherit(before: DocumentNode, after: DocumentNode): void {
    const context = this.contexts.get(before);
    if (context && !this.contexts.has(after)) this.contexts.set(after, context);
  }
  isImplicit(node: DocumentNode, doc: DocumentNode): boolean { return (this.contexts.get(doc)?.extras || this.extras).has(node); }

  reset(original: string, doc: DocumentNode): void {
    this.original = original; this.groups = []; this.extras = new WeakSet(); this.complete = true;
    for (let i = 0; i < doc.childCount; i++) {
      const node = doc.child(i), key = node.attrs.markdownRange as string | null;
      const match = key && /^(\d+):(\d+)$/.exec(key);
      if (!match) {
        if (node.type.name === "paragraph" && node.content.size === 0) this.extras.add(node);
        else this.complete = false;
        continue;
      }
      const from = Number(match[1]), to = Number(match[2]);
      if (from > to || to > original.length) { this.complete = false; continue; }
      const previous = this.groups[this.groups.length - 1];
      if (previous?.key === key) previous.nodes.push(node);
      else {
        if (previous && previous.to > from) this.complete = false;
        this.groups.push({ key, from, to, nodes: [node] });
      }
    }
    this.contexts.set(doc, { original: this.original, groups: this.groups, extras: this.extras, complete: this.complete });
    this.ranges.set(doc, this.groups.flatMap(group => group.nodes.map(node => ({ node, from: group.from, to: group.to }))));
  }

  render(doc: DocumentNode, serialize: (node: DocumentNode) => string): string {
    const context = this.contexts.get(doc);
    if (context) {
      this.original = context.original; this.groups = context.groups; this.extras = context.extras; this.complete = context.complete;
    }
    const finish = (text: string, ranges: SourceRange[]) => {
      const markers: number[] = [];
      for (let at=text.indexOf(EMPTY_PARAGRAPH);at>=0;at=text.indexOf(EMPTY_PARAGRAPH,at+EMPTY_PARAGRAPH.length)) markers.push(at);
      const offset = (position: number) => position-markers.reduce((removed,at)=>removed+Math.min(EMPTY_PARAGRAPH.length,Math.max(0,position-at)),0);
      this.ranges.set(doc,ranges.map(range=>{
        let from=offset(range.from),to=offset(range.to);
        if(range.node.type.name === "paragraph" && !range.node.content.size && from===to) from=Math.max(0,from-2);
        return {...range,from,to};
      }));
      return markdownWhitespace(text);
    };
    const write = (nodes: DocumentNode[]) => {
      let text = ""; const ranges: SourceRange[] = [];
      for (const node of nodes) {
        const value = serialize(node); if (!value) continue;
        if (text) text += "\n\n";
        ranges.push({ node, from: text.length, to: text.length + value.length }); text += value;
      }
      return { text, ranges };
    };
    const canonical = () => {
      const nodes: DocumentNode[] = []; doc.forEach(node => nodes.push(node));
      const result = write(nodes); return finish(result.text,result.ranges);
    };
    if (!this.complete || !this.groups.length) return canonical();
    const originals = new Map(this.groups.map((group) => [group.key, group]));
    const current: CurrentGroup[] = [];
    let previousOffset = -1;
    const seen = new Set<string>();
    for (let i = 0; i < doc.childCount; i++) {
      const node = doc.child(i);
      if (this.extras.has(node)) continue;
      const key = originals.has(node.attrs.markdownRange) ? node.attrs.markdownRange as string : null;
      const previous = current[current.length - 1];
      if (previous && previous.key === key) previous.nodes.push(node);
      else {
        if (key) {
          const origin = originals.get(key)!;
          if (seen.has(key) || origin.from < previousOffset) return canonical();
          seen.add(key); previousOffset = origin.from;
        }
        current.push({ key, nodes: [node] });
      }
    }
    const present = new Map(current.filter((group) => group.key).map((group) => [group.key!, group]));
    const patches: Patch[] = [];
    const unchanged: SourceRange[] = [];
    for (const origin of this.groups) {
      const now = present.get(origin.key);
      const legacyHtml = /^\s*<(?:table\b|p>\s*<\/p>)/i.test(this.original.slice(origin.from,origin.to));
      if (!legacyHtml && now && now.nodes.length === origin.nodes.length && now.nodes.every((node, i) => node.eq(origin.nodes[i]))) {
        unchanged.push(...now.nodes.map(node => ({ node, from: origin.from, to: origin.to }))); continue;
      }
      let result = write(now?.nodes || []);
      if (now?.nodes.length === 1 && origin.nodes.length === 1) {
        const text = patchListText(origin.nodes[0], now.nodes[0], this.original.slice(origin.from,origin.to), serialize);
        if (text !== null) result = { text, ranges: [{ node: now.nodes[0], from: 0, to: text.length }] };
      }
      // Enter can give new siblings the same origin attribute. Keep the original
      // paragraph's raw wrapping when its content itself was not edited.
      const kept = now?.nodes.findIndex((_node, index) => origin.nodes.every((old, offset) => now.nodes[index + offset]?.eq(old))) ?? -1;
      if (!legacyHtml && now && kept >= 0) {
        const before = write(now.nodes.slice(0, kept)), after = write(now.nodes.slice(kept + origin.nodes.length));
        const raw = this.original.slice(origin.from, origin.to), prefix = before.text ? before.text + "\n\n" : "";
        const separator = after.text ? "\n".repeat(Math.max(0, 2 - (raw.match(/\n*$/)?.[0].length || 0))) : "";
        const offset = prefix.length + raw.length + separator.length;
        result = { text: prefix + raw + separator + after.text, ranges: [...before.ranges,
          ...origin.nodes.map((_node, i) => ({ node: now.nodes[kept + i], from: prefix.length, to: prefix.length + raw.length })),
          ...after.ranges.map(range => ({ ...range, from: range.from + offset, to: range.to + offset }))] };
      }
      let replacement = result.text;
      if (replacement && this.original.slice(origin.from, origin.to).endsWith("\n") && !replacement.endsWith("\n") && (!replacement.endsWith(EMPTY_PARAGRAPH) || legacyHtml || origin.to < this.original.length)) replacement += "\n";
      patches.push({ from: origin.from, to: origin.to, text: replacement, ranges: result.ranges });
    }
    current.forEach((group, index) => {
      if (group.key) return;
      const previous = current.slice(0, index).reverse().find((entry) => entry.key);
      const next = current.slice(index + 1).find((entry) => entry.key);
      const position = previous ? originals.get(previous.key!)!.to : next ? originals.get(next.key!)!.from : this.original.length;
      const result = write(group.nodes), text = result.text;
      if (!text) return;
      const prefix = position === 0 ? "" : this.original.slice(0, position).endsWith("\n") ? "\n" : "\n\n";
      const suffix = position === this.original.length ? this.original.endsWith("\n") && !text.endsWith(EMPTY_PARAGRAPH) ? "\n" : "" : this.original.slice(position).startsWith("\n") ? "\n" : "\n\n";
      patches.push({ from: position, to: position, text: prefix + text + suffix,
        ranges: result.ranges.map(range => ({ ...range, from: range.from + prefix.length, to: range.to + prefix.length })) });
    });
    let output = "", cursor = 0; const ranges: SourceRange[] = [];
    const copy = (to: number) => {
      const offset = output.length - cursor;
      for (const range of unchanged) if (range.from >= cursor && range.to <= to) ranges.push({ ...range, from: range.from + offset, to: range.to + offset });
      output += this.original.slice(cursor, to); cursor = to;
    };
    for (const patch of patches.sort((a, b) => a.from - b.from || a.to - b.to)) {
      copy(patch.from); const offset = output.length;
      output += patch.text; ranges.push(...patch.ranges.map(range => ({ ...range, from: range.from + offset, to: range.to + offset }))); cursor = patch.to;
    }
    copy(this.original.length); return finish(output,ranges);
  }
}
