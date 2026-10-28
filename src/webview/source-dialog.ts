import { renderPreview } from "./preview";

export type SpecialKind = "math" | "mermaid" | "html";
let current: HTMLDialogElement | null = null;

export function openSourceDialog(options: { kind: SpecialKind; source: string; save(source: string): void }): void {
  current?.close();
  const dialog = document.createElement("dialog");
  dialog.className = "source-dialog";
  dialog.setAttribute("aria-labelledby", "source-dialog-title");
  const form = document.createElement("form");
  const title = document.createElement("h2");
  title.id = "source-dialog-title";
  title.textContent = options.kind === "math" ? "Matematik düzenle" : options.kind === "mermaid" ? "Diyagram düzenle" : "HTML kaynağını düzenle";
  const label = document.createElement("label"); label.textContent = "Kaynak";
  const input = document.createElement("textarea");
  input.value = options.source; input.spellcheck = false; input.rows = 9; input.setAttribute("aria-label", "Kaynak");
  label.appendChild(input);
  const previewLabel = document.createElement("span"); previewLabel.className = "source-preview-label"; previewLabel.textContent = "Önizleme";
  const preview = document.createElement("div"); preview.className = "source-preview md-body"; preview.setAttribute("aria-label", "Önizleme");
  const row = document.createElement("div"); row.className = "kdialog-row";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Vazgeç"; cancel.onclick = () => dialog.close();
  const save = document.createElement("button"); save.type = "submit"; save.className = "primary"; save.textContent = "Uygula";
  row.append(cancel, save); form.append(title, label, previewLabel, preview, row); dialog.appendChild(form);
  let timer: ReturnType<typeof setTimeout>;
  const refresh = () => { if (dialog.open) renderPreview(preview, input.value); };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(refresh, 180); });
  form.addEventListener("submit", (event) => { event.preventDefault(); options.save(input.value); dialog.close(); });
  dialog.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); form.requestSubmit(); }
  });
  dialog.addEventListener("close", () => { clearTimeout(timer); dialog.remove(); if (current === dialog) current = null; });
  document.body.appendChild(dialog); current = dialog;
  dialog.showModal(); refresh(); input.focus();
}
