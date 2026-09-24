import { jarvisBrokerFetch, requireJarvisOwner } from "../broker.ts";
import { createCognitiveProxy } from "../../../../orchestrator/cognitive-proxy.ts";
const proxy = createCognitiveProxy(requireJarvisOwner, jarvisBrokerFetch);
export const GET = proxy.GET;
export const POST = proxy.POST;
