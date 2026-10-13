declare module "*.css" {
  const content: string;
  export default content;
}
declare module "markdown-it-texmath" {
  import { PluginWithOptions } from "markdown-it";
  const plugin: PluginWithOptions;
  export default plugin;
}
declare module "markdown-it-task-lists" {
  import { PluginSimple } from "markdown-it";
  const plugin: PluginSimple;
  export default plugin;
}
