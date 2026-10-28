import { t } from "./i18n";
// A compact size picker shared by Live and Source toolbar commands.
export function createTablePicker(anchor: HTMLElement, insert: (rows: number, cols: number) => void, cancel: () => void): HTMLElement {
  const form = document.createElement("form"); form.className = "table-picker";
  form.setAttribute("role", "dialog"); form.setAttribute("aria-label", t("Tablo ekle"));
  form.innerHTML = `<strong>${t("Tablo ekle")}</strong><span class="table-size" aria-live="polite"></span>
    <div class="table-grid" role="group" aria-label="${t("Hızlı boyut seçimi")}"></div>
    <div class="table-dimensions">${dimension("cols", t("Sütun"), 2, 20)}${dimension("rows", t("Satır"), 3, 50)}</div>
    <small>${t("İlk satır başlıktır. En fazla 20 sütun, 50 satır.")}</small>
    <div class="kdialog-row"><button type="button" data-cancel>${t("Vazgeç")}</button><button type="submit" class="primary">${t("Tabloyu ekle")}</button></div>`;
  const rows = form.querySelector<HTMLInputElement>('[name="rows"]')!;
  const cols = form.querySelector<HTMLInputElement>('[name="cols"]')!;
  const grid = form.querySelector<HTMLElement>(".table-grid")!;
  const cells: HTMLButtonElement[] = [];
  function dimension(name: string, label: string, value: number, max: number): string {
    return `<div class="table-field"><label for="table-${name}">${label}</label><div class="table-stepper">
      <button type="button" data-field="${name}" data-step="-1" aria-label="${label} ${t("azalt")}">−</button>
      <input id="table-${name}" name="${name}" type="number" min="1" max="${max}" step="1" value="${value}" required>
      <button type="button" data-field="${name}" data-step="1" aria-label="${label} ${t("artır")}">+</button>
    </div></div>`;
  }
  function preview(r: number, c: number) {
    form.querySelector(".table-size")!.textContent = `${c} ${t("sütun")} × ${r} ${t("satır")}`;
    cells.forEach((cell, i) => cell.classList.toggle("selected", Math.floor(i / 8) < r && i % 8 < c));
    form.querySelectorAll<HTMLButtonElement>("[data-step]").forEach(button => {
      const input = button.dataset.field === "rows" ? rows : cols;
      button.disabled = button.dataset.step === "-1" ? Number(input.value) <= 1 : Number(input.value) >= Number(input.max);
    });
  }
  form.querySelectorAll<HTMLButtonElement>("[data-step]").forEach(button => button.addEventListener("click", () => {
    const input = button.dataset.field === "rows" ? rows : cols;
    const next = (Number.isFinite(input.valueAsNumber) ? Math.round(input.valueAsNumber) : 1) + Number(button.dataset.step);
    input.value = String(Math.max(1, Math.min(Number(input.max), next)));
    preview(Number(rows.value), Number(cols.value));
  }));
  for (let r = 1; r <= 6; r++) for (let c = 1; c <= 8; c++) {
    const cell = document.createElement("button"); cell.type = "button"; cell.tabIndex = r === 3 && c === 2 ? 0 : -1;
    cell.setAttribute("aria-label", `${c} ${t("sütun")}, ${r} ${t("satır")}`);
    // The selected size includes the Markdown header row.
    cell.addEventListener("mouseenter", () => preview(r, c));
    cell.addEventListener("focus", () => { rows.value = String(r); cols.value = String(c); preview(r, c); });
    cell.addEventListener("click", () => insert(r, c));
    cell.addEventListener("keydown", event => {
      const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8, Home: -48, End: 48 };
      if (!(event.key in offsets)) return;
      event.preventDefault(); event.stopPropagation();
      const index = Math.max(0, Math.min(47, cells.indexOf(cell) + offsets[event.key]));
      cells.forEach(button => button.tabIndex = -1); cells[index].tabIndex = 0; cells[index].focus();
    });
    cells.push(cell); grid.appendChild(cell);
  }
  // Restore the entered size when the pointer leaves the grid.
  grid.addEventListener("mouseleave", () => preview(Number(rows.value), Number(cols.value)));
  for (const input of [rows, cols]) input.addEventListener("input", () => preview(Number(rows.value), Number(cols.value)));
  form.querySelector("[data-cancel]")!.addEventListener("click", () => { cancel(); anchor.focus(); });
  form.addEventListener("submit", event => { event.preventDefault(); if (form.reportValidity()) insert(Number(rows.value), Number(cols.value)); });
  form.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); cancel(); anchor.focus(); } });
  preview(3, 2);
  const rect = anchor.getBoundingClientRect();
  form.style.left = `clamp(8px, ${rect.left}px, max(8px, calc(100vw - 288px)))`;
  form.style.top = `clamp(8px, ${rect.bottom + 6}px, max(8px, calc(100vh - 370px)))`;
  return form;
}
