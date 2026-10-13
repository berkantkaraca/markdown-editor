// Saf yardımcılar: DOM ve vscode API'sinden bağımsızdır.
// `npm test` (node --test) ile doğrudan test edilir.

export interface FindOpts {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export function buildFindRegex(query: string, opts: FindOpts): RegExp | null {
  if (!query) {
    return null;
  }
  try {
    let src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (opts.wholeWord) {
      src = `\\b(?:${src})\\b`;
    }
    return new RegExp(src, opts.caseSensitive ? "g" : "gi");
  } catch {
    return null; // hatalı ifade
  }
}

export const togglePrefix =
  (p: string) =>
  (t: string): string | null => {
    if (t.trim() === "") {
      return null;
    }
    return t.startsWith(p) ? t.slice(p.length) : p + t;
  };

export function toggleTaskLine(t: string): string | null {
  if (t.trim() === "") {
    return null;
  }
  const m = t.match(/^(\s*)(- \[[ xX]\] |- )(.*)$/);
  if (!m) {
    return `- [ ] ${t}`;
  }
  if (m[2] === "- ") {
    return `${m[1]}- [ ] ${m[3]}`;
  }
  return `${m[1]}- ${m[3]}`;
}

export function toggleHeadingLine(t: string): string | null {
  if (t.trim() === "") {
    return null;
  }
  const m = t.match(/^(#{1,6}\s+)/);
  if (m) {
    return t.slice(m[0].length);
  }
  return `## ${t}`;
}

// Düz paragraf mı? (tablo/liste/başlık/alıntı/kod değilse evet)
export function isParaLike(t: string): boolean {
  return !/^\s*(#{1,6}\s+|>\s?|\||`{3,}|~{3,}|\s*[-*+]\s+|\s*\d+[.)]\s+|\s{4,}|\t)/.test(t);
}

// Silinen satırlar yüzünden komşu paragraflar bitişmesin diye ayraç koru.
export function joinKeptLines(lines: string[], removed: boolean[]): string {
  const out: string[] = [];
  let removedBlankSince = false;
  for (let i = 0; i < lines.length; i++) {
    if (removed[i]) {
      if (lines[i].trim() === "") {
        removedBlankSince = true;
      }
      continue;
    }
    const cur = lines[i];
    if (
      out.length > 0 &&
      removedBlankSince &&
      cur.trim() !== "" &&
      out[out.length - 1].trim() !== "" &&
      isParaLike(out[out.length - 1]) &&
      isParaLike(cur)
    ) {
      out.push("");
    }
    out.push(cur);
    removedBlankSince = false;
  }
  return out.join("\n");
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- Tablo ----------

export function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) {
    s = s.slice(1);
  }
  if (s.endsWith("|")) {
    s = s.slice(0, -1);
  }
  return s.split("|");
}

export function joinCells(cells: string[]): string {
  return "| " + cells.map((c) => c.trim()).join(" | ") + " |";
}

function isSepCell(c: string): boolean {
  return /^:?-+:?$/.test(c.trim());
}

function isSepRow(l: string): boolean {
  const cells = splitCells(l);
  return cells.length > 0 && cells.every(isSepCell);
}

export function isTableBlock(source: string): boolean {
  const rows = source.split("\n").filter((l) => l.trim() !== "");
  if (rows.length < 2) {
    return false;
  }
  return rows[0].trim().startsWith("|") && isSepRow(rows[1]);
}

export type TableOp = "add-row" | "del-row" | "add-col" | "del-col";

export function editTable(source: string, op: TableOp): string | null {
  if (!isTableBlock(source)) {
    return null;
  }
  const lines = source.split("\n");
  const idx: number[] = [];
  lines.forEach((l, i) => {
    if (l.trim() !== "") {
      idx.push(i);
    }
  });
  if (idx.length < 2) {
    return null;
  }
  const out = lines.slice();
  const nCols = splitCells(lines[idx[0]]).length;
  if (nCols < 1) {
    return null;
  }
  if (op === "add-row") {
    out.splice(idx[idx.length - 1] + 1, 0, joinCells(new Array(nCols).fill("")));
  } else if (op === "del-row") {
    if (idx.length < 3) {
      return null;
    }
    out.splice(idx[idx.length - 1], 1);
  } else if (op === "add-col") {
    for (const i of idx) {
      const cells = splitCells(out[i]);
      cells.push(i === idx[1] ? "---" : "");
      out[i] = joinCells(cells);
    }
  } else {
    if (nCols < 2) {
      return null;
    }
    for (const i of idx) {
      const cells = splitCells(out[i]);
      cells.pop();
      out[i] = joinCells(cells);
    }
  }
  return out.join("\n");
}

// ---------- Ön madde (frontmatter) ----------

export interface Frontmatter {
  raw: string;
  endLine: number; // exclusive
  entries: Array<[string, string]>;
}

export function parseFrontmatter(text: string): Frontmatter | null {
  const lines = text.split("\n");
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return null;
  }
  let end = -1;
  for (let i = 1; i < Math.min(lines.length, 60); i++) {
    const t = lines[i].trim();
    if (t === "---" || t === "...") {
      end = i;
      break;
    }
  }
  if (end < 0) {
    return null;
  }
  const entries: Array<[string, string]> = [];
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (m) {
      entries.push([m[1], m[2].trim()]);
    }
  }
  return { raw: lines.slice(0, end + 1).join("\n"), endLine: end + 1, entries };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderFrontmatterHtml(fm: Frontmatter): string {
  const rows = fm.entries
    .map(
      ([k, v]) =>
        `<div class="fm-row"><span class="fm-key">${escapeHtml(k)}</span>` +
        `<span class="fm-val">${escapeHtml(v)}</span></div>`
    )
    .join("");
  return `<div class="frontmatter">${rows || '<div class="fm-row"><span class="fm-val">boş ön madde</span></div>'}</div>`;
}

// ---------- WikiLink ----------

export interface WikiLink {
  target: string;
  anchor: string;
  label: string;
}

export function parseWikilink(inner: string): WikiLink | null {
  const m = inner.match(/^([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?$/);
  if (!m) {
    return null;
  }
  const target = (m[1] ?? "").trim();
  const anchor = (m[2] ?? "").trim();
  const label = (m[3] ?? "").trim() || (anchor ? `${target}#${anchor}` : target);
  if (!target) {
    return null;
  }
  return { target, anchor, label };
}

export function fileNameForTarget(target: string): string {
  return target.endsWith(".md") ? target : `${target}.md`;
}

// ---------- Başlık satırı bulma ----------

export function findHeadingLine(text: string, anchor: string): number {
  const norm = (s: string) => s.trim().toLowerCase();
  const slug = (s: string) =>
    norm(s)
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-");
  const a = norm(anchor);
  const as = slug(anchor);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#{1,6}\s+(.*?)(\s+#+)?\s*$/);
    if (!m) {
      continue;
    }
    if (norm(m[1]) === a || slug(m[1]) === as) {
      return i;
    }
  }
  return -1;
}

export interface HeadingNode {
  label: string;
  line: number;
  level: number;
  children: HeadingNode[];
}

export function parseHeadings(text: string): HeadingNode[] {
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];
  text.split("\n").forEach((raw, i) => {
    const m = raw.match(/^(#{1,6})\s+(.*?)(\s+#+)?\s*$/);
    if (!m || !m[2].trim()) {
      return;
    }
    const node: HeadingNode = { label: m[2].trim(), line: i, level: m[1].length, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  });
  return roots;
}

// ---------- Görsel ----------

export function mimeToExt(mime: string): string | undefined {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/bmp":
      return "bmp";
    case "image/svg+xml":
      return "svg";
    default:
      return undefined;
  }
}
