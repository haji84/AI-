import { safeOwnerReturnPath } from "../../owner-login-redirect.ts";
import OwnerLogin from "../OwnerLogin";

export default async function JarvisLoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const params = await searchParams;
  return <main className="dashboard-shell"><OwnerLogin next={safeOwnerReturnPath(params.next)} initialError={params.error === "1"} /></main>;
}
