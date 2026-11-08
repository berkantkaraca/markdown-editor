import { StateEffect, StateField, RangeSet, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet as SourceDecorations, EditorView, gutter, GutterMarker } from "@codemirror/view";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { changesForSide, diffHunks, gitLines, characterChanges, changeForRange, type GitChangeKind } from "../shared/git-diff";
import { t } from "./i18n";
import { listSource } from "../shared/list-source";

export const gitTitle = (kind: GitChangeKind): string => t(kind === "added" ? "Git: Eklenen" : kind === "modified" ? "Git: Değişen" : "Git: Silinen");
export const richGitKey = new PluginKey<DecorationSet>("gitChanges");
export const richGitPlugin = () => new Plugin({
  key: richGitKey,
  state: { init: () => DecorationSet.empty, apply: (tr, previous) => tr.getMeta(richGitKey) ?? previous.map(tr.mapping, tr.doc) },
  props: { decorations: state => richGitKey.getState(state) },
});
class GitMarker extends GutterMarker {
  readonly label: string;
  constructor(readonly kind: GitChangeKind) { super(); this.label = gitTitle(kind); }
  eq(other: GitMarker): boolean { return this.kind === other.kind && this.label === other.label; }
  toDOM(): HTMLElement {
    const mark = document.createElement("span"); mark.className = `git-gutter-mark git-${this.kind}`;
    mark.title = this.label; mark.setAttribute("aria-label", this.label); return mark;
  }
}
export const gitBaseEffect = StateEffect.define<{ text: string; comparison: boolean; originalSide: boolean }>();
class GitSpacer extends GutterMarker { toDOM(): HTMLElement { return document.createElement("span"); } }
const sourceGitField = StateField.define<{
  base: string; comparison: boolean; originalSide: boolean; markers: RangeSet<GutterMarker>; decorations: SourceDecorations;
}>({
  create: () => ({ base: "", comparison: false, originalSide: false, markers: RangeSet.empty, decorations: Decoration.none }),
  update(previous, tr) {
    let { base, comparison, originalSide } = previous;
    let changed = tr.docChanged;
    for (const effect of tr.effects) if (effect.is(gitBaseEffect)) {
      base = effect.value.text;
      comparison = effect.value.comparison;
      originalSide = effect.value.originalSide;
      changed = true;
    }
    if (!changed) return previous;
    const original = gitLines(base);
    const decorations: Range<Decoration>[] = [];
    const markers = changesForSide(base, tr.newDoc.toString(), originalSide).flatMap(hunk => {
      const ranges = [];
      for (let i = hunk.from; i < Math.max(hunk.to, hunk.from + 1); i++) {
        const line = tr.newDoc.line(Math.min(i + 1, tr.newDoc.lines));
        ranges.push(new GitMarker(hunk.kind).range(line.from));
        if (!comparison || hunk.kind === "deleted") continue;
        decorations.push(Decoration.line({ class: "comparison-line" }).range(line.from));
        if (hunk.kind !== "modified") continue;
        const before = original[hunk.originalFrom + i - hunk.from];
        // Keep the work per line bounded on large, generated Markdown documents.
        if (before.length + line.length > 2000) continue;
        const tokens = /[\p{L}\p{M}\p{N}_]+|\s+|[^\p{L}\p{M}\p{N}_\s]/gu;
        const beforeWords = before.match(tokens) ?? [];
        const afterWords = Array.from(line.text.matchAll(tokens));
        for (const word of diffHunks(beforeWords, afterWords.map(match => match[0]))) {
          if (word.from === word.to) continue;
          const from = afterWords[word.from].index;
          const to = afterWords[word.to]?.index ?? line.length;
          decorations.push(Decoration.mark({ class: "comparison-inline" }).range(line.from + from, line.from + to));
        }
      }
      return ranges;
    });
    return { base, comparison, originalSide, markers: RangeSet.of(markers, true), decorations: Decoration.set(decorations, true) };
  },
});
export const sourceGitExtensions = [
  sourceGitField,
  EditorView.decorations.from(sourceGitField, value => value.decorations),
  gutter({ class: "git-source-gutter", markers: view => view.state.field(sourceGitField).markers,
    initialSpacer: () => new GitSpacer() }),
];

export function decorateGitPreview(root: HTMLElement, base: string | null, text: string, originalSide = false): void {
  root.querySelectorAll<HTMLElement>(".git-added,.git-modified,.git-deleted").forEach(element => {element.classList.remove("git-added", "git-modified", "git-deleted", "git-joined");element.style.removeProperty("--git-gap");});
  root.querySelectorAll(".git-deleted-point").forEach(element => element.remove());
  if (base === null) return;
  const changes=characterChanges(base,text,originalSide);
  const blocks = Array.from(root.children).filter(element => element.hasAttribute("data-md-range"));
  for(const block of blocks){if(block.matches("ul,ol"))continue;const [from,to]=block.getAttribute("data-md-range")!.split(":").map(Number);const kind=changeForRange(changes,from,to);if(kind)block.classList.add(`git-${kind}`);}
  const items = listSource(text).items;
  root.querySelectorAll("li").forEach((item,index) => {
    const source = items[index]; if (!source) return;
    const kinds = source.own.map(range => changeForRange(changes,range.from,range.to));
    const kind = kinds.includes("modified") ? "modified" : kinds.includes("added") ? "added" : null;
    if (kind) item.classList.add(`git-${kind}`);
  });
  for (const hunk of changes) {
    const from = hunk.from;
    if (hunk.kind === "deleted") {
      const target = blocks.find(block => Number(block.getAttribute("data-md-range")!.split(":")[1]) > from);
      const point = document.createElement("span"); point.className = "git-deleted-point"; point.title = gitTitle("deleted");
      if (target) root.insertBefore(point, target); else root.appendChild(point);
    }
  }
  for(const block of root.querySelectorAll(".git-added,.git-modified")){const next=block.nextElementSibling; if(!(block instanceof HTMLElement)||!(next instanceof HTMLElement))continue;
    if(["git-added","git-modified"].some(kind=>block.classList.contains(kind)&&next.classList.contains(kind))){block.classList.add("git-joined");block.style.setProperty("--git-gap",`${Math.max(0,next.getBoundingClientRect().top-block.getBoundingClientRect().bottom)}px`);}}
}
