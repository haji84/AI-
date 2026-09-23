type BrokerFetch=(path:string,init?:RequestInit)=>Promise<Response>;
async function boundedText(body:ReadableStream<Uint8Array>|null,limit:number,timeout=5000):Promise<string>{
 if(!body)throw Error("empty_body");
 const reader=body.getReader();let size=0;const chunks:Uint8Array[]=[];
 let timer:ReturnType<typeof setTimeout>|undefined;
 const expired=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error("body_timeout")),timeout);});
 try{
  for(;;){const part=await Promise.race([reader.read(),expired]);if(part.done)break;size+=part.value.byteLength;if(size>limit)throw Error("body_limit");chunks.push(part.value);}
  return Buffer.concat(chunks).toString("utf8");
 }finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}
}
export function createRequirementsProxy(owner:()=>Promise<boolean>,broker:BrokerFetch){
 const denied=()=>Response.json({message:"オーナー認証が必要です"},{status:401});
 async function relay(path:string,init?:RequestInit){
  try{
   const response=await broker(path,{...init,signal:AbortSignal.timeout(50000)});
   const body=JSON.parse(await boundedText(response.body,2*1024*1024));
   return Response.json(body,{status:response.status});
  }catch{return Response.json({message:"JARVIS Runtimeへ接続できません"},{status:503});}
 }
 return {
  async GET(){if(!await owner())return denied();return relay("/api/jarvis/admin/requirements");},
  async POST(request:Request){
   if(!await owner())return denied();
   let payload;
   try{
    payload=JSON.parse(await boundedText(request.body,32768));
    if(!payload||typeof payload!=="object"||Array.isArray(payload)||Object.keys(payload).some(k=>!["decisionId","review"].includes(k))||typeof payload.decisionId!=="string")throw Error("invalid");
   }catch{return Response.json({message:"仕様更新の入力が不正または上限超過です"},{status:400});}
   return relay("/api/jarvis/admin/requirements/publish",{method:"POST",body:JSON.stringify(payload)});
  }
 };
}
