import { NextResponse } from "next/server";
import { createOwnerSessionToken, OWNER_SESSION_COOKIE, verifyOwnerPasscode } from "../../owner-auth.ts";

export async function POST(request: Request) {
  const secret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
  if (!secret) return new NextResponse("Owner login is not configured", { status: 503 });

  const form = await request.formData();
  const passcode = String(form.get("passcode") ?? "");
  if (!verifyOwnerPasscode(secret, passcode)) return new NextResponse("Unauthorized", { status: 401 });

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(OWNER_SESSION_COOKIE, createOwnerSessionToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
