export function taskCheckbox(item: Element): HTMLInputElement | null {
  return item.querySelector<HTMLInputElement>(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
}

// Markdown renders a blank-line-separated list with paragraphs around its text.
// Both tight and loose lists must retain their task state. Split mixed lists
// into compatible schema groups instead of losing checkboxes on normal items.
export function prepareTaskLists(root: HTMLElement): void {
  for (const list of Array.from(root.querySelectorAll("ul")).reverse()) {
    const items = Array.from(list.children).filter((item) => item.tagName === "LI");
    if (!items.some((item) => taskCheckbox(item))) continue;
    const fragment = document.createDocumentFragment();
    let group: HTMLElement | null = null;
    let previousTask: boolean | undefined;
    for (const item of items) {
      const checkbox = taskCheckbox(item);
      const task = !!checkbox;
      if (task !== previousTask) {
        group = list.cloneNode(false) as HTMLElement;
        if (task) group.dataset.type = "taskList";
        else delete group.dataset.type;
        fragment.appendChild(group);
        previousTask = task;
      }
      if (checkbox) {
        (item as HTMLElement).dataset.type = "taskItem";
        (item as HTMLElement).dataset.checked = String(checkbox.checked);
      }
      group!.appendChild(item);
    }
    list.replaceWith(fragment);
  }
}
