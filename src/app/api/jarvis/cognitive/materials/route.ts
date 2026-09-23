import { jarvisBrokerFetch, requireJarvisOwner } from "../../broker.ts";
import { createCognitiveMaterialProxy } from "../../../../../orchestrator/cognitive-material-proxy.ts";
const proxy = createCognitiveMaterialProxy(requireJarvisOwner, jarvisBrokerFetch);
export const GET = proxy.GET;
export const POST = proxy.POST;
