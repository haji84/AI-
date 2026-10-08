import { createCognitiveGoalProposalProxy } from "../../../../../../orchestrator/cognitive-material-proxy.ts";
import { requireJarvisOwner, jarvisBrokerFetch } from "../../../broker.ts";
export const POST = createCognitiveGoalProposalProxy(requireJarvisOwner, jarvisBrokerFetch);
