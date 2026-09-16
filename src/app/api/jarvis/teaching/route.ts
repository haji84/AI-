import { NextResponse } from "next/server";
import { requireJarvisOwner } from "../broker.ts";
import { teachingStore } from "../../../../jarvis/teaching-store.ts";
export const dynamic="force-dynamic";
export async function GET(){if(!await requireJarvisOwner())return NextResponse.json({message:'オーナー認証が必要です'},{status:401});try{return NextResponse.json(teachingStore().list(),{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({message:'手順ストアを読めません'},{status:503});}}
export async function POST(request:Request){
 if(!await requireJarvisOwner())return NextResponse.json({message:'オーナー認証が必要です'},{status:401});
 try{const text=await request.text();if(text.length>32000)throw Error('入力が大きすぎます');const p=JSON.parse(text);if(p.action!=='manual')throw Error('Unsupported action');const variant=teachingStore().manual(p);return NextResponse.json({variant},{status:201});}
 catch(error){return NextResponse.json({message:error instanceof Error?error.message:'保存失敗'},{status:400});}
}
