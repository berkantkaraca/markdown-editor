import type { Editor } from "@tiptap/core";
import { CellSelection, isInTable, selectedRect } from "@tiptap/pm/tables";
import { t } from "./i18n";

export type TableAction = "row-before" | "row-after" | "column-before" | "column-after" | "select-row" | "select-column" | "select-table" | "delete-row" | "delete-column" | "delete-table";
export const tableActions: {action:TableAction;label:string;icon:string;group:string;shortcut?:string}[] = [
  {action:"row-before",label:"Üste satır ekle",icon:"row-up",group:"Ekle",shortcut:"Alt+Shift+↑"},
  {action:"row-after",label:"Alta satır ekle",icon:"row-down",group:"Ekle",shortcut:"Alt+Shift+↓"},
  {action:"column-before",label:"Sola sütun ekle",icon:"column-left",group:"Ekle",shortcut:"Alt+Shift+←"},
  {action:"column-after",label:"Sağa sütun ekle",icon:"column-right",group:"Ekle",shortcut:"Alt+Shift+→"},
  {action:"select-row",label:"Satırı seç",icon:"row",group:"Seç"},
  {action:"select-column",label:"Sütunu seç",icon:"column",group:"Seç"},
  {action:"select-table",label:"Tabloyu seç",icon:"table",group:"Seç"},
  {action:"delete-row",label:"Satırı sil",icon:"remove-row",group:"Sil"},
  {action:"delete-column",label:"Sütunu sil",icon:"remove-column",group:"Sil"},
  {action:"delete-table",label:"Tabloyu sil",icon:"trash",group:"Sil"},
];

export function tableIcon(name:string):string {
  const paths:Record<string,string>={
    table:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    row:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 14h18"/><path d="M4 11h16v2H4z" fill="currentColor" stroke="none"/>',
    column:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M10 3v18M14 3v18"/><path d="M11 4h2v16h-2z" fill="currentColor" stroke="none"/>',
    "row-up":'<rect x="3" y="9" width="18" height="12" rx="2"/><path d="M3 15h18M12 2v5M9 4l3-3 3 3"/>',
    "row-down":'<rect x="3" y="3" width="18" height="12" rx="2"/><path d="M3 9h18M12 17v5M9 20l3 3 3-3"/>',
    "column-left":'<rect x="9" y="3" width="12" height="18" rx="2"/><path d="M15 3v18M2 12h5M4 9l-3 3 3 3"/>',
    "column-right":'<rect x="3" y="3" width="12" height="18" rx="2"/><path d="M9 3v18M17 12h5M20 9l3 3-3 3"/>',
    "remove-row":'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18M3 16h18M8 12h8"/>',
    "remove-column":'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v18M16 3v18M10 12h4"/>',
    trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  };
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.table}</svg>`;
}

export function runTableAction(editor:Editor,action:TableAction):boolean {
  if(!isInTable(editor.state)) return false;
  if(action.startsWith("select-")) {
    const rect=selectedRect(editor.state),start=rect.tableStart,map=rect.map;
    const row=action==="select-row",column=action==="select-column";
    const from=start+map.positionAt(row?rect.top:0,column?rect.left:0,rect.table);
    const to=start+map.positionAt(row?rect.bottom-1:map.height-1,column?rect.right-1:map.width-1,rect.table);
    const selection=CellSelection.create(editor.state.doc,from,to);
    editor.view.dispatch(editor.state.tr.setSelection(selection));editor.view.focus();return true;
  }
  const chain=editor.chain().focus();
  if (action === "delete-row") {
    return chain.deleteRow().command(({ state, tr }) => {
      if (!isInTable(state)) return true;
      const rect = selectedRect(state);
      const firstRow = rect.table.firstChild;
      if (!firstRow || Array.from({ length: firstRow.childCount }, (_, index) => firstRow.child(index))
        .some(cell => cell.type.spec.tableRole !== "cell")) return true;

      // Markdown tables require a header. Keep promotion in the same undo step.
      firstRow.forEach((cell, offset) => {
        tr.setNodeMarkup(rect.tableStart + 1 + offset, editor.schema.nodes.tableHeader, cell.attrs);
      });
      return true;
    }).run();
  }
  return action==="row-before" ? chain.addRowBefore().run() : action==="row-after" ? chain.addRowAfter().run()
    : action==="column-before" ? chain.addColumnBefore().run() : action==="column-after" ? chain.addColumnAfter().run()
    : action==="delete-column" ? chain.deleteColumn().run() : chain.deleteTable().run();
}

export function tableKeyDown(editor:Editor,event:KeyboardEvent):boolean {
  if(!isInTable(editor.state) || editor.view.composing) return false;
  if(event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey) {
    const action:Record<string,TableAction>={ArrowUp:"row-before",ArrowDown:"row-after",ArrowLeft:"column-before",ArrowRight:"column-after"};
    return action[event.key] ? runTableAction(editor,action[event.key]) : false;
  }
  if((event.key!=="Delete" && event.key!=="Backspace") || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  const selection=editor.state.selection;
  if(!(selection instanceof CellSelection)) return false;
  if(selection.isRowSelection() && selection.isColSelection()) return runTableAction(editor,"delete-table");
  if(selection.isRowSelection()) return runTableAction(editor,"delete-row");
  if(selection.isColSelection()) return runTableAction(editor,"delete-column");
  return false;
}

export interface TableMenuItem {label:string;icon:string;group:string;run():void;shortcut?:string}
export function tableActionPanel(items:TableMenuItem[],description:string):HTMLElement {
  const panel=document.createElement("div");panel.className="kmenu table-action-menu";panel.setAttribute("role","menu");panel.setAttribute("aria-label",t("Tablo işlemleri"));
  const header=document.createElement("div");header.className="table-menu-heading";
  const title=document.createElement("strong");title.textContent=t("Tablo");const detail=document.createElement("span");detail.textContent=description;header.append(title,detail);panel.append(header);
  let currentGroup="";
  for(const item of items) {
    if(item.group!==currentGroup){const label=document.createElement("div");label.className="table-menu-group";label.textContent=t(item.group);panel.append(label);currentGroup=item.group;}
    const button=document.createElement("button");button.type="button";button.setAttribute("role","menuitem");button.setAttribute("aria-label",t(item.label));
    button.classList.toggle("table-danger",item.group==="Sil");button.innerHTML=tableIcon(item.icon);
    const label=document.createElement("span");label.textContent=t(item.label);button.append(label);
    if(item.shortcut){const hint=document.createElement("kbd");hint.textContent=item.shortcut;button.append(hint);}
    button.addEventListener("mousedown",event=>event.preventDefault());button.onclick=item.run;panel.append(button);
  }
  return panel;
}
