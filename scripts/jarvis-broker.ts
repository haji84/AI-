import {requirementWorkflow,prepareOwnerPreview} from "./jarvis-requirement-workflow.mjs";
import { createSpecificationPublisher } from "./jarvis-spec-publisher.mjs";
import { fileURLToPath } from "node:url";
import { loadCanonicalBundle, prepareSpecificationProposal } from "./jarvis-owner-spec-sync.mjs";
import { OwnerRequirementIntake, matchRequirementCandidates } from "../src/orchestrator/owner-requirement-intake.ts";
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OwnerInvitationStore, INVITATION_PREFIX } from "../src/jarvis/owner-invitation.ts";
import { invitationUrl } from "../src/jarvis/invitation-link.ts";
import { FixedEnrollmentRateLimiter } from "../src/jarvis/fixed-enrollment.ts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  JarvisControlPlane,
  JarvisNonceRegistry,
  JarvisSqliteStateStore,
  verifyWorkerRequest,
  type JarvisCapability,
  type JarvisNode,
  type JarvisSignedWorkerRequest,
  type JarvisWorkerIdentity,
} from "../src/jarvis/index.ts";
import { JarvisEnrollmentPairingWindow } from "../src/jarvis/enrollment-pairing-window.ts";
import { JarvisDeviceReplacementTransport } from "../src/jarvis/device-replacement-transport.ts";
import { WorkerRemoteMailbox } from "../src/jarvis/worker-remote-mailbox.ts";
import { remoteDeviceInventory } from "../src/jarvis/remote-device-inventory.ts";
import { PendingEnrollment } from "../src/jarvis/pending-enrollment.ts";
import { CompassStore } from "../src/compass/store.ts";
import { GoalControllerRuntime } from "../src/orchestrator/goal-controller-runtime.ts";
import { CompassGoalRegistryAdapter, CompassGoalDecisionStoreAdapter } from "../src/orchestrator/compass-goal-controller.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { workRunProgress } from "../src/orchestrator/work-run-state.ts";
import { validateWindowsVerificationDispatch } from "../src/orchestrator/windows-verification-dispatch.ts";


const host = process.env.JARVIS_BROKER_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.JARVIS_BROKER_PORT || 8787);
const ownerToken = process.env.JARVIS_OWNER_TOKEN?.trim() || "";
const publicBrokerUrl = process.env.JARVIS_PUBLIC_BROKER_URL?.trim().replace(/\/$/, "") || "";
const workerInstallUrl = process.env.JARVIS_WORKER_INSTALL_URL?.trim() || "";
if (workerInstallUrl) {
  const parsed = new URL(workerInstallUrl);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Worker installation URL must be HTTPS without credentials");
}
const fixedEnrollmentUrl = workerInstallUrl || (publicBrokerUrl ? `${publicBrokerUrl}/enroll` : undefined);
const workerApkPath = process.env.JARVIS_WORKER_APK_PATH?.trim() || "";
const qrencodePath = process.env.JARVIS_QRENCODE_PATH?.trim() || "qrencode";

if (!ownerToken) throw new Error("JARVIS_OWNER_TOKEN is required");
if (host !== "127.0.0.1" && host !== "::1" && process.env.JARVIS_ALLOW_NON_LOOPBACK !== "1") {
  throw new Error("Refusing non-loopback broker bind unless JARVIS_ALLOW_NON_LOOPBACK=1. Put TLS/authenticated ingress in front of JARVIS Broker.");
}

const plane = new JarvisControlPlane();
const store = new JarvisSqliteStateStore(process.env.JARVIS_DB_PATH?.trim() || undefined);
const compassPath = process.env.JARVIS_COMPASS_DB_PATH?.trim() || (process.env.JARVIS_DB_PATH?.trim() ? `${process.env.JARVIS_DB_PATH.trim()}.compass.sqlite` : resolve(".jarvis/compass.db"));
const compass = new CompassStore(compassPath);
const workRuns = new CompassWorkRunStore(compass);
const ownerRequirements = new OwnerRequirementIntake(compass);
const specificationPublisher = createSpecificationPublisher({root:fileURLToPath(new URL("../",import.meta.url)),intake:ownerRequirements,token:process.env.GITHUB_TOKEN});
const goalController = new GoalControllerRuntime({
  registry: new CompassGoalRegistryAdapter(compass),
  decisionStore: new CompassGoalDecisionStoreAdapter(compass),
});
const persisted = store.load();
if (persisted) plane.restore(persisted);
const nonces = new JarvisNonceRegistry();
const remoteMailbox = new WorkerRemoteMailbox();
const pendingEnrollment = new PendingEnrollment();
const pairingWindow = new JarvisEnrollmentPairingWindow();
const invitations = new OwnerInvitationStore((process.env.JARVIS_DB_PATH?.trim() || resolve(".jarvis/jarvis.db")) + ".invitation.json");
const invitationLimiter = new FixedEnrollmentRateLimiter(60_000, 100, 200);
const replacementTransport = new JarvisDeviceReplacementTransport({ identityForNode: (nodeId) => store.getWorkerIdentity(nodeId) });
let lastHeartbeatPersist = 0;

