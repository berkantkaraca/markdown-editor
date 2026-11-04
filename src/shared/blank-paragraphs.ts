// An intermediate serialization token, never written to a Markdown file.
export const EMPTY_PARAGRAPH = "\u0000empty-paragraph\u0000";
export const markdownWhitespace = (text: string): string => text.split(EMPTY_PARAGRAPH).join("");
