import { readFile } from "node:fs/promises";
import path from "node:path";

import Dashboard from "./dashboard";
import { parseProjectState } from "../dashboard/project-state";

export const dynamic = "force-static";

export default async function Home() {
  const source = await readFile(path.join(process.cwd(), "PROJECT_STATE.md"), "utf8");
  const project = parseProjectState(source);

  return <Dashboard project={project} />;
}
