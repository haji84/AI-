import { NextResponse } from "next/server";
import { requireJarvisOwner } from "../broker.ts";
import { teachingStore } from "../../../../jarvis/teaching-store.ts";
import { teachingLibraryResponse } from "../../../../jarvis/teaching-learning.ts";
export const dynamic="force-dynamic";
export async function GET(){return teachingLibraryResponse(requireJarvisOwner,teachingStore);}
export async function POST(request:Request){
 if(!await requireJarvisOwner())return NextResponse.json({message:'オーナー認証が必要です'},{status:401});
 try{const text=await request.text();if(text.length>32000)throw Error('入力が大きすぎます');const p=JSON.parse(text);if(p.action!=='manual')throw Error('Unsupported action');const variant=teachingStore().manual(p);return NextResponse.json({variant},{status:201});}
 catch(error){return NextResponse.json({message:error instanceof Error?error.message:'保存失敗'},{status:400});}
}
