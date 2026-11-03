import TaskBoard from "../tasks/TaskBoard";

export const dynamic = "force-dynamic";

export default function GoriqDecisionsPage() {
  return <TaskBoard filter="needs-human" />;
}
