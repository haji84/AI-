import type {OwnerRequirementRecord,RequirementInput} from "./owner-requirement-intake.ts";
export interface ConversationResolution {
 input:RequirementInput|null;resolution:"direct_adoption"|"saved_reference"|"correction"|"withdrawal"|"proposal"|"idea"|"ambiguous"|"ordinary";
 confidence:number;referenceIds:string[];needsClarification:boolean;message:string;
}
export function protectedRequirementReasons(text:string):string[]{
 const rules:[string,RegExp][]=[
  ["credentials",/秘密鍵|パスワード|認証情報|トークン|credential|secret|password|api.?key/i],
  ["permission_security",/認証|権限|管理者|ファイアウォール|Funnel|firewall|permission|security|bypass|無制限/i],
  ["billing",/課金|請求|購入|有料|billing|purchase|paid/i],
  ["destructive_governance",/削除|全消去|初期化|規約|ガバナンス|Human\s*Gate|AGENTS\.md|delete|drop database|governance/i]
 ];
 return rules.filter(([,pattern])=>pattern.test(text)).map(([kind])=>kind);
}
export function semanticTerms(value:string):string {
 return value.normalize("NFKC").toLowerCase().replace(/リモート/g,"遠隔").replace(/お知らせ/g,"通知").replace(/スマホ/g,"端末").replace(/音声/g,"声").replace(/再接続/g,"復帰").replace(/記憶/g,"保存");
}
export function resolveOwnerConversation(text:string,context:{records:OwnerRequirementRecord[];goalId:string|null;referenceId?:string}):ConversationResolution {
 const value=text.trim(),clean=value.replace(/[!！。]+$/g,"");
 const make=(resolution:ConversationResolution["resolution"],input:RequirementInput|null,message:string,referenceIds:string[]=[],confidence=0.9):ConversationResolution=>({resolution,input,message,referenceIds,confidence,needsClarification:resolution==="ambiguous"});
 const input=(decision:RequirementInput["decision"],statement=value,canonicalIds:string[]=[],supersedes?:string):RequirementInput=>({decision,statement,canonicalIds,...(supersedes?{supersedes}:{})});
 // Quoted/source material and negated/hypothetical statements are data, never adoption.
 if(/[?？]|(?:例えば|たとえば|example|例として|もし|仮に|と仮定|しないで|追加しない|実装しない|しなくて|ではない|Webの指示|資料の指示)|^[>\x60]|^「.*」$|できますか|でしょうか|どう思う/i.test(value))return make("idea",/仕様|機能|追加|実装/.test(value)?input("idea"):null,"質問・例示・否定として扱い、採用しません。",[],1);
 const correction=clean.match(/^(?:さっきの|この|その|前の)仕様を「([^\n]+)」に変更して$/);
 const withdraw=/^(?:さっきの|この|その|前の)仕様を(?:撤回|取り消|取消)して$/.test(clean);
 const refer=/^(?:それで進めて|そうしよう|それ欲しい|この仕様で|それを採用して|これを追加して)$/.test(clean);
 if(correction||withdraw||refer){
  const used=new Set(context.records.flatMap(r=>r.conversation?.referenceIds??[]));
  const candidates=context.records.filter(r=>r.goalId===context.goalId&&(correction||withdraw?["ACCEPTED_REQUIREMENT","SPEC_SYNCED"].includes(r.state):["PROPOSED","IDEA"].includes(r.state)&&!used.has(r.id))).filter(r=>!context.referenceId||r.id===context.referenceId);
  if(candidates.length!==1)return make("ambiguous",null,"どの要求を指すか選択してください。内容はまだ変更していません。",candidates.map(r=>r.id),0);
  const r=candidates[0];
  if(correction)return make("correction",input("accept",correction[1],r.canonicalIds,r.id),"保存済みの要求を訂正し、履歴を保持します。",[r.id],1);
  if(withdraw)return make("withdrawal",input("withdraw",value,r.canonicalIds,r.id),"保存済みの要求を撤回し、履歴を保持します。",[r.id],1);
  return make("saved_reference",input("accept",r.statement,r.canonicalIds),"選択した保存済みの案を採用します。",[r.id],1);
 }
 if(/これ|それ|さっき|そうして/.test(clean)&&/仕様|機能|追加|変更|修正|進め/.test(clean))return make("ambiguous",null,"参照する要求と変更内容を確認してください。",[],0);
 if(/^(?:仕様として追加|正式要件として採用|adopt requirement)[:：]\s*[^\n]+$/i.test(clean))return make("direct_adoption",input("accept",clean.replace(/^[^:：]+[:：]\s*/,"")),"明示的な仕様採用として保存します。",[],1);
 if(!/[\n「」『』\x60]/.test(clean)&&/(?:機能|仕様).+(?:追加|実装|変更|対応)(?:して|してください|してほしい|して欲しい)$|(?:できるようにして|できるようにしてください|機能を追加して|機能を実装して)$/.test(clean))return make("direct_adoption",input("accept"),"明示的な機能要求として採用します。");
 if(/機能|仕様|できたら|できると|追加|実装|requirement|feature/i.test(value))return make("proposal",input("propose"),"要件候補として保存しました。採用指示があれば仕様へ反映します。",[],0.6);
 return make("ordinary",null,"通常の依頼として処理します。",[],0);
}
