import { timingSafeEqual } from "node:crypto";

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isAuthorizedRemoteMcpRequest(request: Request, secret: string): boolean {
  if (!secret) return false;
  const authorization = request.headers.get("authorization")?.trim() || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return Boolean(match?.[1] && sameSecret(match[1], secret));
}
