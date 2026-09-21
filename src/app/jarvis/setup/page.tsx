import { requireJarvisOwner } from "../../api/jarvis/broker.ts";
import OwnerLogin from "../OwnerLogin";
import SetupWizardClient from "./SetupWizardClient.tsx";

export const dynamic = "force-dynamic";

export default async function JarvisSetupPage() {
  if (!await requireJarvisOwner()) return <main className="dashboard-shell"><OwnerLogin /></main>;

  return (
    <main className="dashboard-shell">
      <SetupWizardClient />
    </main>
  );
}
