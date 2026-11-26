import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Immutable encrypted snapshot parts are staged first, and published ONLY by
// the caller's existing coordinator.enc.json CAS. Never use a staged part to
// grant Goal/Job/lease authority. This class has no delete/overwrite method.
export interface CheckpointArchivePointer {
  version: 1;
  headSha256: string;
  contentSha256: string;
  byteLength: number;
  parts: number;
  previousHeadSha256: string | null;
}
export interface CheckpointArchiveOptions {
  repository: string;
  stateBranch: string;
  clusterId: string;
  token: string;
  key: Buffer;
  fetchImpl?: typeof fetch;
}
const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const CHUNK_BYTES = 3072;
const MAX_RESPONSE_BYTES = 65536;
const MAX_ENVELOPE_BYTES = 16384;
const record = (v:unknown):v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function fail(code:string):never { throw Error(`GITHUB_COORDINATOR_ARCHIVE_${code}`); }
const sha256=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const blobSha=(bytes:Buffer)=>createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
function base64(v:unknown,limit:number):Buffer {
  if(typeof v!=='string'||v.length>Math.ceil(limit/3)*4||v.length===0) fail('CORRUPT');
  const value=Buffer.from(v,'base64');
  if(!value.length||value.length>limit||value.toString('base64')!==v)fail('CORRUPT');
  return value;
}
export function assertArchivePointer(v:unknown): asserts v is CheckpointArchivePointer {
  if(!record(v)||Object.keys(v).sort().join(',') !== 'byteLength,contentSha256,headSha256,parts,previousHeadSha256,version' ||
     v.version!==1||typeof v.headSha256!=='string'||!HASH.test(v.headSha256)||
     typeof v.contentSha256!=='string'||!HASH.test(v.contentSha256)||
     !Number.isSafeInteger(v.byteLength)|| (v.byteLength as number)<=0||
     !Number.isSafeInteger(v.parts)||(v.parts as number)<=0 ||
     (v.previousHeadSha256!==null && (typeof v.previousHeadSha256!=='string'||!HASH.test(v.previousHeadSha256))))fail('POINTER_INVALID');
}

