import { boundedText } from "./requirements-proxy.ts";
import { validateMaterialIntake, MATERIAL_REQUEST_BYTES } from "../gai/cognitive-material-intake.ts";
type BrokerFetch = (path: string, init?: RequestInit) => Promise<Response>;
export function createCognitiveMaterialProxy(owner: () => Promise<boolean>, broker: BrokerFetch) {
 const denied = () => Response.json({message:"オーナー認証が必要です"},{status:401});
 const failed = () => Response.json({message:"状態を確認してください。自動では再送しません。"},{status:503});
 return {
  async POST(request: Request) {
   if(!await owner())return denied();
   let input; try{input=validateMaterialIntake(JSON.parse(await boundedText(request.body,MATERIAL_REQUEST_BYTES)));}
   catch{return Response.json({message:"材料の形式・容量・完了条件を確認してください"},{status:400});}
   try{const r=await broker("/api/jarvis/admin/cognitive/materials",{method:"POST",body:JSON.stringify(input),signal:AbortSignal.timeout(30_000)});return Response.json(JSON.parse(await boundedText(r.body,32_000)),{status:r.status});}catch{return failed();}
  },
  async GET(request: Request) {
   if(!await owner())return denied();
   const p=new URL(request.url).searchParams;
   if([...p.keys()].some(k=>!["goalId","outputId"].includes(k))||p.getAll("goalId").length!==1||p.getAll("outputId").length!==1||!/^goal-[a-f0-9]{16}$/.test(p.get("goalId")!)||!/^output-[1-8]$/.test(p.get("outputId")!))return Response.json({message:"成果物の指定が不正です"},{status:400});
   try{
    const r=await broker("/api/jarvis/admin/cognitive/materials?"+p.toString(),{method:"GET",signal:AbortSignal.timeout(30_000)});
    const payload=JSON.parse(await boundedText(r.body,1_500_000));
    if(!r.ok)return Response.json({message:"検証済み成果物を取得できません"},{status:r.status});
    if(typeof payload.contentBase64!=="string"||!/^[A-Za-z0-9+/]*={0,2}$/.test(payload.contentBase64)||typeof payload.filename!=="string"||!/^output-[1-8]\.(txt|xlsx|docx)$/.test(payload.filename))throw Error("Invalid output");
    const bytes=Buffer.from(payload.contentBase64,"base64");if(bytes.length>1_048_576||bytes.toString("base64")!==payload.contentBase64)throw Error("Output bound");
    const types:Record<string,string>={txt:"text/plain; charset=utf-8",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"};
    return new Response(bytes,{headers:{"Content-Type":types[payload.filename.split(".").pop()!],"Content-Disposition":`attachment; filename="${payload.filename}"`,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
   }catch{return failed();}
  },
 };
}
export function createCognitiveLearningProxy(owner:()=>Promise<boolean>,broker:BrokerFetch){
 return async(request:Request)=>{
  if(!await owner())return Response.json({message:"オーナー認証が必要です"},{status:401});
  let payload;try{payload=JSON.parse(await boundedText(request.body,2048));
   if(!payload||typeof payload!=="object"||Array.isArray(payload))throw Error();
   const keys=Object.keys(payload);
   if(payload.operation==="correct") {if(keys.length!==4||keys.some(k=>!["operation","goalId","originalId","replacementId"].includes(k))||![payload.goalId,payload.originalId,payload.replacementId].every(v=>typeof v==="string"&&v.length>0&&v.length<201))throw Error();}
   else if(!["import-history","training-candidate"].includes(payload.operation)||keys.length!==1)throw Error();
  }catch{return Response.json({message:"学習対象の指定が不正です"},{status:400});}
  try{const r=await broker("/api/jarvis/admin/cognitive/learning",{method:"POST",body:JSON.stringify(payload),signal:AbortSignal.timeout(30_000)});return Response.json(JSON.parse(await boundedText(r.body,32_000)),{status:r.status});}catch{return Response.json({message:"学習状態を確認してください"},{status:503});}
 };
}
