import { resolve } from "node:path";
import { TeachingStore } from "./teaching.ts";
const shared=globalThis as typeof globalThis & {__jarvisTeachingStore?:TeachingStore};
export function teachingStore(){return shared.__jarvisTeachingStore??=new TeachingStore(process.env.JARVIS_TEACHING_PATH?.trim()||resolve('.jarvis/teaching.json'));}
