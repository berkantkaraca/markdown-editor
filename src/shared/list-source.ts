import { createMarkdown } from "./md-pipeline";
import { parseFrontmatter } from "./md-utils";

const markdown = createMarkdown();
export interface ListSourceRange { from: number; to: number; own: { from: number; to: number }[] }
type ListSource = { items: ListSourceRange[]; paragraphs: { from: number; to: number }[] };
let cachedText: string | undefined, cachedResult: ListSource;
// Markdown line maps retain the user's list markers, indentation and blank lines.
export function listSource(text: string): ListSource {
  if (cachedText === text) return cachedResult;
  const result = parseListSource(text); cachedText = text; cachedResult = result; return result;
}
function parseListSource(text: string): ListSource {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") offsets.push(i + 1);
  const baseLine = parseFrontmatter(text)?.endLine || 0;
  const tokens = markdown.parse(text.slice(offsets[baseLine] || 0), {});
  const range = (map: [number, number]) => ({ from: offsets[map[0]+baseLine] ?? text.length, to: offsets[map[1]+baseLine] ?? text.length });
  const nestedLists = tokens.filter(token => token.map && token.level > 0 && /^(bullet|ordered)_list_open$/.test(token.type)).map(token => ({ ...range(token.map!), level: token.level }));
  return {
    paragraphs: tokens.filter(token => token.type === "paragraph_open" && token.map).map(token => range(token.map!)),
    items: tokens.filter(token => token.type === "list_item_open" && token.map).map(token => {
      const item = range(token.map!); let cursor = item.from;
      const own: { from: number; to: number }[] = [];
      for (const nested of nestedLists.filter(list => list.level > token.level && list.from >= item.from && list.to <= item.to).sort((a,b) => a.from-b.from)) {
        if (nested.from > cursor) own.push({ from: cursor, to: nested.from });
        cursor = Math.max(cursor, nested.to);
      }
      if (cursor < item.to) own.push({ from: cursor, to: item.to });
      return { ...item, own };
    }),
  };
}
