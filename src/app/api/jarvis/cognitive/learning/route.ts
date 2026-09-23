import { jarvisBrokerFetch, requireJarvisOwner } from "../../broker.ts";
import { createCognitiveLearningProxy } from "../../../../../orchestrator/cognitive-material-proxy.ts";
export const POST = createCognitiveLearningProxy(requireJarvisOwner, jarvisBrokerFetch);
