// Extension <-> webview mesaj protokolü: sürüm + gönderim tek noktada.
// Tüm giden mesajlar proto alanı taşır; bilinmeyen sürümler alıcıda yoksayılır.
export const PROTO = 1;

export type OutMsg = Record<string, unknown>;

export interface EditorHost<State> {
  postMessage(message: unknown): void;
  getState(): State | undefined;
  setState(state: State): void;
}

export interface BrowserEditorHost extends EditorHost<{ mode?: string }> {
  connect(actions: {
    receive(message: OutMsg): void;
    prepare(): string | undefined;
    replace(text: string, version: number): void;
    reveal(line: number): void;
  }): void;
}

declare global {
  interface Window { __karacaBrowserHost?: BrowserEditorHost }
}

export function createPoster(postMessage: (msg: unknown) => void): (msg: OutMsg) => void {
  return (msg) => postMessage({ proto: PROTO, ...msg });
}
