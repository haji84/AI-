export interface TrackedRepairPromptContext {version:1;paddingLines:number}
interface Source {path:string;content:string}
interface Slot {path:string;before:string}

/** Host-pinned presentation only. Full source hashes, edit scope and prompt limits remain authoritative. */
export function validateTrackedRepairPromptContext(value:unknown):asserts value is TrackedRepairPromptContext|undefined {
  if(value===undefined)return;
  if(!value||typeof value!=="object"||Array.isArray(value)
    ||Object.keys(value).sort().join(",")!=="paddingLines,version"
    ||!("version" in value)||value.version!==1||!("paddingLines" in value)
    ||!Number.isInteger(value.paddingLines)||Number(value.paddingLines)<0||Number(value.paddingLines)>40)
    throw Error("TRACKED_REPAIR_PROMPT_CONTEXT_INVALID");
}

function excerpt(label:string,source:Source,ranges:Array<[number,number]>,padding:number):string {
  // Retain exact newline bytes inside every excerpt, including CRLF and the final line.
  const lines=source.content.match(/[^\n]*\n|[^\n]+$/g)??[""];
  const lineAt=(offset:number)=>Math.min(source.content.slice(0,offset).split("\n").length-1,lines.length-1);
  const windows=ranges.map(([first,last])=>[Math.max(0,lineAt(first)-padding),Math.min(lines.length-1,lineAt(last)+padding)] as [number,number])
    .sort((a,b)=>a[0]-b[0]);
  const merged:Array<[number,number]>=[];
  for(const window of windows){const previous=merged.at(-1);if(previous&&window[0]<=previous[1]+1)previous[1]=Math.max(previous[1],window[1]);else merged.push(window);}
  return merged.map(([first,last])=>label+" "+source.path+" (lines "+(first+1)+"-"+(last+1)+" of "+lines.length+")\n"+
    lines.slice(first,last+1).join("")).join("\n[Unshown lines between excerpts]\n");
}

export function renderTrackedRepairSources(files:Source[],slots:Slot[],context:TrackedRepairPromptContext|undefined,previousFiles:Source[]):string {
  if(!context)return files.map(f=>"SOURCE "+f.path+"\n"+(previousFiles.find(previous=>previous.path===f.path)?.content??f.content)).join("\n");
  const baseline=files.map(source=>{
    const selected=slots.filter(slot=>slot.path===source.path);
    if(!selected.length)return "SOURCE "+source.path+"\n"+source.content;
    const ranges=selected.map(slot=>{
      const start=source.content.indexOf(slot.before);
      if(start<0||source.content.indexOf(slot.before,start+1)>=0)throw Error("TRACKED_REPAIR_SLOT_NOT_UNIQUE");
      return [start,start+slot.before.length-1] as [number,number];
    });
    return excerpt("SOURCE",source,ranges,context.paddingLines);
  }).join("\n");
  const rejected=previousFiles.flatMap(source=>{
    const original=files.find(f=>f.path===source.path)?.content;
    if(original===undefined)throw Error("TRACKED_REPAIR_CONTEXT_SOURCE_UNKNOWN");
    if(original===source.content)return [];
    // Show the exact changed boundaries without guessing alignment after inserted/deleted lines.
    // The rejected candidate is advisory; its full immutable bytes were already re-attested.
    let start=0,end=source.content.length,oldEnd=original.length;
    while(start<end&&start<oldEnd&&source.content[start]===original[start])start++;
    while(end>start&&oldEnd>start&&source.content[end-1]===original[oldEnd-1]){end--;oldEnd--;}
    const last=Math.max(start,end-1);
    return [excerpt("REJECTED SOURCE",source,[[start,start],[last,last]],context.paddingLines)];
  }).join("\n");
  return baseline+(rejected?"\n"+rejected:"");
}
