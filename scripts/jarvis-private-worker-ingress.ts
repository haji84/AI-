import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { privateWorkerBind, privateWorkerHandler } from "../src/jarvis/private-worker-ingress.ts";

// Deliberately separate from the owner dashboard and its authenticated admin routes.
if (process.env.JARVIS_PRIVATE_WORKER_INGRESS_ENABLED !== "1") throw new Error("Private Worker ingress is not enabled");
const host = privateWorkerBind(process.env.JARVIS_PRIVATE_WORKER_HOST || "");
const port = Number(process.env.JARVIS_PRIVATE_WORKER_PORT || 8792);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid private Worker port");
const brokerPort = Number(process.env.JARVIS_BROKER_PORT || 8787);
if (!Number.isInteger(brokerPort) || brokerPort < 1024 || brokerPort > 65535) throw new Error("Invalid Broker port");
const certPath = process.env.JARVIS_PRIVATE_WORKER_CERT_PATH;
const keyPath = process.env.JARVIS_PRIVATE_WORKER_KEY_PATH;
if (!certPath || !keyPath) throw new Error("Installation TLS certificate and private key are required");
const server = createServer({ cert: readFileSync(certPath), key: readFileSync(keyPath), minVersion: "TLSv1.2" }, privateWorkerHandler(brokerPort));
server.requestTimeout = 20_000;
server.headersTimeout = 10_000;
server.maxConnections = 128;
server.listen(port, host, () => console.log(`[jarvis-private-worker] HTTPS ready on ${host}:${port}; worker routes only`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
