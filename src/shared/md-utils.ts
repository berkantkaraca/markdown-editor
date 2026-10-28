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
      src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
    }
    return new RegExp(src, opts.caseSensitive ? "gu" : "giu");
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

export const setHeadingLevel =
  (n: number) =>
  (t: string): string | null => {
    if (t.trim() === "") {
      return null;
    }
    const level = Math.min(6, Math.max(1, n));
    return `${"#".repeat(level)} ${t.replace(/^(#{1,6}\s+)/, "")}`;
  };

// Enter'a basılan satır liste öğesiyse ne yapılacağı (canlı kutu + kaynak modu).
// İşaret arkasında boşluk/EOL şartı aranır ("1.2.3" gibi metinler yakalanmaz).
export interface ListEnterResult {
  kind: "none" | "continue" | "exit" | "outdent";
  marker?: string;
}

export function listEnterAction(line: string): ListEnterResult {
  const m = line.match(/^([ \t]*)((?:[-*+])|(\d+)([.)]))(?=\s|$)((?:[ \t]+\[[ xX]\])?)(.*)$/);
  if (!m) {
    return { kind: "none" };
  }
  const indent = m[1];
  const num = m[3];
  const delim = m[4];
  const task = m[5] ?? "";
  const rest = m[6] ?? "";
  if (rest.trim() === "") {
    if (indent === "") {
      return { kind: "exit" };
    }
    return { kind: "outdent" };
  }
  let mark = m[2];
  if (num !== undefined) {
    mark = `${parseInt(num, 10) + 1}${delim}`;
  }
  const taskBox = task ? task.replace(/\[x\]/i, "[ ]") : "";
  return { kind: "continue", marker: `${indent}${mark}${taskBox} ` };
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- Üç-yönlü satır birleştirme (çakışan yazımlarda veri kaybını önler) ----------

export interface TextHunk {
  start: number;
  end: number; // [start, end) aralığı lines ile değişir
  lines: string[];
}

// İki metin arasındaki TEK blokluk farkı bulur (önek+sonek kırpma).
function diffHunk(oldLines: string[], newLines: string[]): TextHunk {
  let s = 0;
  while (s < oldLines.length && s < newLines.length && oldLines[s] === newLines[s]) {
    s++;
  }
  let eOld = oldLines.length;
  let eNew = newLines.length;
  while (eOld > s && eNew > s && oldLines[eOld - 1] === newLines[eNew - 1]) {
    eOld--;
    eNew--;
  }
  return { start: s, end: eOld, lines: newLines.slice(s, eNew) };
}

/**
 * Üç-yönlü birleştirme: base ortak ata, current diskteki, incoming gelen.
 * İki taraf farklı satırlara dokunduysa birleşir; çakışırsa null döner.
 * DÖNER: birleşmiş metin | null (çakışma)
 */
export function mergeTexts(base: string, current: string, incoming: string): string | null {
  if (incoming === current) {
    return current;
  }
  if (incoming === base) {
    return current;
  }
  if (current === base) {
    return incoming;
  }
  const b = base.split("\n");
  const hC = diffHunk(b, current.split("\n"));
  const hI = diffHunk(b, incoming.split("\n"));
  // Replacements on adjacent lines do not overlap. Insertions at the same
  // boundary remain ambiguous and must be reported as conflicts.
  const insertion = hC.start === hC.end || hI.start === hI.end;
  const overlap = insertion
    ? hC.start <= hI.end && hI.start <= hC.end
    : hC.start < hI.end && hI.start < hC.end;
  if (overlap) {
    return null;
  }
  const out = b.slice();
  const ordered = [hC, hI].sort((x, y) => y.start - x.start);
  for (const h of ordered) {
    out.splice(h.start, h.end - h.start, ...h.lines);
  }
  return out.join("\n");
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
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
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
  const body =
    rows || '<div class="fm-row"><span class="fm-val"></span></div>';
  return `<div class="frontmatter" contenteditable="false" data-raw="${escapeHtml(fm.raw)}">${body}</div>`;
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

// Source metadata is URI encoded so sanitizers never interpret Mermaid arrows.
export function decodeSource(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
