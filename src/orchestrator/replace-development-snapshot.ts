import { rename } from "node:fs/promises";

/** Retry only the same atomic rename while the caller retains its write lease.
 * Windows readers/scanners can briefly deny replacement. Never remove the
 * destination to work around that denial: a complete old snapshot stays visible.
 */
export async function replaceDevelopmentSnapshot(temporary:string,destination:string):Promise<void>{
  const waits=[10,20,40,80];
  for(let attempt=0;;attempt++){
    try{await rename(temporary,destination);return;}
    catch(error){
      const wait=waits[attempt];
      if(process.platform!=="win32"||(error as NodeJS.ErrnoException).code!=="EPERM"||wait===undefined)throw error;
      await new Promise<void>(resolve=>setTimeout(resolve,wait));
    }
  }
}
