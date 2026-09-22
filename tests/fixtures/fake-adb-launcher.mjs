import process from "node:process";
// Test-only shebang equivalent for launching the fake ADB Node script on Windows.
// The gateway still calls its real execFile path; assertions inspect actual subprocess effects.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const original = childProcess.execFile;
childProcess.execFile = function (file, args, ...rest) {
  if (file === process.env.JARVIS_ADB_PATH && file.endsWith("fake-adb.mjs")) {
    return original(process.execPath, [file, ...args], ...rest);
  }
  return original(file, args, ...rest);
};
syncBuiltinESMExports();
import { promisify } from "node:util";
childProcess.execFile[promisify.custom] = (file, args, options) => new Promise((resolve, reject) => {
  childProcess.execFile(file, args, options, (error, stdout, stderr) => {
    if (error) reject(error); else resolve({ stdout, stderr });
  });
});
