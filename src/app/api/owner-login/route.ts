import { NextResponse } from "next/server";
import { createOwnerSessionToken, OWNER_SESSION_COOKIE, verifyOwnerPasscode } from "../../owner-auth.ts";
import { jarvisOwnerSecret } from "../jarvis/broker.ts";
import { ownerLoginLocation } from "../../owner-login-redirect.ts";

const OWNER_SESSION_MAX_AGE = 60 * 60 * 24 * 180;

export async function POST(request: Request) {
  const secret = jarvisOwnerSecret();
  if (!secret) return new NextResponse("JARVIS owner login is not configured", { status: 503 });

  const form = await request.formData();
  const passcode = String(form.get("passcode") ?? "");
  const requestedNext = String(form.get("next") ?? "/jarvis");
  if (!verifyOwnerPasscode(secret, passcode)) return new NextResponse(null, { status: 303, headers: { Location: ownerLoginLocation(requestedNext, true) } });

  const response = new NextResponse(null, { status: 303, headers: { Location: ownerLoginLocation(requestedNext) } });
  response.cookies.set(OWNER_SESSION_COOKIE, createOwnerSessionToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: OWNER_SESSION_MAX_AGE,
  });
  return response;
}
