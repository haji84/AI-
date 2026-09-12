import type { JarvisConnectionSnapshot, JarvisRouteDecision } from "./types.ts";

export function resolveJarvisRoute(snapshot: JarvisConnectionSnapshot): JarvisRouteDecision {
  if (snapshot.mobileOnline && snapshot.pcOnline) {
    return {
      mode: "full-online",
      transport: "internet",
      canExecuteOnlineTasks: true,
      shouldQueueRemoteWork: false,
    };
  }

  if (!snapshot.mobileOnline && snapshot.pcOnline) {
    if (snapshot.sameLanAvailable) {
      return {
        mode: "lan-only",
        transport: "lan",
        canExecuteOnlineTasks: true,
        shouldQueueRemoteWork: false,
      };
    }
    return {
      mode: "mobile-offline",
      transport: "queue",
      canExecuteOnlineTasks: false,
      shouldQueueRemoteWork: true,
    };
  }

  if (snapshot.mobileOnline && !snapshot.pcOnline) {
    return {
      mode: "pc-offline",
      transport: "internet",
      canExecuteOnlineTasks: true,
      shouldQueueRemoteWork: true,
    };
  }

  if (snapshot.sameLanAvailable) {
    return {
      mode: "lan-only",
      transport: "lan",
      canExecuteOnlineTasks: false,
      shouldQueueRemoteWork: false,
    };
  }

  return {
    mode: "full-offline",
    transport: "local",
    canExecuteOnlineTasks: false,
    shouldQueueRemoteWork: true,
  };
}
