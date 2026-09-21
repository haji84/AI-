export type DataClassification="public"|"internal"|"personal"|"confidential"|"highly-confidential"|"credentials"|"secret";
export type DataRecord={id:string;classification:DataClassification;purpose:string;createdAt:string;expiresAt?:string;locations:string[];legalHold?:boolean};
export type LifecycleDecision={action:"retain"|"delete"|"quarantine";reason:string;locations:string[]};
const defaultDays:Record<DataClassification,number>={public:3650,internal:365,personal:90,confidential:30,"highly-confidential":7,credentials:0,secret:0};
export class DataLifecycleEngine{
  decide(record:DataRecord,allowedPurposes:Set<string>,now=Date.now()):LifecycleDecision{
    if(record.legalHold)return {action:"retain",reason:"legal-hold",locations:record.locations};
    if(!allowedPurposes.has(record.purpose))return {action:"quarantine",reason:"purpose-not-authorized",locations:record.locations};
    const expiry=record.expiresAt?Date.parse(record.expiresAt):Date.parse(record.createdAt)+defaultDays[record.classification]*86400000;
    if(!Number.isFinite(expiry)||expiry<=now)return {action:"delete",reason:"retention-expired",locations:record.locations};
    return {action:"retain",reason:"within-retention",locations:record.locations};
  }
  deletionPlan(record:DataRecord){if(record.legalHold)throw new Error("cannot delete record under legal hold");return {recordId:record.id,steps:record.locations.map(location=>({location,action:"delete-and-verify"})),verify:"all-copies-absent"};}
}
