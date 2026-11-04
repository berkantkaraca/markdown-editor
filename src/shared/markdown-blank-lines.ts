import type MarkdownIt from "markdown-it";

// Extra Markdown blank lines are editor spacing. Ordinary renderers may collapse
// them, but no HTML tags are needed in the saved document.
export function preserveBlankLines(md: InstanceType<typeof MarkdownIt>, sourceMap: boolean): void {
  md.core.ruler.after(sourceMap ? "source-ranges" : "block","blank-paragraphs",state=>{
    const base = Number(state.env.sourceOffset || 0), offsets=[0];
    for(let i=0;i<state.src.length;i++) if(state.src[i]==="\n") offsets.push(i+1);
    const blocks: {index:number;after:number;from:number;end:number}[]=[];
    for(let i=0;i<state.tokens.length;i++) {
      const token=state.tokens[i];
      if(token.level!==0 || !token.map || token.nesting===-1 || token.type==="inline") continue;
      const from=offsets[token.map[0]] ?? state.src.length, to=offsets[token.map[1]] ?? state.src.length;
      const raw=state.src.slice(from,to), trailing=/\n[\t \n]*$/.exec(raw);
      const end=trailing ? from+trailing.index : to;
      if(sourceMap) token.attrSet("data-md-range",`${base+from}:${base+Math.min(to,end+1)}`);
      let after=i+1;
      if(token.nesting===1) { while(after<state.tokens.length && !(state.tokens[after].level===0 && state.tokens[after].nesting===-1)) after++; after++; }
      blocks.push({index:i,after,from,end});
    }
    const insertions=new Map<number,typeof state.tokens>();
    const add=(index:number,from:number,to:number)=>{
      const open=new state.Token("paragraph_open","p",1),close=new state.Token("paragraph_close","p",-1);
      if(sourceMap) open.attrSet("data-md-range",`${base+from}:${base+to}`);
      const entries=insertions.get(index)||[];entries.push(open,close);insertions.set(index,entries);
    };
    const newlineCount=(from:number,to:number)=>{
      const gap=state.src.slice(from,to);return /^[\t \n]*$/.test(gap) ? (gap.match(/\n/g)||[]).length : 0;
    };
    if(!blocks.length) {
      const count=Math.floor(newlineCount(0,state.src.length)/2)+1;
      for(let j=0;j<count;j++) add(0,Math.min(j*2,state.src.length),Math.min(j*2+2,state.src.length));
    } else {
      for(let j=0;j<Math.floor(newlineCount(0,blocks[0].from)/2);j++) add(blocks[0].index,j*2,j*2+2);
      blocks.forEach((block,index)=>{
        const next=blocks[index+1], to=next?.from ?? state.src.length;
        const count=Math.max(0,Math.floor(newlineCount(block.end,to)/2)-(next?1:0));
        for(let j=0;j<count;j++) {
          const from=block.end+(next?2+j*2:j===0?1:j*2);
          add(block.after,from,Math.min(to,block.end+(next?4+j*2:2+j*2)));
        }
      });
    }
    const tokens: typeof state.tokens=[];
    for(let i=0;i<=state.tokens.length;i++) {tokens.push(...insertions.get(i)||[]);if(i<state.tokens.length)tokens.push(state.tokens[i]);}
    state.tokens=tokens;
  });
}
