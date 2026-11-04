import { normalizeNewlines } from "./md-utils";
export type GitChangeKind = "added" | "modified" | "deleted";
export interface GitHunk { from: number; to: number; kind: GitChangeKind }
function changes(from: number, inserted: number, deleted: number): GitHunk[] {
  const paired = Math.min(inserted, deleted), hunks: GitHunk[] = [];
  if (paired) hunks.push({ from, to: from + paired, kind: "modified" });
  if (inserted > paired) hunks.push({ from: from + paired, to: from + inserted, kind: "added" });
  if (deleted > paired) hunks.push({ from: from + inserted, to: from + inserted, kind: "deleted" });
  return hunks;
}

// Bounded Myers diff. Prefix/suffix trimming keeps ordinary typing cheap even
// in large documents; unrelated huge replacements fall back to one hunk.
export function diffSequence(before: readonly string[], after: readonly string[]): GitHunk[] {
  let start = 0, aEnd = before.length, bEnd = after.length;
  while (start < aEnd && start < bEnd && before[start] === after[start]) start++;
  while (aEnd > start && bEnd > start && before[aEnd - 1] === after[bEnd - 1]) { aEnd--; bEnd--; }
  const a = before.slice(start, aEnd), b = after.slice(start, bEnd);
  if (!a.length && !b.length) return [];
  const coarse = (): GitHunk[] => changes(start, b.length, a.length);
  if (!a.length || !b.length) return coarse();
  const trace: Map<number, number>[] = [], v = new Map<number, number>([[1, 0]]);
  let work = 0;
  for (let d = 0; d <= a.length + b.length; d++) {
    if (work + v.size > 500_000) return coarse();
    trace.push(new Map(v)); work += v.size;
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1) ? v.get(k + 1) ?? 0 : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++; if (++work > 1_000_000) return coarse(); }
      v.set(k, x);
      if (x < a.length || y < b.length) continue;
      const edits: ("equal" | "insert" | "delete")[] = [];
      for (let depth = trace.length - 1; depth >= 0; depth--) {
        const previous = trace[depth], diagonal = x - y;
        const previousK = diagonal === -depth || diagonal !== depth && (previous.get(diagonal - 1) ?? -1) < (previous.get(diagonal + 1) ?? -1) ? diagonal + 1 : diagonal - 1;
        const previousX = previous.get(previousK) ?? 0, previousY = previousX - previousK;
        while (x > previousX && y > previousY) { edits.push("equal"); x--; y--; }
        if (depth > 0) { if (x === previousX) { edits.push("insert"); y--; } else { edits.push("delete"); x--; } }
      }
      edits.reverse();
      const hunks: GitHunk[] = []; let line = start, from = line, inserted = 0, deleted = 0;
      const flush = () => {
        hunks.push(...changes(from, inserted, deleted));
        inserted = deleted = 0; from = line;
      };
      for (const edit of edits) {
        if (edit === "equal") { flush(); line++; from = line; }
        else if (edit === "insert") { inserted++; line++; }
        else deleted++;
      }
      flush(); return hunks;
    }
  }
  return coarse();
}
export function gitLines(text: string): string[] { return text === "" ? [] : normalizeNewlines(text).split("\n"); }
export function lineChanges(base: string, text: string): GitHunk[] { return diffSequence(gitLines(base), gitLines(text)); }
export function characterChanges(base: string, text: string): GitHunk[] {
  const offsets = [0]; for (let i = 0; i < text.length; i++) if (text[i] === "\n") offsets.push(i + 1);
  return lineChanges(base, text).map(hunk => ({ ...hunk, from: offsets[hunk.from] ?? text.length, to: offsets[hunk.to] ?? text.length }));
}
export function changeForRange(changes: GitHunk[], from: number, to: number): GitChangeKind | null {
  let kind: GitChangeKind | null = null;
  for (const change of changes) if (change.kind !== "deleted" && change.to > from && change.from < to) {
    if (change.kind === "modified") return "modified"; kind = "added";
  }
  return kind;
}
