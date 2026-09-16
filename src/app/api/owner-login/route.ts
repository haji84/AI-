import { NextResponse } from "next/server";
import {
  createOwnerSessionToken,
  OWNER_SESSION_COOKIE,
  OWNER_SESSION_MAX_AGE_SECONDS,
  verifyOwnerPasscode,
} from "../../owner-auth.ts";
import { jarvisOwnerSecret } from "../jarvis/broker.ts";
import { ownerLoginLocation } from "../../owner-login-redirect.ts";

export async function POST(request: Request) {
  const inline = request.headers.get("accept")?.includes("application/json");
  const secret = jarvisOwnerSecret();
  if (!secret) return inline ? NextResponse.json({ ok: false }, { status: 503 }) : new NextResponse("JARVIS owner login is not configured", { status: 503 });

  const form = await request.formData();
  const passcode = String(form.get("passcode") ?? "");
  const requestedNext = String(form.get("next") ?? "/jarvis");
  if (!verifyOwnerPasscode(secret, passcode)) return inline ? NextResponse.json({ ok: false }, { status: 401 }) : new NextResponse(null, { status: 303, headers: { Location: ownerLoginLocation(requestedNext, true) } });

  const response = inline ? NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }) : new NextResponse(null, { status: 303, headers: { Location: ownerLoginLocation(requestedNext) } });
  response.cookies.set(OWNER_SESSION_COOKIE, createOwnerSessionToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: OWNER_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
