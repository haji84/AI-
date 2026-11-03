import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
export function summarizeIPhones(records) {
 if (!Array.isArray(records)) return {readable:false,physicalIPhoneCount:null,availablePhysicalIPhoneCount:null};
 const phones=records.filter(d=>d?.simulator===false&&(String(d.platform??'').toLowerCase()==='com.apple.platform.iphoneos'||String(d.platform??'').toLowerCase()==='iphoneos'||/^iphone(?:\s|\d|$)/i.test(String(d.modelName??''))));
 return {readable:true,physicalIPhoneCount:phones.length,availablePhysicalIPhoneCount:phones.filter(d=>d.available===true).length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const output={schemaVersion:1,issue:1218,sourceRevision:/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA??'')?process.env.GITHUB_SHA:null,readOnly:true,uiControlVerified:false,pairingPerformed:false,installationPerformed:false,signingOrCredentialStoreRead:false,originalAcceptanceConditionsPassed:0};
 let counts=summarizeIPhones(null);
 if(process.platform==='darwin')try{const r=await promisify(execFile)('xcrun',['xcdevice','list','--timeout','15'],{encoding:'utf8',timeout:20000,maxBuffer:262144});counts=summarizeIPhones(JSON.parse(r.stdout));}catch{/* Only fixed availability facts leave this process. */}
 console.log(JSON.stringify({...output,...counts}));if(!counts.readable)process.exitCode=1;
}
