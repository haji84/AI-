import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { connect, type Socket } from "node:net";
import { randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
const run = promisify(execFile);
const active = new Set<string>();
export const SCRCPY_HASH = "7e70323ba7f259649dd4acce97ac4fefbae8102b2c6d91e2e7be613fd5354be0";
export async function streamAndroidVideo(adb: string, serial: string, response: ServerResponse) {
  const server = process.env.JARVIS_SCRCPY_SERVER_PATH;
  if (!server) throw new Error("Video runtime unavailable: configure verified scrcpy server");
  if (active.has(serial) || active.size >= 4) throw new Error("Video capacity reached");
  active.add(serial);
  let port = 0, child: ChildProcess | undefined, socket: Socket | undefined;
  let ended = false, retry: ReturnType<typeof setTimeout> | undefined;
  const command = (args: string[]) => run(adb, ["-s", serial, ...args], { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true });
  const stop = () => {
    if (ended) return; ended = true; clearTimeout(deadline); clearTimeout(retry);
    socket?.destroy(); child?.kill(); active.delete(serial);
    if (port) void command(["forward", "--remove", `tcp:${port}`]).catch(() => {});
    if (!response.destroyed) response.end();
  };
  const deadline = setTimeout(stop, 60_000);
  response.once("close", stop);
  try {
    const binary = await readFile(server);
    if (createHash("sha256").update(binary).digest("hex") !== SCRCPY_HASH) throw new Error("Video runtime digest mismatch");
    await command(["push", server, "/data/local/tmp/jarvis-scrcpy-3.3.3.jar"]);
    if (ended) return;
    const scid = randomBytes(4).readUInt32BE(0) & 0x7fffffff;
    const id = scid.toString(16).padStart(8, "0");
    port = Number((await command(["forward", "tcp:0", `localabstract:scrcpy_${id}`])).stdout.trim());
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid video forward port");
    if (ended) { void command(["forward", "--remove", `tcp:${port}`]).catch(() => {}); return; }
    child = spawn(adb, ["-s", serial, "shell", "CLASSPATH=/data/local/tmp/jarvis-scrcpy-3.3.3.jar", "app_process", "/", "com.genymobile.scrcpy.Server", "3.3.3", `scid=${id}`, "tunnel_forward=true", "audio=false", "control=false", "cleanup=false", "max_size=1280", "max_fps=20", "video_bit_rate=1000000", "send_device_meta=false", "send_dummy_byte=false", "send_codec_meta=false"], { windowsHide: true, stdio: "ignore" });
    child.on("error", stop); child.on("exit", stop);
    const started = Date.now(); let received = false;
    const dial = () => {
      if (ended) return;
      socket = connect(port, "127.0.0.1");
      socket.on("error", () => socket?.destroy());
      socket.on("close", () => {
        if (ended) return;
        if (!received && Date.now() - started < 5000) retry = setTimeout(dial, 100);
        else stop();
      });
      socket.on("data", chunk => {
        if (ended) return;
        if (!received) { received = true; response.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" }); }
        // End slow readers instead of building an ever-older video queue.
        if (response.writableLength > 256 * 1024) { stop(); return; }
        response.write(chunk);
      });
    };
    dial();
  } catch (error) {
    clearTimeout(deadline); response.removeListener("close", stop);
    socket?.destroy(); child?.kill(); active.delete(serial);
    if (port) void command(["forward", "--remove", `tcp:${port}`]).catch(() => {});
    throw error;
  }
}
