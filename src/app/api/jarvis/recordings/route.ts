import { recordingPlaybackResponse } from "../../../../jarvis/remote-assist-playback.ts";
import { requireJarvisOwner } from "../broker.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return recordingPlaybackResponse(request, await requireJarvisOwner(), process.env.JARVIS_REMOTE_ASSIST_RECORDING_DIR?.trim() || undefined);
}
