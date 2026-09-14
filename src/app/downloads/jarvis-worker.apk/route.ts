import { NextResponse } from "next/server";
import { jarvisBrokerFetch } from "../../api/jarvis/broker.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const upstream = await jarvisBrokerFetch("/downloads/jarvis-worker.apk", {
      headers: { Accept: "application/vnd.android.package-archive" },
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { message: "JARVIS Worker APK is temporarily unavailable" },
        { status: upstream.status || 503 },
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", "application/vnd.android.package-archive");
    headers.set("Content-Disposition", "attachment; filename=jarvis-worker.apk");
    headers.set("Cache-Control", "no-store, max-age=0");
    headers.set("X-Content-Type-Options", "nosniff");

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return NextResponse.json(
      { message: "JARVIS Worker APK is temporarily unavailable" },
      { status: 503 },
    );
  }
}
