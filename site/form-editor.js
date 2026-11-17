(() => {
  const editors = new Map();
  window.addEventListener("message", event => {
    if (event.origin !== location.origin) return;
    const editor = editors.get(event.source);
    if (!editor) return;

    if (event.data?.type === "karaca-md:ready") {
      const api = editor.frame.contentWindow.karacaMdFormEditor;
      if (!api) return;
      api.loadMarkdown(editor.field.value);
      editor.ready = true;
      editor.fallback.hidden = true;
      editor.frame.hidden = false;
    } else if (event.data?.type === "karaca-md:submit" && editor.ready) {
      editor.form.requestSubmit();
    }
  });

  for (const container of document.querySelectorAll("[data-karaca-editor]")) {
    const frame = container.querySelector("iframe[data-src]");
    const field = container.querySelector("textarea");
    const status = container.querySelector("[role='status']");
    const form = field?.form;
    if (!frame || !field || !status || !form) continue;

    const source = new URL(frame.dataset.src, document.baseURI);
    if (source.origin !== location.origin) continue;
    const fallback = container.querySelector("[data-karaca-fallback]") ?? field;
    const editor = { frame, field, form, fallback, ready: false };
    editors.set(frame.contentWindow, editor);

    form.addEventListener("submit", event => {
      if (!editor.ready) return;
      let markdown;
      try {
        markdown = frame.contentWindow.karacaMdFormEditor?.getMarkdown();
      } catch {
        // Do not submit an older value if the frame became unavailable.
      }
      if (typeof markdown !== "string") {
        event.preventDefault();
        status.hidden = false;
        return;
      }
      status.hidden = true;
      field.value = markdown;
    }, true);

    frame.src = source.href;
  }
})();
