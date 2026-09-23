import {requireJarvisOwner,jarvisBrokerFetch} from "../broker.ts";
import {createRequirementsProxy} from "../../../../orchestrator/requirements-proxy.ts";
const proxy=createRequirementsProxy(requireJarvisOwner,jarvisBrokerFetch);
export const GET=proxy.GET;
export const POST=proxy.POST;
