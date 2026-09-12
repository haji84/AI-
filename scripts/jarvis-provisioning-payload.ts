import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const apkUrl = arg("apk-url");
const apkPath = arg("apk-path");
const broker = arg("broker");
const token = arg("token");
const checksumInput = arg("apk-sha256-base64url");

if (!apkUrl?.startsWith("https://")) throw new Error("--apk-url must be HTTPS");
if (!broker?.startsWith("https://")) throw new Error("--broker must be HTTPS");
if (!token) throw new Error("--token is required");

const checksum = checksumInput || (apkPath
  ? createHash("sha256").update(readFileSync(apkPath)).digest("base64url")
  : undefined);
if (!checksum) throw new Error("provide --apk-sha256-base64url or --apk-path");

const payload = {
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": "ai.jarvis.worker/.JarvisDeviceAdminReceiver",
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION": apkUrl,
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM": checksum,
  "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
    jarvis_broker: broker,
    jarvis_token: token,
  },
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
