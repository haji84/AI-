import { cognitiveHostOptions } from "../src/gai/cognitive-host-config.ts";
import { resolve } from "node:path";
import { CognitiveService } from "../src/gai/cognitive-service.ts";
const dbPath = process.env.JARVIS_COMPASS_DB_PATH?.trim() || process.env.COMPASS_DB_PATH?.trim();
if (!dbPath) throw Error("Explicit existing Compass DB path required");
const mode = process.argv[2] ?? "status";
if (!["status", "continue", "training-candidate", "correct"].includes(mode)) throw Error("Use status, continue, training-candidate, or correct ORIGINAL_EXPERIENCE REPLACEMENT_EXPERIENCE");
const service = new CognitiveService(resolve(dbPath), cognitiveHostOptions(process.env));
const status = await service.status();
if (mode === "continue") {
  if (!status.goalId) throw Error("Set a Goal using existing Goal Controller first");
  console.log(JSON.stringify(await service.continue(status.goalId), null, 2));
} else if (mode === "correct") {
  if (!status.goalId || !process.argv[3] || !process.argv[4]) throw Error("Current Goal and two experience IDs required");
  console.log(JSON.stringify(await service.correct(status.goalId, process.argv[3], process.argv[4]), null, 2));
} else if (mode === "training-candidate") {
  const candidate = await service.trainingCandidate();
  console.log(JSON.stringify({ digest: candidate.digest, train: candidate.train.length, validation: candidate.validation.length, heldout: candidate.heldout.length, training: candidate.training }, null, 2));
} else console.log(JSON.stringify(status, null, 2));
