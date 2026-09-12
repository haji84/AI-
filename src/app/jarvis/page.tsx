import JarvisConsole from "./JarvisConsole.tsx";

export const dynamic = "force-dynamic";

export default function JarvisPage() {
  return (
    <main className="dashboard-shell">
      <JarvisConsole />
    </main>
  );
}
