import { requireJarvisOwner } from '../broker.ts';
import { factAuditRequest, factAuditStore } from '../../../../jarvis/fact-audit-runtime.ts';
export const dynamic='force-dynamic';
const deps={authorize:requireJarvisOwner,store:factAuditStore};
export async function POST(request:Request){return factAuditRequest(request,deps);}
export async function GET(request:Request){return factAuditRequest(request,deps);}
