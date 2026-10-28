declare module "*.html" { const content: string; export default content; }
declare module "*.css" {
  const content: string;
  export default content;
}
declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";
  export function gfm(service: TurndownService): void;
  export function strikethrough(service: TurndownService): void;
  export function tables(service: TurndownService): void;
  export function taskListItems(service: TurndownService): void;
}
declare module "markdown-it-texmath" {
  import MarkdownIt from "markdown-it";
  const plugin: (md: InstanceType<typeof MarkdownIt>, options?: Record<string, unknown>) => void;
  export default plugin;
}
declare module "markdown-it-task-lists" {
  import MarkdownIt from "markdown-it";
  const plugin: (md: InstanceType<typeof MarkdownIt>, options?: Record<string, unknown>) => void;
  export default plugin;
}
