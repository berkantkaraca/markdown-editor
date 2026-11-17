import { t } from "./i18n";

const zoomLevels = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5];

export function attachImagePreview(roots: HTMLElement[]) {
  const dialog = document.createElement("dialog");
  dialog.className = "image-preview";
  dialog.setAttribute("aria-labelledby", "image-preview-title");
  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.id = "image-preview-title";
  const controls = document.createElement("div");
  controls.className = "image-preview-controls";
  const zoomOut = document.createElement("button");
  const reset = document.createElement("button");
  const zoomIn = document.createElement("button");
  const close = document.createElement("button");
  for (const [button, text] of [[zoomOut, "−"], [reset, "100%"], [zoomIn, "+"], [close, "×"]] as const) {
    button.type = "button";
    button.textContent = text;
    controls.append(button);
  }
  reset.className = "image-preview-percent";
  close.autofocus = true;
  header.append(title, controls);
  const viewport = document.createElement("div");
  viewport.className = "image-preview-viewport";
  viewport.tabIndex = 0;
  viewport.setAttribute("role", "region");
  const stage = document.createElement("div");
  stage.className = "image-preview-stage";
  const large = document.createElement("img");
  large.draggable = false;
  large.hidden = true;
  stage.append(large);
  viewport.append(stage);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.hidden = true;
  dialog.append(header, viewport, status);
  document.body.append(dialog);

  let trigger: HTMLImageElement | undefined;
  let level = 0;
  let drag: { id: number; x: number; y: number; left: number; top: number } | undefined;

  function label(button: HTMLButtonElement, message: string): void {
    button.setAttribute("aria-label", message);
    button.title = message;
  }

  function updateControls(): void {
    const percentage = `${Math.round(zoomLevels[level] * 100)}%`;
    reset.textContent = percentage;
    reset.setAttribute("aria-label", `${t("Görseli ekrana sığdır")} · ${percentage}`);
    zoomOut.disabled = reset.disabled = large.hidden || level === 0;
    zoomIn.disabled = large.hidden || level === zoomLevels.length - 1;
  }

  function sizeImage(): void {
    if (large.hidden || !large.naturalWidth || !large.naturalHeight) return;
    const fit = Math.min(viewport.offsetWidth / large.naturalWidth, viewport.offsetHeight / large.naturalHeight);
    large.style.width = `${large.naturalWidth * fit * zoomLevels[level]}px`;
    viewport.classList.toggle("zoomed", level > 0);
  }

  function setZoom(next: number, point?: { x: number; y: number }): void {
    if (large.hidden || next === level || next < 0 || next >= zoomLevels.length) return;
    const box = viewport.getBoundingClientRect();
    const { x, y } = point ?? { x: box.left + viewport.clientWidth / 2, y: box.top + viewport.clientHeight / 2 };
    const before = large.getBoundingClientRect();
    const rx = Math.max(0, Math.min(1, (x - before.left) / before.width));
    const ry = Math.max(0, Math.min(1, (y - before.top) / before.height));
    level = next;
    sizeImage();
    const after = large.getBoundingClientRect();
    viewport.scrollBy(after.left + rx * after.width - x, after.top + ry * after.height - y);
    updateControls();
  }

  function mark(image: HTMLImageElement): void {
    const label = image.alt ? `${t("Görseli büyüt")} · ${image.alt}` : t("Görseli büyüt");
    if (!image.hasAttribute("data-image-preview")) {
      image.dataset.imagePreview = "";
      image.tabIndex = 0;
      image.setAttribute("role", "button");
    }
    if (image.getAttribute("aria-label") !== label) image.setAttribute("aria-label", label);
  }

  function localize(): void {
    title.textContent = t("Görsel önizleme");
    label(close, t("Kapat"));
    label(zoomIn, t("Yakınlaştır"));
    label(zoomOut, t("Uzaklaştır"));
    reset.title = t("Görseli ekrana sığdır");
    viewport.setAttribute("aria-label", t("Görsel alanı"));
    updateControls();
    status.textContent = t("Görsel yüklenemedi.");
    for (const root of roots) root.querySelectorAll<HTMLImageElement>("img[data-image-preview]").forEach(mark);
  }

  function open(event: MouseEvent | KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const url = image.currentSrc || image.src;
    if (!url || dialog.open) return;
    event.preventDefault();
    event.stopPropagation();
    mark(image);
    trigger = image;
    large.alt = image.alt;
    large.hidden = true;
    level = 0;
    viewport.hidden = false;
    viewport.classList.remove("zoomed");
    viewport.scrollTo(0, 0);
    updateControls();
    status.hidden = true;
    large.src = url;
    dialog.showModal();
  }

  for (const root of roots) {
    root.addEventListener("click", event => { if (event.button === 0) open(event); }, true);
    root.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") open(event); }, true);
  }
  zoomOut.addEventListener("click", () => setZoom(level - 1));
  reset.addEventListener("click", () => setZoom(0));
  zoomIn.addEventListener("click", () => setZoom(level + 1));
  viewport.addEventListener("wheel", event => {
    if (event.ctrlKey || event.metaKey || !event.deltaY || large.hidden) return;
    event.preventDefault();
    setZoom(level + (event.deltaY < 0 ? 1 : -1), { x: event.clientX, y: event.clientY });
  }, { passive: false });
  stage.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.pointerType === "touch" || level === 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    stage.setPointerCapture(event.pointerId);
    viewport.classList.add("dragging");
  });
  stage.addEventListener("pointermove", event => {
    if (event.pointerId === drag?.id) {
      viewport.scrollTo(drag.left + drag.x - event.clientX, drag.top + drag.y - event.clientY);
    }
  });
  stage.addEventListener("lostpointercapture", () => {
    drag = undefined;
    viewport.classList.remove("dragging");
  });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(sizeImage).observe(viewport);
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    large.hidden = true;
    large.removeAttribute("src");
    trigger?.focus({ preventScroll: true });
    trigger = undefined;
  });
  large.addEventListener("load", () => {
    if (!dialog.open) return;
    large.hidden = false;
    sizeImage();
    updateControls();
  });
  large.addEventListener("error", () => {
    large.hidden = true;
    viewport.hidden = true;
    status.hidden = false;
    updateControls();
  });
  localize();
  return { localize, mark };
}