type WorkerApkInfo = { path: string; url: string; bytes: Buffer; sha256Base64Url: string };
type EnrollmentGrant = { token: string; expiresAt: string };
const enrollmentGrants = new Map<string, EnrollmentGrant>();

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}
function html(response: ServerResponse, status: number, body: string): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'");
  response.end(body);
}
function workerApkInfo(): WorkerApkInfo | undefined {
  if (!workerApkPath || !publicBrokerUrl || !existsSync(workerApkPath)) return undefined;
  const bytes = readFileSync(workerApkPath);
  if (!bytes.length) return undefined;
  return { path: workerApkPath, url: `${publicBrokerUrl}/downloads/jarvis-worker.apk`, bytes, sha256Base64Url: createHash("sha256").update(bytes).digest("base64url") };
}
function issueEnrollmentGrant(token: string, expiresAt: string): string {
  const grant = randomBytes(24).toString("base64url");
  enrollmentGrants.set(grant, { token, expiresAt });
  return grant;
}
function resolveEnrollmentGrant(grant: string, now = Date.now()): EnrollmentGrant | undefined {
  const record = enrollmentGrants.get(grant);
  if (!record) return undefined;
  if (new Date(record.expiresAt).getTime() <= now) { enrollmentGrants.delete(grant); return undefined; }
  return record;
}
function oneTapEnrollmentPage(grant: string): string {
  const apk = workerApkInfo();
  const deepLink = `jarvis://enroll?broker=${encodeURIComponent(publicBrokerUrl)}&grant=${encodeURIComponent(grant)}&token=${encodeURIComponent(grant)}`;
  const apkHref = apk ? `${apk.url}?v=${apk.sha256Base64Url.slice(0, 12)}` : "";
  const installButton = apk
    ? `<a class="button" href="${apkHref}">最新版JARVIS Workerを更新・インストール</a>`
    : "<p class=\"note bad\">最新版Worker APKを準備できていません。管理者に確認してください。</p>";
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JARVISに登録</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f7f8;color:#111;margin:0;padding:28px}.card{max-width:560px;margin:10vh auto;background:white;border-radius:20px;padding:28px;box-shadow:0 10px 40px #00000012}h1{font-size:26px;margin:0 0 12px}p{line-height:1.65}.button,.secondary{display:block;text-align:center;text-decoration:none;border-radius:12px;padding:16px;margin-top:16px;font-weight:700}.button{background:#111;color:white}.secondary{background:#e9ecef;color:#111}.note{font-size:14px;color:#666}.bad{color:#a40000}.step{font-weight:700;margin-top:20px}</style></head>
<body><main class="card"><h1>JARVIS端末登録</h1><p>古いWorkerを先に起動しないよう、必ず最新版へ更新してから登録します。</p><p class="step">1. 最新版Workerへ更新</p>${installButton}<p class="note">既にWorkerが入っている場合は、アンインストールせず「更新」を選んでください。APKは内容ごとに異なるURLになるため、古いダウンロードの再利用を防ぎます。</p><p class="step">2. 更新完了後に登録</p><a id="open" class="secondary" href="${deepLink}">更新後にJARVISで登録する</a><p class="note">Mac/PCではJARVISアプリを自動起動しません。このページをAndroid端末で開いて操作してください。</p></main></body></html>`;
}
function expiredEnrollmentPage(): string {
  return "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>リンク期限切れ</title></head><body style=\"font-family:system-ui,sans-serif;padding:32px\"><h1>リンク期限切れ</h1><p>このJARVIS登録リンクは無効または期限切れです。管理者から新しい登録リンクを受け取ってください。</p></body></html>";
}
function pairingWindowUnavailablePage(reason: string): string {
  const detail = reason === "expired" ? "登録受付時間が終了しました。" : reason === "exhausted" ? "この登録受付枠は上限に達しました。" : "現在、端末登録の受付は停止しています。";
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登録受付停止中</title></head><body style="font-family:system-ui,sans-serif;padding:32px"><h1>登録受付停止中</h1><p>${detail}</p><p>JARVISのオーナー画面から登録ウィンドウを開いてください。</p></body></html>`;
}
function fullProvisioningPayload(brokerUrl: string, token: string, apk: WorkerApkInfo): Record<string, unknown> {
  return {
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": "ai.jarvis.worker/.JarvisDeviceAdminReceiver",
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION": apk.url,
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM": apk.sha256Base64Url,
    "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": { jarvis_broker: brokerUrl, jarvis_token: token },
  };
}
function provisioningQrPngBase64(payload: Record<string, unknown>): string | undefined {
  try {
    const png = execFileSync(qrencodePath, ["-o", "-", "-t", "PNG", "-m", "2", JSON.stringify(payload)], { encoding: "buffer", timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    return Buffer.isBuffer(png) && png.length ? png.toString("base64") : undefined;
  } catch { return undefined; }
}
async function readBody(request: IncomingMessage, limit = 1_000_000): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length;
    if (size > limit) throw new Error("request body too large"); chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
function parseJson(body: Buffer): Record<string, unknown> {
  if (body.length === 0) return {};
  const value = JSON.parse(body.toString("utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
  return value as Record<string, unknown>;
}
function safeEqualText(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8"); const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
function requireOwner(request: IncomingMessage): boolean {
  const auth = request.headers.authorization || "";
  return auth.startsWith("Bearer ") && safeEqualText(auth.slice(7), ownerToken);
}
function bodySha256(body: Buffer): string { return createHash("sha256").update(body).digest("hex"); }
function signedWorkerRequest(request: IncomingMessage, path: string, body: Buffer): JarvisSignedWorkerRequest | undefined {
  const nodeId = request.headers["x-jarvis-node-id"];
  const timestamp = request.headers["x-jarvis-timestamp"];
  const nonce = request.headers["x-jarvis-nonce"];
  const declaredBodySha = request.headers["x-jarvis-body-sha256"];
  const signatureBase64 = request.headers["x-jarvis-signature"];
  if (![nodeId, timestamp, nonce, declaredBodySha, signatureBase64].every((value) => typeof value === "string")) return undefined;
  if (!safeEqualText(declaredBodySha as string, bodySha256(body))) return undefined;
  return { nodeId: nodeId as string, timestamp: timestamp as string, nonce: nonce as string, method: request.method || "POST", path, bodySha256: declaredBodySha as string, signatureBase64: signatureBase64 as string };
}
function authenticateWorker(request: IncomingMessage, path: string, body: Buffer): JarvisWorkerIdentity | undefined {
  const signed = signedWorkerRequest(request, path, body); if (!signed) return undefined;
  const identity = store.getWorkerIdentity(signed.nodeId); if (!identity) return undefined;
  const checked = verifyWorkerRequest({ identity, request: signed, seenNonce: (nodeId, nonce) => nonces.has(nodeId, nonce) });
  if (!checked.ok) return undefined; nonces.record(signed.nodeId, signed.nonce); return identity;
}
function persist(immediate = true): void {
  const now = Date.now(); if (!immediate && now - lastHeartbeatPersist < 5_000) return;
  store.save(plane.snapshot()); lastHeartbeatPersist = now;
}
function asNumber(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function validatedNode(value: unknown): JarvisNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("node object required");
  const node = value as JarvisNode;
  if (!node.id || node.kind !== "android" || !Array.isArray(node.capabilities)) throw new Error("invalid Android node descriptor");
  if (node.policy?.allowPaidServices !== false) throw new Error("worker must disable paid services");
  return node;
}
function assignFleetNumber(node: JarvisNode): JarvisNode {
  const existing = plane.fleet.get(node.id);
  const used = new Set(plane.fleet.list().map((item) => item.fleetNumber).filter((value): value is number => typeof value === "number"));
  const fleetNumber = existing?.fleetNumber ?? Array.from({ length: 100 }, (_, index) => index + 1).find((value) => !used.has(value));
  if (!fleetNumber) throw new Error("JARVIS fleet has no free device number");
  const plainLabel = node.label.replace(/^Android\s+\d{3}\s+·\s+/, "");
  return { ...node, fleetNumber, label: `Android ${String(fleetNumber).padStart(3, "0")} · ${plainLabel}` };
}

const androidTaskCapabilities: Record<string, JarvisCapability> = {
  "open-url": "open-url", "open-app": "open-app", "launch-settings": "launch-settings", "wake-device": "wake-device",
  "device-status": "device-status", "show-notification": "show-notification", "lock-device": "lock-device", reboot: "reboot", "ui-sequence": "ui-automation",
};
function validatedAndroidTask(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (!(type in androidTaskCapabilities)) throw new Error(`unsupported Android task type: ${type}`);
  if (type === "open-url") {
    if (typeof payload.url !== "string" || !payload.url.startsWith("https://")) throw new Error("open-url requires HTTPS");
    return { url: payload.url, allowJavaScript: payload.allowJavaScript === true };
  }
  if (type === "open-app") {
    if (typeof payload.packageName !== "string" || !payload.packageName.trim()) throw new Error("open-app requires packageName");
    return { packageName: payload.packageName.trim() };
  }
  if (type === "launch-settings") {
    const screen = typeof payload.screen === "string" ? payload.screen : "settings";
    if (!["settings", "accessibility", "wifi", "bluetooth", "app"].includes(screen)) throw new Error("unsupported settings screen");
    return { screen };
  }
  if (type === "show-notification") return { title: typeof payload.title === "string" ? payload.title.slice(0, 100) : "JARVIS", message: typeof payload.message === "string" ? payload.message.slice(0, 500) : "JARVISからの通知", id: asNumber(payload.id, 4100) };
  if (type === "ui-sequence") {
    if (!Array.isArray(payload.steps) || payload.steps.length < 1 || payload.steps.length > 50) throw new Error("ui-sequence requires 1..50 steps");
    return { steps: payload.steps };
  }
  return {};
}

async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url || "/", "http://localhost");
  const path = url.pathname; const method = request.method || "GET";
  const body = method === "GET" || method === "HEAD" ? Buffer.alloc(0) : await readBody(request);

  if (method === "GET" && path === "/health") return json(response, 200, { ok: true, service: "jarvis-broker", stats: plane.snapshot().stats, workerApkReady: Boolean(workerApkInfo()), pairingWindow: pairingWindow.status() });
  if (method === "POST" && path === "/api/jarvis/enrollment-grant") {
    // Same owner-opened, bounded window as /enroll; never opens itself on worker demand.
    let origin: URL;
    try { origin = new URL(publicBrokerUrl); }
    catch { return json(response, 503, { message: "enrollment host not configured" }); }
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
      return json(response, 503, { message: "HTTPS enrollment origin required" });
    }
    const reservation = pairingWindow.reserveIssue();
    if (!reservation) return json(response, 503, { message: "enrollment window unavailable" });
    const token = plane.createEnrollment({ mode: "quick", ttlMs: reservation.grantTtlMs, maxDevices: 1, group: reservation.group });
    const grant = issueEnrollmentGrant(token.token, token.expiresAt);
    response.setHeader("Referrer-Policy", "no-referrer");
    return json(response, 201, { grant, expiresAt: token.expiresAt });
  }
  if (method === "GET" && path === "/enroll") {
    const current = pairingWindow.status();
    if (!publicBrokerUrl || !current.open) return html(response, 503, pairingWindowUnavailablePage(publicBrokerUrl ? current.reason : "closed"));
    const reservation = pairingWindow.reserveIssue();
    if (!reservation) return html(response, 503, pairingWindowUnavailablePage(pairingWindow.status().reason));
    const token = plane.createEnrollment({ mode: "quick", ttlMs: reservation.grantTtlMs, maxDevices: 1, group: reservation.group });
    const grant = issueEnrollmentGrant(token.token, token.expiresAt);
    return html(response, 200, oneTapEnrollmentPage(grant));
  }
  if (method === "GET" && path.startsWith("/enroll/")) {
    const grant = decodeURIComponent(path.slice("/enroll/".length));
    if (!publicBrokerUrl || !grant || !resolveEnrollmentGrant(grant)) return html(response, 410, expiredEnrollmentPage());
    return html(response, 200, oneTapEnrollmentPage(grant));
  }
  if (method === "GET" && path === "/downloads/jarvis-worker.apk") {
    const apk = workerApkInfo(); if (!apk) return json(response, 404, { message: "JARVIS Worker APK is not ready" });
    response.statusCode = 200; response.setHeader("Content-Type", "application/vnd.android.package-archive");
    response.setHeader("Content-Disposition", "attachment; filename=jarvis-worker.apk"); response.setHeader("Content-Length", String(apk.bytes.length));
    response.setHeader("Cache-Control", "no-store"); response.end(apk.bytes); return;
  }

  if (path.startsWith("/api/jarvis/admin/")) {
    if (!requireOwner(request)) return json(response, 401, { message: "owner authorization required" });
    const payload = parseJson(body);
    if (method === "GET" && path === "/api/jarvis/admin/state") return json(response, 200, plane.snapshot());
    if (method === "GET" && path === "/api/jarvis/admin/requirements") return json(response, 200, requirementWorkflow(ownerRequirements.list(),loadCanonicalBundle(fileURLToPath(new URL("../",import.meta.url))),fileURLToPath(new URL("../",import.meta.url)),!!process.env.GITHUB_TOKEN));
    if (method === "POST" && path === "/api/jarvis/admin/requirements/publish") {
      if (body.byteLength > 32768 || typeof payload.decisionId !== "string" || Object.keys(payload).some(k => !["decisionId","review"].includes(k))) return json(response,400,{message:"invalid specification publication input"});
      try { return json(response,200,await specificationPublisher.publish(payload.decisionId,payload.review)); }
      catch(error) { const message=error instanceof Error?error.message:"specification_publication_failed"; return json(response,message==="github_write_unavailable"?503:409,{message}); }
    }
    if(method==="POST"&&path==="/api/jarvis/admin/requirements/preview"){
      if(body.byteLength>32768||Object.keys(payload).some(k=>!["decisionId","choice"].includes(k)))return json(response,400,{message:"invalid preview input"});
      try{
       const record=ownerRequirements.list().find(r=>r.id===payload.decisionId);
       if(!record)return json(response,404,{message:"owner requirement not found"});
       const root=fileURLToPath(new URL("../",import.meta.url));
       const {bundle:_bundle,files,...preview}=prepareOwnerPreview(record,loadCanonicalBundle(root),payload.choice,root,ownerRequirements.list());
       void _bundle;return json(response,200,{...preview,files:files.map(f=>({path:f.path,baseSha256:f.baseSha256,bytes:Buffer.byteLength(f.content)}))});
      }catch(e){return json(response,409,{message:e instanceof Error?e.message:"preview_failed"});}
    }
    if (method === "POST" && path === "/api/jarvis/admin/requirements/proposal") {
      try {
        const record = ownerRequirements.list().find(r => r.id === payload.decisionId);
        if (!record) return json(response, 404, { message: "owner requirement not found" });
        const root = fileURLToPath(new URL("../", import.meta.url));
        const proposal = prepareSpecificationProposal(record, loadCanonicalBundle(root), payload.review, root, ownerRequirements.list());
        const { bundle: _bundle, ...artifact } = proposal;
        void _bundle;
        return json(response, 200, artifact);
      } catch (error) { return json(response, 409, { message: error instanceof Error ? error.message : "specification proposal failed" }); }
    }
    if (method === "GET" && path.startsWith("/api/jarvis/admin/work/")) {
      const goalId = decodeURIComponent(path.slice("/api/jarvis/admin/work/".length));
      const run = await workRuns.getByGoal(goalId);
      if (!run) return json(response, 404, { message: "Work Runがありません", goalId });
      return json(response, 200, { run, progress: workRunProgress(run) });
    }
    if (method === "POST" && path === "/api/jarvis/admin/work") {
      try {
        if (body.length > 64_000) return json(response, 413, { message: "work input too large" });
        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (!text) return json(response, 400, { message: "仕事の内容を入力してください" });
        const idempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey.trim() : undefined;
        const activeGoal = (await new CompassGoalRegistryAdapter(compass).listActive())[0];
        if(payload.requirementReferenceId!==undefined&&typeof payload.requirementReferenceId!=="string")return json(response,400,{message:"invalid requirement reference"});
        const prepared = payload.requirement!==undefined ? ownerRequirements.prepare(text,idempotencyKey,payload.requirement) : ownerRequirements.prepareConversation(text,idempotencyKey,{goalId:activeGoal?.goalId??null,referenceId:payload.requirementReferenceId as string|undefined});
        if(prepared.resolution?.needsClarification)return json(response,202,{accepted:false,requirement:null,conversation:prepared.resolution,goalId:activeGoal?.goalId??null,action:"CLARIFY_REQUIREMENT",nextAction:prepared.resolution.message});
        const rows = JSON.parse(readFileSync(new URL("../docs/jarvis-requirements.json", import.meta.url), "utf8")).requirements;
        if (prepared.input) matchRequirementCandidates(prepared.input, rows);
        // Write the receipt before creating/changing Goal state. An interrupted bind
        // leaves a visible unassigned sync gate instead of an untracked accepted Goal.
        let requirement = ownerRequirements.capture(prepared, activeGoal?.goalId ?? null, rows);
        const decision = await goalController.handle({ source: "jarvis", text, idempotencyKey: prepared.input ? prepared.keyDigest : idempotencyKey });
        if (requirement) requirement = ownerRequirements.bindGoal(requirement.id, decision.goalId ?? activeGoal?.goalId ?? null);
        return json(response, 202, {
          accepted: true,
          requirement,
          conversation: prepared.resolution ?? null,
          goalId: decision.goalId ?? null,
          action: decision.action,
          resolution: decision.resolution.kind,
          nextAction: decision.nextAction ?? null,
          remainingCriteria: decision.remainingCriteria ?? [],
        });
      } catch (error) {
        return json(response, 409, { message: error instanceof Error ? error.message : "Goal受付に失敗しました" });
      }
    }
    if (path === "/api/jarvis/admin/enrollment-pending") {
      if (method === "GET") return json(response, 200, { pending: pendingEnrollment.list() });
      if (method === "POST") {
        if (!Array.isArray(payload.ids) || !payload.ids.every(id => typeof id === "string")) return json(response, 400, { message: "登録する端末を選択してください" });
        try {
          const candidates = pendingEnrollment.selected(payload.ids as string[]);
          if (plane.fleet.list().length + candidates.length > 100) throw new Error("Fleet capacity reached");
          if (candidates.some(item => plane.fleet.get(item.node.id) || store.getWorkerIdentity(item.node.id))) throw new Error("Existing identity cannot be overwritten");
          const enrolled: string[] = [];
          for (const candidate of candidates) {
            const token = plane.createEnrollment({ mode: "quick", ttlMs: 30 * 60_000, maxDevices: 1 }).token;
            const node = plane.enroll(token, assignFleetNumber(candidate.node));
            store.saveWorkerIdentity(candidate.identity); persist();
            pendingEnrollment.complete(node.id); enrolled.push(node.id);
          }
          return json(response, 201, { enrolled, pending: pendingEnrollment.list() });
        } catch (error) { return json(response, 409, { message: error instanceof Error ? error.message : "登録できません" }); }
      }
    }
    if (method === "POST" && path === "/api/jarvis/admin/remote/wake") {
      const node = typeof payload.nodeId === "string" ? plane.fleet.get(payload.nodeId) : undefined;
      if (!node || !remoteDeviceInventory([node], [])[0].remoteAssistCapability || !node.capabilities.includes("wake-device")) return json(response, 409, { message: "画面起動に対応した接続済み端末ではありません" });
      const current = plane.queue.list().find(task => task.type === "wake-device" && task.targetNodeId === node.id && task.dispatchBefore && ["queued", "leased", "running"].includes(task.status) && Date.parse(task.dispatchBefore) > Date.now());
      if (current) return json(response, 200, { task: current });
      if (plane.queue.assignedTo(node.id).length || remoteMailbox.pending(node.id)) return json(response, 409, { message: "端末は別の操作を実行中です" });
      const task = plane.enqueueTask({ type: "wake-device", payload: {}, targetNodeId: node.id, requiredCapabilities: ["wake-device"], preferredKinds: ["android"], requiresOnline: true, priority: "high", maxAttempts: 1, idempotencyKey: `remote-wake:${node.id}:${Date.now()}`, dispatchBefore: new Date(Date.now() + 15_000).toISOString() });
      persist(); return json(response, 201, { task });
    }
    if (method === "POST" && path === "/api/jarvis/admin/remote/end") {
      if (typeof payload.sessionId !== "string") return json(response, 400, { message: "sessionId required" });
      remoteMailbox.endSession(payload.sessionId);
      return json(response, 200, { ok: true });
    }
    if (method === "POST" && path === "/api/jarvis/admin/remote/command") {
      const node = typeof payload.nodeId === "string" ? plane.fleet.get(payload.nodeId) : undefined;
      if (!node || !remoteDeviceInventory([node], [])[0].remoteAssistCapability || plane.queue.assignedTo(node.id).length) return json(response, 409, { message: "Worker未接続・権限不足・作業中です" });
      if (typeof payload.sessionId !== "string" || typeof payload.expiresAt !== "number" || !Number.isFinite(payload.expiresAt) || !payload.input || typeof payload.input !== "object" || Array.isArray(payload.input)) return json(response, 400, { message: "Remote session binding required" });
      const abort = new AbortController();
      const close = () => abort.abort();
      response.on("close", close);
      try {
        const result = await remoteMailbox.request(node.id, payload.sessionId, payload.input as Record<string, unknown>, payload.expiresAt, abort.signal);
        if (result.ok !== true && (payload.input as Record<string, unknown>).action === "screenshot") {
          return json(response, 503, { ...result, code: "REMOTE_CAPTURE_UNAVAILABLE", message: "画面を取得できませんでした。接続を保持して間隔を空けて再確認します" });
        }
        return json(response, result.ok === true ? 200 : 409, result);
      } catch { return json(response, 409, { message: "端末の操作結果を確認できません。画面を再確認してください。操作は再送していません" }); }
      finally { response.off("close", close); }
    }
    if (method === "GET" && path === "/api/jarvis/admin/replacement/ready") {
      return json(response, 200, { candidates: replacementTransport.listReady(), pendingCount: replacementTransport.pendingSize() });
    }
    if (method === "POST" && path === "/api/jarvis/admin/replacement/challenge") {
      const nodeId = typeof payload.nodeId === "string" ? payload.nodeId : "";
      const publicKeyPem = typeof payload.publicKeyPem === "string" ? payload.publicKeyPem : "";
      const algorithm = payload.algorithm === "ed25519" ? "ed25519" : payload.algorithm === "ecdsa-p256-sha256" ? "ecdsa-p256-sha256" : undefined;
      if (!nodeId || !publicKeyPem || !algorithm) return json(response, 400, { message: "nodeId, publicKeyPem and supported algorithm are required" });
      try {
        const challenge = replacementTransport.createChallenge({ nodeId, publicKeyPem, algorithm, ttlMs: asNumber(payload.ttlMs, 10 * 60_000) });
        return json(response, 201, { challenge });
      } catch (error) {
        return json(response, 400, { message: error instanceof Error ? error.message : "invalid replacement candidate" });
      }
    }
    if (method === "POST" && path === "/api/jarvis/admin/replacement/discard") {
      if (typeof payload.candidateId !== "string" || !payload.candidateId) return json(response, 400, { message: "candidateId required" });
      return json(response, 200, { discarded: replacementTransport.discard(payload.candidateId) });
    }
    if (path === "/api/jarvis/admin/invitation") {
      if (method === "GET") return json(response, 200, { invitation: invitations.status() });
      if (method === "POST" && payload.action === "revoke") return json(response, 200, { invitation: invitations.revoke() });
      if (method === "POST" && payload.action === "create") {
        try {
          // Validate installation before creating a credential; never return an unusable link.
          invitationUrl(publicBrokerUrl, "ji_" + "a".repeat(43));
          const { secret, ...invitation } = invitations.create(asNumber(payload.maxDevices, 100));
          return json(response, 201, { invitation, url: invitationUrl(publicBrokerUrl, secret) });
        } catch { return json(response, 409, { message: "招待リンクを作成できません。既存リンクの状態と拠点設定を確認してください。" }); }
      }
      return json(response, 400, { message: "Invitation action must be create or revoke" });
    }
    if (method === "GET" && path === "/api/jarvis/admin/enrollment-window") {
      return json(response, 200, { window: pairingWindow.status(), fixedUrl: fixedEnrollmentUrl });
    }
    if (method === "POST" && path === "/api/jarvis/admin/enrollment-window") {
      const action = payload.action === "close" ? "close" : payload.action === "open" ? "open" : "";
      if (!action) return json(response, 400, { message: "pairing window action must be open or close" });
      try {
        const window = action === "close"
          ? pairingWindow.close()
          : pairingWindow.open({ ttlMs: asNumber(payload.ttlMs, 10 * 60_000), maxIssues: asNumber(payload.maxIssues, 100), group: typeof payload.group === "string" ? payload.group : undefined });
        return json(response, 200, { window, fixedUrl: fixedEnrollmentUrl });
      } catch (error) {
        return json(response, 400, { message: error instanceof Error ? error.message : "invalid pairing window request" });
      }
    }
    if (method === "POST" && path === "/api/jarvis/admin/enrollment") {
      const mode = payload.mode === "full" || payload.mode === "fleet" ? payload.mode : "quick";
      const ttlMs = Math.min(Math.max(asNumber(payload.ttlMs, 5 * 60_000), 60_000), 60 * 60_000);
      const maxDevices = Math.min(Math.max(asNumber(payload.maxDevices, mode === "fleet" ? 100 : 1), 1), 100);
      const group = typeof payload.group === "string" ? payload.group : undefined;
      const token = plane.createEnrollment({ mode, ttlMs, maxDevices, group });
      const fullToken = mode === "fleet" ? plane.createEnrollment({ mode: "full", ttlMs, maxDevices, group }) : mode === "full" ? token : undefined;
      const deepLink = publicBrokerUrl ? `jarvis://enroll?broker=${encodeURIComponent(publicBrokerUrl)}&token=${encodeURIComponent(token.token)}` : undefined;
      const grant = publicBrokerUrl ? issueEnrollmentGrant(token.token, token.expiresAt) : undefined;
      const oneTapUrl = grant ? `${publicBrokerUrl}/enroll/${encodeURIComponent(grant)}` : undefined;
      const apk = workerApkInfo();
      const provisioning = fullToken && publicBrokerUrl && apk ? fullProvisioningPayload(publicBrokerUrl, fullToken.token, apk) : undefined;
      const qrPngBase64 = provisioning ? provisioningQrPngBase64(provisioning) : undefined;
      return json(response, 201, { token, fullToken, oneTapUrl, deepLink, apkUrl: apk?.url, apkSha256Base64Url: apk?.sha256Base64Url, provisioning, qrPngBase64 });
    }
    if (method === "POST" && path === "/api/jarvis/admin/windows-verification") {
      const targetNodeId = typeof payload.targetNodeId === "string" ? payload.targetNodeId : "";
      const operation = typeof payload.operation === "string" ? payload.operation : "";
      const taskPayload = payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload) ? payload.payload as Record<string, unknown> : {};
      const node = targetNodeId ? plane.fleet.get(targetNodeId) : undefined;
      try {
        const spec = validateWindowsVerificationDispatch({ targetNodeId, operation, payload: taskPayload, idempotencyKey: typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : undefined }, node ? { id: node.id, kind: node.kind, capabilities: node.capabilities } : undefined);
        const task = plane.enqueueTask(spec);
        persist(); return json(response, 201, { task });
      } catch (error) { return json(response, 400, { message: error instanceof Error ? error.message : "invalid Windows verification task" }); }
    }
    if (method === "POST" && path === "/api/jarvis/admin/tasks") {
      const type = typeof payload.type === "string" ? payload.type : "";
      const taskPayload = payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload) ? payload.payload as Record<string, unknown> : {};
      let cleanPayload: Record<string, unknown>;
      try { cleanPayload = validatedAndroidTask(type, taskPayload); }
      catch (error) { return json(response, 400, { message: error instanceof Error ? error.message : "invalid task" }); }
      const capability = androidTaskCapabilities[type];
      const targetNodeId = typeof payload.targetNodeId === "string" ? payload.targetNodeId : undefined;
      const fingerprint = JSON.stringify({ type, cleanPayload, targetNodeId });
      const task = plane.enqueueTask({
        idempotencyKey: typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : `${type}:${createHash("sha256").update(fingerprint).digest("hex")}`,
        type, payload: cleanPayload, requiredCapabilities: [capability], preferredKinds: ["android"],
        priority: payload.priority === "urgent" || payload.priority === "high" || payload.priority === "low" || payload.priority === "background" ? payload.priority : "normal",
        requiresOnline: true, targetNodeId, maxAttempts: Math.min(Math.max(asNumber(payload.maxAttempts, 3), 1), 10),
      });
      persist(); return json(response, 201, { task });
    }
    if (method === "POST" && path === "/api/jarvis/admin/takeover/resolve") {
      if (typeof payload.sessionId !== "string") return json(response, 400, { message: "sessionId required" });
      const session = plane.resolveTakeover(payload.sessionId, payload.resumeTask !== false); persist(); return json(response, 200, { session });
    }
    return json(response, 404, { message: "unknown admin route" });
  }

  if (method === "POST" && path === "/api/jarvis/replacement/prove") {
    const payload = parseJson(body);
    if (typeof payload.candidateId !== "string" || typeof payload.nodeId !== "string" || typeof payload.signatureBase64 !== "string") {
      return json(response, 400, { message: "candidateId, nodeId and signatureBase64 are required" });
    }
    try {
      const candidate = replacementTransport.prove({ candidateId: payload.candidateId, nodeId: payload.nodeId, signatureBase64: payload.signatureBase64 });
      return json(response, 200, { candidate });
    } catch (error) {
      return json(response, 400, { message: error instanceof Error ? error.message : "replacement proof rejected" });
    }
  }

  if (method === "POST" && path === "/api/jarvis/enroll") {
    const payload = parseJson(body); let tokenValue = "";
    if (typeof payload.grant === "string" && payload.grant) {
      const grant = resolveEnrollmentGrant(payload.grant); if (!grant) return json(response, 410, { message: "expired or invalid enrollment link" }); tokenValue = grant.token;
    } else if (typeof payload.token === "string" && payload.token) {
      const legacyGrant = resolveEnrollmentGrant(payload.token); tokenValue = legacyGrant?.token ?? payload.token;
    }
    if (!tokenValue) return json(response, 400, { message: "enrollment token or grant required" });
    const node = assignFleetNumber(validatedNode(payload.node));
    const identityInput = payload.identity as Record<string, unknown> | undefined;
    if (!identityInput || typeof identityInput.publicKeyPem !== "string") return json(response, 400, { message: "worker public identity required" });
    const algorithm = identityInput.algorithm === "ed25519" ? "ed25519" : identityInput.algorithm === "ecdsa-p256-sha256" ? "ecdsa-p256-sha256" : undefined;
    if (!algorithm) return json(response, 400, { message: "unsupported worker signature algorithm" });
    const key = createPublicKey(identityInput.publicKeyPem);
    if (algorithm === "ecdsa-p256-sha256" && key.asymmetricKeyType !== "ec") return json(response, 400, { message: "ECDSA worker must provide EC public key" });
    if (algorithm === "ed25519" && key.asymmetricKeyType !== "ed25519") return json(response, 400, { message: "Ed25519 worker must provide Ed25519 public key" });
    if (tokenValue.startsWith(INVITATION_PREFIX)) {
      if (!invitationLimiter.consume(request.socket.remoteAddress || "unknown").allowed) return json(response, 429, { message: "Registration rate limit" });
      if (plane.fleet.get(node.id)) return json(response, 409, { message: "Existing identity must reconnect, not re-enroll" });
      if (plane.snapshot().fleet.length >= 100) return json(response, 409, { message: "Fleet capacity reached" });
      try { invitations.consume(tokenValue, node.id); }
      catch { return json(response, 403, { message: "招待リンクは無効・停止中、または登録上限です" }); }
      // Reusable invitation remains local; each successful redemption uses a fresh bounded quick grant.
      tokenValue = plane.createEnrollment({ mode: "quick", ttlMs: 30 * 60_000, maxDevices: 1 }).token;
    }
    const enrolled = plane.enroll(tokenValue, node);
    store.saveWorkerIdentity({ nodeId: enrolled.id, publicKeyPem: identityInput.publicKeyPem, algorithm, enrolledAt: new Date().toISOString() });
    persist(); return json(response, 201, { node: enrolled });
  }

  if (method === "POST" && path === "/api/jarvis/enrollment-request") {
    if (!invitationLimiter.consume(request.socket.remoteAddress || "unknown").allowed) return json(response, 429, { message: "Registration rate limit" });
    try {
      const payload = parseJson(body);
      const node = validatedNode(payload.node);
      if (plane.fleet.get(node.id) || store.getWorkerIdentity(node.id)) return json(response, 409, { message: "Existing identity must reconnect" });
      const key = payload.publicKeyPem;
      if (typeof key !== "string" || key.length > 2_000 || !/^[A-Za-z0-9_-]{1,100}$/.test(node.id) || typeof node.label !== "string" || node.label.length > 150 || node.capabilities.length > 64 || !node.capabilities.every(value => typeof value === "string" && value.length <= 64)) throw new Error("Invalid device identity");
      const identity = { nodeId: node.id, publicKeyPem: key, algorithm: "ecdsa-p256-sha256" as const, enrolledAt: new Date().toISOString() };
      const signed = signedWorkerRequest(request, path, body);
      if (!signed || !verifyWorkerRequest({ identity, request: signed, seenNonce: (id, nonce) => nonces.has(id, nonce) }).ok) return json(response, 401, { message: "Device key proof required" });
      nonces.record(signed.nodeId, signed.nonce);
      const safeNode: JarvisNode = { id: node.id, label: node.label, kind: "android", capabilities: node.capabilities, status: "offline", enrollment: "quick", lastSeenAt: new Date().toISOString(), telemetry: { checkedAt: new Date().toISOString() }, policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false, allowRemoteControl: false, requireHumanForLockedDevice: true } };
      return json(response, 202, { pending: true, ...pendingEnrollment.offer(safeNode, identity) });
    } catch { return json(response, 400, { message: "Invalid registration request" }); }
  }
  if (path.startsWith("/api/jarvis/worker/")) {
    const identity = authenticateWorker(request, path, body); if (!identity) return json(response, 401, { message: "valid signed worker request required" });
    const payload = parseJson(body);
    if (method === "POST" && path === "/api/jarvis/worker/heartbeat") {
      const telemetry = payload.telemetry && typeof payload.telemetry === "object" && !Array.isArray(payload.telemetry) ? payload.telemetry as JarvisNode["telemetry"] : undefined;
      const status = payload.status === "busy" || payload.status === "locked" || payload.status === "needs-human" ? payload.status : "ready";
      const capabilities = Array.isArray(payload.capabilities) ? payload.capabilities.filter((item): item is JarvisCapability => typeof item === "string") : undefined;
      const current = plane.fleet.get(identity.nodeId);
      const policy = current ? { ...current.policy, allowPaidServices: false as const, allowRemoteControl: capabilities?.includes("ui-automation") === true, requireHumanForLockedDevice: true } : undefined;
      const node = plane.heartbeat(identity.nodeId, { status, telemetry, capabilities, policy }); persist(false); return json(response, 200, { node });
    }
    if (method === "POST" && path === "/api/jarvis/worker/remote/next") {
      const node = plane.fleet.get(identity.nodeId);
      const ready = node && remoteDeviceInventory([node], [])[0].remoteAssistCapability && !plane.queue.assignedTo(node.id).length;
      return json(response, 200, { command: ready ? remoteMailbox.claim(identity.nodeId) : null });
    }
    if (method === "POST" && path === "/api/jarvis/worker/remote/result") {
      if (typeof payload.id !== "string" || typeof payload.ok !== "boolean") return json(response, 400, { message: "Invalid remote result" });
      try { remoteMailbox.finish(identity.nodeId, payload.id, payload); return json(response, 200, { ok: true }); }
      catch { return json(response, 409, { message: "Unknown or expired remote result" }); }
    }
    if (method === "POST" && path === "/api/jarvis/worker/next") {
      if (remoteMailbox.pending(identity.nodeId)) return json(response, 200, { task: null });
      let assigned = plane.queue.assignedTo(identity.nodeId)[0];
      if (!assigned) { plane.dispatch({ mobileOnline: true, pcOnline: true, sameLanAvailable: false }); assigned = plane.queue.assignedTo(identity.nodeId)[0]; }
      if (assigned?.status === "leased") assigned = plane.markRunning(assigned.id, identity.nodeId);
      if (assigned) persist(); return json(response, 200, { task: assigned ?? null });
    }
    if (method === "POST" && path === "/api/jarvis/worker/result") {
      if (typeof payload.taskId !== "string" || typeof payload.ok !== "boolean") return json(response, 400, { message: "taskId and ok required" });
      const detail = payload.detail && typeof payload.detail === "object" && !Array.isArray(payload.detail) ? payload.detail as Record<string, unknown> : {};
      const task = payload.ok ? plane.completeTask(payload.taskId, identity.nodeId, detail) : plane.failTask(payload.taskId, identity.nodeId, typeof detail.error === "string" ? detail.error : "worker reported failure");
      persist(); return json(response, 200, { task });
    }
    return json(response, 404, { message: "unknown worker route" });
  }
  return json(response, 404, { message: "not found" });
}

const server = createServer((request, response) => {
  handler(request, response).catch((error) => { console.error("[jarvis-broker] request failed", error); json(response, 500, { message: error instanceof Error ? error.message : "internal error" }); });
});
server.listen(port, host, () => {
  console.log(`[jarvis-broker] listening on http://${host}:${port}`);
  console.log(`[jarvis-broker] nodes=${plane.snapshot().stats.registered} tasks=${plane.snapshot().tasks.length} workerApk=${workerApkInfo() ? "ready" : "missing"}`);
});
function shutdown(): void {
  server.close(() => { persist(); store.close(); compass.close(); process.exit(0); });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

