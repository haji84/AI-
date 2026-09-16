import { NextResponse } from "next/server";
import { JarvisRemoteAssistRecordingHistory } from "../../../../jarvis/remote-assist-recording-history.ts";
import { requireJarvisOwner } from "../broker.ts";

export const dynamic = "force-dynamic";

const history = new JarvisRemoteAssistRecordingHistory(
  process.env.JARVIS_REMOTE_ASSIST_RECORDING_DIR?.trim() || undefined,
);

type RecordingPayload =
  | { action: "frame" | "download-frame"; recordingId?: string; frameNumber?: number }
  | { action: "export"; recordingId?: string };

function errorStatus(message: string): number {
  if (message.includes("not found")) return 404;
  if (message.includes("invalid") || message.includes("not ready") || message.includes("unsafe")) return 400;
  return 500;
}

export async function GET(request: Request) {
  if (!await requireJarvisOwner()) return NextResponse.json({ message: "Owner authentication required" }, { status: 401 });
  try {
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? 10 : Number(rawLimit);
    return NextResponse.json({ recordings: history.listRecent(limit) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list Remote Assist recordings";
    return NextResponse.json({ message }, { status: errorStatus(message) });
  }
}

export async function POST(request: Request) {
  if (!await requireJarvisOwner()) return NextResponse.json({ message: "Owner authentication required" }, { status: 401 });
  let payload: RecordingPayload;
  try {
    payload = await request.json() as RecordingPayload;
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  try {
    if (!payload.recordingId) throw new Error("invalid recordingId");
    if (payload.action === "frame" || payload.action === "download-frame") {
      if (!Number.isInteger(payload.frameNumber)) throw new Error("invalid frameNumber");
      const frame = history.readFrame(payload.recordingId, payload.frameNumber as number);
      if (payload.action === "download-frame") {
        return new Response(Buffer.from(frame.imageBase64, "base64"), {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Content-Disposition": `attachment; filename="jarvis-recording-${frame.recordingId}-frame-${String(frame.frameNumber).padStart(4, "0")}.png"`,
            "Cache-Control": "no-store",
          },
        });
      }
      return NextResponse.json({ recording: history.get(payload.recordingId), frame }, { headers: { "Cache-Control": "no-store" } });
    }
    if (payload.action === "export") {
      const bundle = history.exportBundle(payload.recordingId);
      return new Response(`${JSON.stringify(bundle, null, 2)}\n`, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="jarvis-recording-${bundle.recording.id}.json"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json({ message: "Unknown recording action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Remote Assist recording request failed";
    return NextResponse.json({ message }, { status: errorStatus(message) });
  }
}
