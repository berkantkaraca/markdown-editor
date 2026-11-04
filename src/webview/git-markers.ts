import { StateEffect, StateField, RangeSet } from "@codemirror/state";
import { gutter, GutterMarker } from "@codemirror/view";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { lineChanges, characterChanges, changeForRange, type GitChangeKind } from "../shared/git-diff";
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
export const gitBaseEffect = StateEffect.define<string>();
class GitSpacer extends GutterMarker { toDOM(): HTMLElement { return document.createElement("span"); } }
const sourceGitField = StateField.define<{ base: string; markers: RangeSet<GutterMarker> }>({
  create: () => ({ base: "", markers: RangeSet.empty }),
  update(previous, tr) {
    let base = previous.base, changed = tr.docChanged;
    for (const effect of tr.effects) if (effect.is(gitBaseEffect)) { base = effect.value; changed = true; }
    if (!changed) return previous;
    const markers = lineChanges(base, tr.newDoc.toString()).flatMap(hunk => {
      const ranges = [];
      for (let i = hunk.from; i < Math.max(hunk.to, hunk.from + 1); i++) {
        const line = tr.newDoc.line(Math.min(i + 1, tr.newDoc.lines));
        ranges.push(new GitMarker(hunk.kind).range(line.from));
      }
      return ranges;
    });
    return { base, markers: RangeSet.of(markers, true) };
  },
});
export const sourceGitExtensions = [sourceGitField, gutter({ class: "git-source-gutter", markers: view => view.state.field(sourceGitField).markers,
  initialSpacer: () => new GitSpacer() })];

export function decorateGitPreview(root: HTMLElement, base: string | null, text: string): void {
  root.querySelectorAll<HTMLElement>(".git-added,.git-modified,.git-deleted").forEach(element => {element.classList.remove("git-added", "git-modified", "git-deleted", "git-joined");element.style.removeProperty("--git-gap");});
  root.querySelectorAll(".git-deleted-point").forEach(element => element.remove());
  if (base === null) return;
  const changes=characterChanges(base,text);
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
