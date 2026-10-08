import { privatePcRelay } from "../../../../../jarvis/private-pc-transport.ts";
import { privatePcIngressReady, nativePrivatePcSigner } from "../../../../../jarvis/private-pc-native.ts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 40;
// Native private Serve only; hosted requests refuse before key or Broker access.
export const POST = privatePcRelay({ ingress: privatePcIngressReady, signer: nativePrivatePcSigner });
