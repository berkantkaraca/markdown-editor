// Extension <-> webview mesaj protokolü: sürüm + gönderim tek noktada.
// Tüm giden mesajlar proto alanı taşır; bilinmeyen sürümler alıcıda yoksayılır.
export const PROTO = 1;

export type OutMsg = Record<string, unknown>;

export function createPoster(postMessage: (msg: unknown) => void): (msg: OutMsg) => void {
  return (msg) => postMessage({ proto: PROTO, ...msg });
}
