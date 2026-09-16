import { NextResponse } from "next/server";
import {
  JarvisRemoteAssistRecordingHistory,
  JarvisRemoteAssistRecordingHistoryError,
} from "../../../../jarvis/remote-assist-recording-history.ts";
import { requireJarvisOwner } from "../broker.ts";

export const dynamic = "force-dynamic";

const history = new JarvisRemoteAssistRecordingHistory(
  process.env.JARVIS_REMOTE_ASSIST_RECORDING_DIR?.trim() || undefined,
);

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

type RecordingPayload =
  | { action: "frame" | "download-frame"; recordingId?: string; frameNumber?: number }
  | { action: "export"; recordingId?: string };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function publicError(error: unknown, fallback: string): { message: string; status: number } {
  if (!(error instanceof JarvisRemoteAssistRecordingHistoryError)) return { message: fallback, status: 500 };
  switch (error.code) {
    case "not-found":
      return { message: error.message, status: 404 };
    case "invalid-request":
    case "not-ready":
    case "unsafe-artifact":
    case "resource-limit":
      return { message: error.message, status: 400 };
    case "unavailable":
    default:
      return { message: fallback, status: 500 };
  }
}

export async function GET(request: Request) {
  if (!await requireJarvisOwner()) return json({ message: "Owner authentication required" }, 401);
  try {
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? 10 : Number(rawLimit);
    return json({ recordings: history.listRecent(limit) });
  } catch (error) {
    const safe = publicError(error, "Failed to list Remote Assist recordings");
    return json({ message: safe.message }, safe.status);
  }
}

export async function POST(request: Request) {
  if (!await requireJarvisOwner()) return json({ message: "Owner authentication required" }, 401);
  let payload: RecordingPayload;
  try {
    payload = await request.json() as RecordingPayload;
  } catch {
    return json({ message: "Invalid JSON body" }, 400);
  }

  if (!payload.recordingId) return json({ message: "invalid recordingId" }, 400);

  try {
    if (payload.action === "frame" || payload.action === "download-frame") {
      if (!Number.isInteger(payload.frameNumber)) return json({ message: "invalid frameNumber" }, 400);
      const frame = history.readFrame(payload.recordingId, payload.frameNumber as number);
      if (payload.action === "download-frame") {
        return new Response(Buffer.from(frame.imageBase64, "base64"), {
          status: 200,
          headers: {
            ...RESPONSE_HEADERS,
            "Content-Type": "image/png",
            "Content-Disposition": `attachment; filename="jarvis-recording-${frame.recordingId}-frame-${String(frame.frameNumber).padStart(4, "0")}.png"`,
          },
        });
      }
      return json({ recording: history.get(payload.recordingId), frame });
    }
    if (payload.action === "export") {
      const bundle = history.exportBundle(payload.recordingId);
      return new Response(`${JSON.stringify(bundle, null, 2)}\n`, {
        status: 200,
        headers: {
          ...RESPONSE_HEADERS,
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="jarvis-recording-${bundle.recording.id}.json"`,
        },
      });
    }
    return json({ message: "Unknown recording action" }, 400);
  } catch (error) {
    const safe = publicError(error, "Remote Assist recording request failed");
    return json({ message: safe.message }, safe.status);
  }
}
