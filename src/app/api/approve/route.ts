import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readDashboardState } from "../../dashboard-state.ts";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionToken } from "../../owner-auth.ts";

const PENDING_APPROVAL_COOKIE = "ai_company_approval_pending";

export async function POST(request: Request) {
  const ownerSecret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
  const githubToken = process.env.AI_COMPANY_GITHUB_TOKEN?.trim() || "";
  const repository = process.env.AI_COMPANY_GITHUB_REPOSITORY?.trim() || "haji84/AI-";
  if (!ownerSecret || !githubToken) return new NextResponse("Approval dispatch is not configured", { status: 503 });

  const cookieStore = await cookies();
  if (!verifyOwnerSessionToken(ownerSecret, cookieStore.get(OWNER_SESSION_COOKIE)?.value)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const form = await request.formData();
  const approvalKey = String(form.get("approvalKey") ?? "").trim();
  const dashboard = await readDashboardState();
  const decision = dashboard.decisions.find((item) => item.approvalKey === approvalKey);
  if (!approvalKey || !decision) return new NextResponse("Approval request is stale or does not match the active HIGH-risk action", { status: 409 });

  const response = await fetch(`https://api.github.com/repos/${repository}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: "ai-autonomy-run",
      client_payload: { approval_key: approvalKey },
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    return new NextResponse(`Approval dispatch failed: ${response.status} ${detail}`, { status: 502 });
  }

  const redirect = NextResponse.redirect(new URL("/?approval=sent", request.url), 303);
  redirect.cookies.set(PENDING_APPROVAL_COOKIE, approvalKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 120,
  });
  return redirect;
}
