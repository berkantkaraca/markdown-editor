import type { Node as DocumentNode } from "@tiptap/pm/model";
import { t } from "./i18n";

function actions(): HTMLDivElement {
  const toolbar = document.createElement("div");
  toolbar.className = "code-copy-actions";
  toolbar.contentEditable = "false";
  for (const mode of ["plain", "markdown"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.codeCopy = mode;
    button.textContent = t(mode === "plain" ? "Kodu kopyala" : "Markdown kopyala");
    toolbar.append(button);
  }
  return toolbar;
}

export function codeBlockView(node: DocumentNode) {
  const dom = document.createElement("div");
  dom.className = "code-block";
  const pre = document.createElement("pre");
  pre.className = "hljs";
  const code = document.createElement("code");
  const update = (next: DocumentNode): boolean => {
    if (next.type !== node.type) return false;
    code.className = next.attrs.language ? `language-${next.attrs.language}` : "";
    return true;
  };
  update(node);
  pre.append(code);
  const toolbar = actions();
  dom.append(toolbar, pre);
  return {
    dom, contentDOM: code, update,
    stopEvent: (event: Event) => toolbar.contains(event.target as Node),
    ignoreMutation: (mutation: MutationRecord | { type: "selection"; target: Node }) => toolbar.contains(mutation.target),
  };
}

export function attachCodeCopy(roots: HTMLElement[], write: (text: string) => Promise<void>) {
  const feedback = document.createElement("span");
  feedback.className = "code-copy-feedback";
  feedback.setAttribute("role", "status");
  document.body.append(feedback);
  let feedbackTimer: ReturnType<typeof setTimeout>;

  function refresh(root: HTMLElement): void {
    root.querySelectorAll<HTMLPreElement>("pre").forEach(pre => {
      if (!pre.querySelector("code") || pre.parentElement?.classList.contains("code-block")) return;
      const wrapper = document.createElement("div");
      wrapper.className = "code-block";
      pre.replaceWith(wrapper);
      wrapper.append(actions(), pre);
    });
    root.querySelectorAll<HTMLButtonElement>("[data-code-copy]").forEach(button => {
      button.textContent = t(button.dataset.codeCopy === "plain" ? "Kodu kopyala" : "Markdown kopyala");
    });
  }

  for (const root of roots) {
    root.addEventListener("mousedown", event => {
      if ((event.target as Element).closest("[data-code-copy]")) event.preventDefault();
    });
    root.addEventListener("click", async event => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-code-copy]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const code = button.closest(".code-block")?.querySelector("pre > code");
      if (!code) return;
      const text = code.textContent || "";
      const language = Array.from(code.classList).find(name => name.startsWith("language-"))?.slice(9) || "";
      const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)));
      const value = button.dataset.codeCopy === "plain" ? text
        : `${fence}${language}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`;
      try {
        await write(value);
        feedback.textContent = t("Kopyalandı");
      } catch {
        feedback.textContent = t("Kopyalanamadı. Tekrar deneyin.");
      }
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => { feedback.textContent = ""; }, 2500);
    });
  }
  return { refresh, localize: () => roots.forEach(refresh) };
}
