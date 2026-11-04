import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { runTableAction, tableActions, tableIcon, type TableAction } from "./table-actions";
import { t } from "./i18n";

export function attachTableHover(editor:Editor,getMode:()=>string,openMenu:(anchor:HTMLElement)=>void) {
  const root=editor.view.dom;
  const bar=document.createElement("div");bar.className="table-cell-controls hidden";
  bar.setAttribute("role","toolbar");bar.setAttribute("aria-label",t("Tablo kısayolları"));document.body.append(bar);
  let cell:HTMLTableCellElement|null=null,hideTimer:ReturnType<typeof setTimeout>,frame=0;
  let pointerOrigin: { x: number; y: number } | null = null;
  function hide(){bar.classList.add("hidden");cell=null;pointerOrigin=null;}
  function chooseCell() {
    if(!cell?.isConnected || getMode()!=="live")return false;
    const selection=editor.state.selection;
    const inside=editor.view.posAtDOM(cell,0);
    // Keep an existing rectangular selection when its table is the target.
    if(selection instanceof CellSelection) {
      const selected=editor.view.nodeDOM(selection.$anchorCell.pos);
      if(selected instanceof HTMLElement && selected.closest("table")===cell.closest("table")) {
        let included=false;selection.forEachCell((node,position)=>{if(inside>position && inside<position+node.nodeSize)included=true;});
        if(included)return true;
      }
    }
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(inside))));
    return true;
  }
  function position(){
    if(getMode()!=="live" || !cell?.isConnected){hide();return;}
    const rect=cell.getBoundingClientRect(),wrap=document.getElementById("live-wrap")!.getBoundingClientRect();
    if(rect.bottom<=wrap.top || rect.top>=wrap.bottom || rect.right<=wrap.left || rect.left>=wrap.right){bar.classList.add("hidden");return;}
    bar.classList.remove("hidden");
    const box=bar.getBoundingClientRect(),top=document.getElementById("formatbar")!.getBoundingClientRect().bottom+6;
    const above=rect.top-box.height-6;
    bar.style.top=`${Math.max(top,Math.min(above>=top?above:rect.bottom+6,window.innerHeight-box.height-8))}px`;
    bar.style.left=`${Math.max(8,Math.min(rect.right-box.width,window.innerWidth-box.width-8))}px`;
  }
  function render(){
    if(!cell)return;
    bar.replaceChildren();bar.setAttribute("aria-label",t("Tablo kısayolları"));
    const label=document.createElement("span");label.className="table-cell-position";
    label.textContent=t("Satır {row} · Sütun {column}").replace("{row}",String((cell.parentElement as HTMLTableRowElement).rowIndex+1)).replace("{column}",String(cell.cellIndex+1));bar.append(label);
    for(const action of ["row-after","column-after","select-row","select-column"] as TableAction[]) {
      const item=tableActions.find(item=>item.action===action)!;
      const button=document.createElement("button");button.type="button";button.dataset.tableAction=action;
      button.setAttribute("aria-label",t(item.label));button.title=t(item.label)+(item.shortcut?` (${item.shortcut})`:"");button.innerHTML=tableIcon(item.icon);
      button.onclick=()=>{if(chooseCell())runTableAction(editor,action);refresh();};bar.append(button);
    }
    const more=document.createElement("button");more.type="button";more.innerHTML=tableIcon("more");more.setAttribute("aria-label",t("Daha fazla tablo işlemi"));more.title=t("Daha fazla tablo işlemi");
    more.onclick=()=>{if(chooseCell())openMenu(more);};bar.append(more);
  }
  function refresh(){
    if(getMode()!=="live" || !cell?.isConnected){hide();return;}
    if(bar.getAttribute("aria-label")!==t("Tablo kısayolları"))render();
    const label=bar.querySelector(".table-cell-position");
    if(label)label.textContent=t("Satır {row} · Sütun {column}").replace("{row}",String((cell.parentElement as HTMLTableRowElement).rowIndex+1)).replace("{column}",String(cell.cellIndex+1));
    position();
  }
  function show(target:HTMLTableCellElement){
    clearTimeout(hideTimer);
    if(cell!==target){cell=target;pointerOrigin=null;render();}
    position();
  }
  function approachingBar(event: PointerEvent): boolean {
    if (!pointerOrigin || bar.classList.contains("hidden")) return false;
    const bounds = bar.getBoundingClientRect();
    const distance = (bounds.top + bounds.bottom) / 2 - pointerOrigin.y;
    if (!distance) return false;
    const progress = (event.clientY - pointerOrigin.y) / distance;
    if (progress <= 0 || progress > 1) return false;
    const left = pointerOrigin.x + (bounds.left - pointerOrigin.x) * progress;
    const right = pointerOrigin.x + (bounds.right - pointerOrigin.x) * progress;
    return event.clientX >= left - 8 && event.clientX <= right + 8;
  }
  function move(event:PointerEvent){
    if(event.buttons || getMode()!=="live")return;
    const target=(event.target as Element).closest<HTMLTableCellElement>("td,th");
    if (target !== cell && approachingBar(event)) {
      clearTimeout(hideTimer);
      return;
    }
    if(target && root.contains(target)){
      show(target);
      pointerOrigin={x:event.clientX,y:event.clientY};
    }
    else {clearTimeout(hideTimer);hideTimer=setTimeout(hide,220);}
  }
  const leave=()=>{clearTimeout(hideTimer);hideTimer=setTimeout(hide,220);};
  const enter=()=>clearTimeout(hideTimer);
  const preserve=(event:MouseEvent)=>event.preventDefault();
  const selection=()=>{
    if(getMode()!=="live")return;
    const current=editor.state.selection;
    const node=current instanceof CellSelection ? editor.view.nodeDOM(current.$anchorCell.pos) : editor.view.domAtPos(current.from).node;
    const element=node instanceof HTMLElement?node:node?.parentElement;
    const target=element?.closest<HTMLTableCellElement>("td,th");
    if(target && root.contains(target))show(target);else hide();
  };
  const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(cell)refresh();});};
  const outside=(event:PointerEvent)=>{if(!bar.contains(event.target as Node)&&!root.contains(event.target as Node))hide();};
  const escape=(event:KeyboardEvent)=>{if(event.key==="Escape")hide();};
  root.addEventListener("pointermove",move);root.addEventListener("pointerleave",leave);
  bar.addEventListener("pointerenter",enter);bar.addEventListener("pointerleave",leave);bar.addEventListener("mousedown",preserve);
  document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);
  window.addEventListener("scroll",position,true);window.addEventListener("resize",position);
  editor.on("selectionUpdate",selection);editor.on("transaction",update);
  return {refresh,hide,destroy(){
    clearTimeout(hideTimer);cancelAnimationFrame(frame);bar.remove();
    root.removeEventListener("pointermove",move);root.removeEventListener("pointerleave",leave);
    document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape);
    window.removeEventListener("scroll",position,true);window.removeEventListener("resize",position);
    editor.off("selectionUpdate",selection);editor.off("transaction",update);
  }};
}
