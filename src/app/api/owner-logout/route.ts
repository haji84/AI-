import { NextResponse } from "next/server";
import { OWNER_SESSION_COOKIE } from "../../owner-auth.ts";

function clearOwnerSession(response: NextResponse): NextResponse {
  response.cookies.set(OWNER_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function POST(request: Request) {
  const inline = request.headers.get("accept")?.includes("application/json");
  const response = inline
    ? NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
    : new NextResponse(null, {
        status: 303,
        headers: { Location: "/jarvis/login", "Cache-Control": "no-store" },
      });

  return clearOwnerSession(response);
}
