import { createCognitiveGoalProxy } from "../../../../../orchestrator/cognitive-material-proxy.ts";
import { requireJarvisOwner, jarvisBrokerFetch } from "../../broker.ts";
export const POST = createCognitiveGoalProxy(requireJarvisOwner, jarvisBrokerFetch);
