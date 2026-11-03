import {
  constants as cryptoConstants,
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";
import { inspectBrokerDatabase } from "./goriq-broker-db-inventory.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function expected(name) {
  const value = Number(required(name));
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
}

function safeSummary(result) {
  return {
    exists: result.exists,
    bytes: result.bytes,
    fleetCount: result.fleetCount,
    workerIdentityCount: result.workerIdentityCount,
    snapshotUpdatedAt: result.snapshotUpdatedAt,
    sha256: result.sha256,
    error: result.error,
  };
}

function assertCounts(result, fleetCount, identityCount) {
  if (!result.exists || result.error) throw new Error("Broker DB snapshot is unavailable");
  if (result.fleetCount !== fleetCount || result.workerIdentityCount !== identityCount) {
    throw new Error(`Broker DB count mismatch expected=${fleetCount}/${identityCount} actual=${result.fleetCount}/${result.workerIdentityCount}`);
  }
}

export function generateMigrationKeypair(publicKeyPath, privateKeyPath) {
  ensureParent(publicKeyPath);
  ensureParent(privateKeyPath);
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });
  writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  chmodSync(privateKeyPath, 0o600);
  return { algorithm: "rsa-oaep-sha256", privateKeyStoredLocally: true };
}

export async function sealDatabase({ sourceDbPath, publicKeyPath, bundlePath, expectedFleetCount, expectedIdentityCount }) {
  const tempRoot = mkdtempSync(join(tmpdir(), "goriq-fleet-seal-"));
  const snapshotPath = join(tempRoot, "snapshot.db");
  try {
    const source = new DatabaseSync(sourceDbPath, { readOnly: true, timeout: 5_000 });
    try {
      await backup(source, snapshotPath, { rate: 256 });
    } finally {
      source.close();
    }
    const inventory = inspectBrokerDatabase("sealed-source", snapshotPath);
    assertCounts(inventory, expectedFleetCount, expectedIdentityCount);
    const plaintext = readFileSync(snapshotPath);
    const digest = createHash("sha256").update(plaintext).digest("hex");
    if (inventory.sha256 !== digest) throw new Error("Snapshot digest mismatch before sealing");

    const key = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const publicKey = readFileSync(publicKeyPath, "utf8");
    const wrappedKey = publicEncrypt({
      key: publicKey,
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    }, key);

    ensureParent(bundlePath);
    const metadata = {
      bytes: plaintext.length,
      sha256: digest,
      fleetCount: inventory.fleetCount,
      workerIdentityCount: inventory.workerIdentityCount,
      snapshotUpdatedAt: inventory.snapshotUpdatedAt,
    };
    const bundle = {
      version: 1,
      algorithm: "aes-256-gcm+rsa-oaep-sha256",
      metadata,
      wrappedKey: wrappedKey.toString("base64"),
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    writeFileSync(bundlePath, JSON.stringify(bundle), { mode: 0o600 });
    chmodSync(bundlePath, 0o600);
    return metadata;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function unsealDatabase({ bundlePath, privateKeyPath, targetDbPath, backupPath, expectedFleetCount, expectedIdentityCount }) {
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  if (bundle?.version !== 1 || bundle?.algorithm !== "aes-256-gcm+rsa-oaep-sha256") {
    throw new Error("Unsupported sealed fleet DB bundle");
  }
  const privateKey = readFileSync(privateKeyPath, "utf8");
  const key = privateDecrypt({
    key: privateKey,
    padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  }, Buffer.from(String(bundle.wrappedKey), "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(String(bundle.iv), "base64"));
  decipher.setAuthTag(Buffer.from(String(bundle.tag), "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(String(bundle.ciphertext), "base64")),
    decipher.final(),
  ]);
  const digest = createHash("sha256").update(plaintext).digest("hex");
  if (digest !== bundle.metadata?.sha256 || plaintext.length !== bundle.metadata?.bytes) {
    throw new Error("Sealed fleet DB integrity check failed");
  }

  ensureParent(targetDbPath);
  const incoming = `${targetDbPath}.incoming.${process.pid}`;
  writeFileSync(incoming, plaintext, { mode: 0o600 });
  chmodSync(incoming, 0o600);
  try {
    const inventory = inspectBrokerDatabase("incoming", incoming);
    assertCounts(inventory, expectedFleetCount, expectedIdentityCount);
    if (inventory.sha256 !== digest) throw new Error("Incoming fleet DB digest mismatch");
    if (bundle.metadata.fleetCount !== expectedFleetCount || bundle.metadata.workerIdentityCount !== expectedIdentityCount) {
      throw new Error("Sealed fleet DB metadata count mismatch");
    }
    if (existsSync(targetDbPath) && backupPath) {
      ensureParent(backupPath);
      copyFileSync(targetDbPath, backupPath);
      chmodSync(backupPath, 0o600);
    }
    renameSync(incoming, targetDbPath);
    chmodSync(targetDbPath, 0o600);
    return { ...safeSummary(inventory), rollbackBackupCreated: Boolean(backupPath && existsSync(backupPath)) };
  } finally {
    rmSync(incoming, { force: true });
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === "keygen") {
    process.stdout.write(JSON.stringify(generateMigrationKeypair(required("GORIQ_MIGRATION_PUBLIC_KEY"), required("GORIQ_MIGRATION_PRIVATE_KEY"))) + "\n");
    return;
  }
  if (mode === "seal") {
    const metadata = await sealDatabase({
      sourceDbPath: required("GORIQ_SOURCE_DB_PATH"),
      publicKeyPath: required("GORIQ_MIGRATION_PUBLIC_KEY"),
      bundlePath: required("GORIQ_MIGRATION_BUNDLE"),
      expectedFleetCount: expected("GORIQ_EXPECTED_FLEET_COUNT"),
      expectedIdentityCount: expected("GORIQ_EXPECTED_IDENTITY_COUNT"),
    });
    process.stdout.write(JSON.stringify({ sealed: true, ...metadata }) + "\n");
    return;
  }
  if (mode === "unseal") {
    const result = unsealDatabase({
      bundlePath: required("GORIQ_MIGRATION_BUNDLE"),
      privateKeyPath: required("GORIQ_MIGRATION_PRIVATE_KEY"),
      targetDbPath: required("GORIQ_TARGET_DB_PATH"),
      backupPath: process.env.GORIQ_TARGET_DB_BACKUP?.trim() || undefined,
      expectedFleetCount: expected("GORIQ_EXPECTED_FLEET_COUNT"),
      expectedIdentityCount: expected("GORIQ_EXPECTED_IDENTITY_COUNT"),
    });
    process.stdout.write(JSON.stringify({ restored: true, ...result }) + "\n");
    return;
  }
  throw new Error("Expected migration mode: keygen, seal, or unseal");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Fleet DB migration failed");
    process.exit(1);
  });
}