export class GitHubCheckpointArchive {
  readonly #branch:string;
  readonly #url:string;
  readonly #key:Buffer;
  readonly #aad:Buffer;
  readonly #token:string;
  readonly #fetch:typeof fetch;
  constructor(options:CheckpointArchiveOptions){
    if(!options || !/^[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(options.repository) ||
       !/^goriq-state\/[A-Za-z0-9][A-Za-z0-9_/-]*$/.test(options.stateBranch) ||
       options.stateBranch.includes('//')|| options.stateBranch.endsWith('/') ||
       !/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,127}$/.test(options.clusterId) ||
       !Buffer.isBuffer(options.key)||options.key.length!==32 ||
       !/^[A-Za-z0-9_.-]{8,512}$/.test(options.token) ||
       (options.fetchImpl!==undefined&&typeof options.fetchImpl!=='function'))fail('CONFIG_INVALID');
    this.#branch=options.stateBranch;
    this.#token=options.token;
    this.#key=Buffer.from(options.key);
    this.#url=`https://api.github.com/repos/${options.repository}/contents/`;
    this.#aad=Buffer.from(JSON.stringify(['goriq-checkpoint-archive-v1',options.repository,options.stateBranch,options.clusterId]));
    this.#fetch=options.fetchImpl??fetch;
  }
  /** Stage an immutable, independently verified chain; it is NOT committed as
   * authority until the coordinator-store root CAS references this pointer.
   * This is streaming by part size, not infinite GitHub capacity or free quota.
   */
  async stage(json:string, previous:CheckpointArchivePointer|null):Promise<CheckpointArchivePointer>{
    if(typeof json!=='string'|| !json.length)fail('SNAPSHOT_INVALID');
    if(previous)assertArchivePointer(previous);
    const content=Buffer.from(json,'utf8');
    const parts=Math.ceil(content.length/CHUNK_BYTES);
    if(!Number.isSafeInteger(parts)||parts<1)fail('SNAPSHOT_INVALID');
    let prior:string|null=null;
    for(let index=0;index<parts;index++){
      const raw=content.subarray(index*CHUNK_BYTES,Math.min(content.length,(index+1)*CHUNK_BYTES));
      const plain={version:1,index,parts,previousPartSha256:prior,
        previousRevisionHeadSha256:previous?.headSha256??null, data:raw.toString('base64')};
      const bytes=this.#seal(plain);
      const id=sha256(bytes), path=`state/history/${id}.enc.json`;
      let response:Response;
      try {response=await this.#request(path,'PUT',JSON.stringify({branch:this.#branch,
        message:'chore(goriq): stage immutable encrypted Goal evidence',content:bytes.toString('base64')}));}
      catch {fail('WRITE_OUTCOME_UNKNOWN');}
      if(response.status!==201)fail(response.status>=500 || response.status===200 ? 'WRITE_OUTCOME_UNKNOWN' : 'WRITE_REJECTED');
      try {
        const receipt=await this.#json(response);
        if(!record(receipt)||!record(receipt.content)||receipt.content.sha!==blobSha(bytes)||
           !record(receipt.commit)||typeof receipt.commit.sha!=='string'||!SHA.test(receipt.commit.sha))fail('WRITE_OUTCOME_UNKNOWN');
        const fetched=await this.#getPart(id);
        if(!fetched.equals(bytes))fail('WRITE_OUTCOME_UNKNOWN');
      }catch{fail('WRITE_OUTCOME_UNKNOWN');}
      prior=id;
    }
    if(!prior)fail('SNAPSHOT_INVALID');
    return {version:1,headSha256:prior,contentSha256:sha256(content),byteLength:content.length,
      parts,previousHeadSha256:previous?.headSha256??null};
  }
  /** Resolve a pinned immutable snapshot. Fails closed for missing, out-of-order,
   * replaced, truncated or corrupted parts. No unbounded retry/fallback.
   */
  async restore(pointer:CheckpointArchivePointer):Promise<string>{
    assertArchivePointer(pointer);
    const parts:Buffer[]=new Array(pointer.parts);
    let head:string|null=pointer.headSha256;
    for(let index=pointer.parts-1;index>=0;index--){
      if(!head)fail('CHAIN_INVALID');
      const wire=await this.#getPart(head);
      const item=this.#open(wire);
      if(!record(item)||Object.keys(item).sort().join(',')!=='data,index,parts,previousPartSha256,previousRevisionHeadSha256,version' ||
         item.version!==1||item.index!==index||item.parts!==pointer.parts||
         item.previousRevisionHeadSha256!==pointer.previousHeadSha256 ||
         (item.previousPartSha256!==null && (typeof item.previousPartSha256!=='string'||!HASH.test(item.previousPartSha256))))fail('CHAIN_INVALID');
      parts[index]=base64(item.data,CHUNK_BYTES);
      head=item.previousPartSha256 as string|null;
    }
    if(head!==null)fail('CHAIN_INVALID');
    const restored=Buffer.concat(parts);
    if(restored.length!==pointer.byteLength||sha256(restored)!==pointer.contentSha256)fail('CHAIN_INVALID');
    const json=restored.toString('utf8');
    if(!Buffer.from(json,'utf8').equals(restored))fail('CHAIN_INVALID');
    return json;
  }
  #seal(value:unknown):Buffer{
    const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.#key,nonce);
    cipher.setAAD(this.#aad);
    const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
    return Buffer.from(JSON.stringify({version:1,algorithm:'aes-256-gcm',nonce:nonce.toString('base64'),
      ciphertext:ciphertext.toString('base64'),tag:cipher.getAuthTag().toString('base64')}));
  }
  #open(wire:Buffer):unknown{
    try {
      const value:unknown=JSON.parse(wire.toString('utf8'));
      if(!record(value)||Object.keys(value).sort().join(',')!=='algorithm,ciphertext,nonce,tag,version'||
         value.version!==1||value.algorithm!=='aes-256-gcm')fail('CORRUPT');
      const nonce=base64(value.nonce,12),tag=base64(value.tag,16);
      if(nonce.length!==12||tag.length!==16)fail('CORRUPT');
      const decipher=createDecipheriv('aes-256-gcm',this.#key,nonce);
      decipher.setAAD(this.#aad);decipher.setAuthTag(tag);
      const data=Buffer.concat([decipher.update(base64(value.ciphertext,8192)),decipher.final()]);
      return JSON.parse(data.toString('utf8'));
    }catch{fail('CORRUPT');}
  }
  async #getPart(id:string):Promise<Buffer>{
    if(!HASH.test(id))fail('CHAIN_INVALID');
    const path=`state/history/${id}.enc.json`;
    let response:Response;
    try{response=await this.#request(path,'GET');}catch{fail('READ_UNAVAILABLE');}
    if(response.status!==200)fail('READ_UNAVAILABLE');
    const value=await this.#json(response);
    if(!record(value)||value.type!=='file'||value.path!==path||value.encoding!=='base64'||
       typeof value.sha!=='string'||!SHA.test(value.sha)||typeof value.content!=='string')fail('CORRUPT');
    const bytes=base64(value.content.replace(/[\r\n]/g,''),MAX_ENVELOPE_BYTES);
    if(blobSha(bytes)!==value.sha||sha256(bytes)!==id)fail('CORRUPT');
    return bytes;
  }
  async #request(path:string,method:'GET'|'PUT',body?:string):Promise<Response>{
    return this.#fetch(`${this.#url}${path}`+(method==='GET'?`?ref=${encodeURIComponent(this.#branch)}`:''),{
      method,redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{Authorization:`Bearer ${this.#token}`,Accept:'application/vnd.github+json',
        'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
      ...(body===undefined?{}:{body}),
    });
  }
  async #json(response:Response):Promise<unknown>{
    const reader=response.body?.getReader();if(!reader)fail('CORRUPT');
    const chunks:Buffer[]=[];let size=0;
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
      if(size>MAX_RESPONSE_BYTES){await reader.cancel().catch(()=>undefined);fail('RESPONSE_TOO_LARGE');}
      chunks.push(Buffer.from(part.value));}}
    catch(e){if(e instanceof Error&&e.message==='GITHUB_COORDINATOR_ARCHIVE_RESPONSE_TOO_LARGE')throw e;fail('READ_UNAVAILABLE');}
    finally{reader.releaseLock();}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('CORRUPT');}
  }
}
