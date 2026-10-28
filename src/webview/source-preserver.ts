import type { Node as DocumentNode } from "@tiptap/pm/model";

interface Group { key: string; from: number; to: number; nodes: DocumentNode[] }
interface CurrentGroup { key: string | null; nodes: DocumentNode[] }
interface Patch { from: number; to: number; text: string }

// Provenance is metadata on the single document, never a second editing surface.
// Untouched source ranges, whitespace and reference definitions stay byte-for-byte
// unchanged (within the document's normalized LF representation).
export class SourcePreserver {
  private original = "";
  private groups: Group[] = [];
  private extras = new WeakSet<DocumentNode>();
  private complete = false;
  private contexts = new WeakMap<DocumentNode, { original: string; groups: Group[]; extras: WeakSet<DocumentNode>; complete: boolean }>();
  inherit(before: DocumentNode, after: DocumentNode): void {
    const context = this.contexts.get(before);
    if (context && !this.contexts.has(after)) this.contexts.set(after, context);
  }

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
  }

  render(doc: DocumentNode, serialize: (node: DocumentNode) => string): string {
    const context = this.contexts.get(doc);
    if (context) {
      this.original = context.original; this.groups = context.groups; this.extras = context.extras; this.complete = context.complete;
    }
    const canonical = () => {
      const parts: string[] = []; doc.forEach((node) => parts.push(serialize(node)));
      return parts.filter(Boolean).join("\n\n");
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
    for (const origin of this.groups) {
      const now = present.get(origin.key);
      if (now && now.nodes.length === origin.nodes.length && now.nodes.every((node, i) => node.eq(origin.nodes[i]))) continue;
      let replacement = now ? now.nodes.map(serialize).filter(Boolean).join("\n\n") : "";
      if (replacement && this.original.slice(origin.from, origin.to).endsWith("\n") && !replacement.endsWith("\n")) replacement += "\n";
      patches.push({ from: origin.from, to: origin.to, text: replacement });
    }
    current.forEach((group, index) => {
      if (group.key) return;
      const previous = current.slice(0, index).reverse().find((entry) => entry.key);
      const next = current.slice(index + 1).find((entry) => entry.key);
      const position = previous ? originals.get(previous.key!)!.to : next ? originals.get(next.key!)!.from : this.original.length;
      const text = group.nodes.map(serialize).filter(Boolean).join("\n\n");
      if (!text) return;
      const prefix = position === 0 ? "" : this.original.slice(0, position).endsWith("\n") ? "\n" : "\n\n";
      const suffix = position === this.original.length ? this.original.endsWith("\n") ? "\n" : "" : this.original.slice(position).startsWith("\n") ? "\n" : "\n\n";
      patches.push({ from: position, to: position, text: prefix + text + suffix });
    });
    let output = this.original;
    for (const patch of patches.sort((a, b) => b.from - a.from || b.to - a.to)) output = output.slice(0, patch.from) + patch.text + output.slice(patch.to);
    return output;
  }
}
