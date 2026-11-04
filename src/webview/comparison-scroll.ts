export interface ScrollBlock { key: string; top: number; height: number }
export interface ScrollSurface { container: HTMLElement; blocks(): ScrollBlock[] }
export function scrollKey(text: string): string {
  text = text.trim().replace(/\s+/g, " ");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${hash >>> 0}`;
}
export interface ScrollPosition { progress: number; anchors: { key: string; occurrence: number; offset: number; fraction: number | null }[] }
export function captureScroll(surface: ScrollSurface): ScrollPosition {
  const top = surface.container.getBoundingClientRect().top, occurrences = new Map<string, number>();
  const blocks = surface.blocks().map(block => {
    const occurrence = occurrences.get(block.key) || 0; occurrences.set(block.key, occurrence + 1);
    return { ...block, occurrence, offset: block.top - top };
  });
  let index = blocks.findIndex(block => block.offset + block.height > 0); if (index < 0) index = blocks.length - 1;
  const anchors = blocks.slice(Math.max(0, index - 3), index + 5).sort((a,b) => Math.abs(a.offset)-Math.abs(b.offset)).map(block => ({
    key: block.key, occurrence: block.occurrence, offset: block.offset,
    fraction: block.offset <= 0 && block.offset + block.height > 0 ? -block.offset / Math.max(1,block.height) : null,
  }));
  return { progress: surface.container.scrollTop / Math.max(1, surface.container.scrollHeight - surface.container.clientHeight), anchors };
}
function scrollTarget(surface: ScrollSurface, position: ScrollPosition): number {
  const occurrences = new Map<string,number>(), blocks = new Map<string,ScrollBlock>();
  for (const block of surface.blocks()) {
    const occurrence = occurrences.get(block.key) || 0; occurrences.set(block.key, occurrence+1);
    blocks.set(`${block.key}/${occurrence}`,block);
  }
  const top = surface.container.getBoundingClientRect().top;
  for (const anchor of position.anchors) {
    const block = blocks.get(`${anchor.key}/${anchor.occurrence}`); if (!block) continue;
    return surface.container.scrollTop + block.top - top - (anchor.fraction === null ? anchor.offset : -anchor.fraction * block.height);
  }
  return position.progress * Math.max(0,surface.container.scrollHeight-surface.container.clientHeight);
}
const animations = new WeakMap<HTMLElement, number>();
export function cancelScroll(container: HTMLElement): void {
  const frame = animations.get(container);
  if (frame !== undefined) cancelAnimationFrame(frame);
  animations.delete(container);
}
export function applyScroll(surface: ScrollSurface, position: ScrollPosition, changed: (top: number) => void): void {
  const container = surface.container;
  cancelScroll(container);
  const start = container.scrollTop;
  const target = Math.max(0,Math.min(container.scrollHeight-container.clientHeight,scrollTarget(surface,position)));
  const began = performance.now();
  const tick = () => {
    const fraction = Math.min(1,(performance.now()-began)/80);
    container.scrollTop = start+(target-start)*(1-Math.pow(1-fraction,3));
    changed(container.scrollTop);
    if(fraction<1) animations.set(container,requestAnimationFrame(tick));
    else animations.delete(container);
  };
  animations.set(container,requestAnimationFrame(tick));
}
