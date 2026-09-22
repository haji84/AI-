import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { WindowsVerificationResultDetail } from "./windows-verification-worker.ts";
export interface WindowsWorkerReport {
    taskId: string;
    ok: boolean;
    detail: WindowsVerificationResultDetail | {
        schema: "jarvis.real-machine-result.v1";
        error: string;
    };
}
export interface WindowsWorkerReceipt {
    version: 1;
    binding: string;
    taskId: string;
    taskDigest: string;
    phase: "started" | "result" | "acknowledged" | "rejected";
    rejectionCode?: string;
    report?: WindowsWorkerReport;
}
export function isDefinitiveWindowsRejection(code: unknown): code is string {
    return typeof code === "string" && ["native_lease_expired", "native_result_conflict", "native_result_unverifiable", "native_task_terminal"].includes(code);
}
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const hash = /^[a-f0-9]{64}$/;
export function validWindowsReport(value: unknown): value is WindowsWorkerReport {
    if (!value || typeof value !== "object")
        return false;
    const r = value as WindowsWorkerReport;
    if (typeof r.taskId !== "string" || !id.test(r.taskId) || typeof r.ok !== "boolean" || !r.detail || r.detail.schema !== "jarvis.real-machine-result.v1")
        return false;
    if (!r.ok)
        return Object.keys(r.detail).length === 2 && "error" in r.detail && typeof r.detail.error === "string" && /^windows_worker_[a-z0-9_]{1,100}$/.test(r.detail.error);
    const d = r.detail as WindowsVerificationResultDetail;
    return Object.keys(d).length === 7 && d.operation === "smoke" && d.check === "platform" && d.platform === "win32" && typeof d.nodeVersion === "string" && typeof d.outputSha256 === "string" && /^v\d+\.\d+\.\d+$/.test(d.nodeVersion) && hash.test(d.outputSha256) && Array.isArray(d.checkIds) && d.checkIds.length === 2 && d.checkIds[0] === "windows-native-process" && d.checkIds[1] === "platform-win32";
}
// One worker owns one journal. The service holds an exclusive lifetime lock.
// The retained acknowledged record also prevents repeating the last delivered task.
export class WindowsWorkerJournal {
    private value: WindowsWorkerReceipt | undefined;
    private readonly binding: string;
    private readonly path?: string;
    constructor(binding: string, path?: string) {
        this.binding = binding;
        this.path = path;
        if (path && existsSync(path)) {
            try {
                if (!statSync(path).isFile() || statSync(path).size > 32000)
                    throw Error();
                const v = JSON.parse(readFileSync(path, "utf8")) as WindowsWorkerReceipt;
                if (v.version !== 1 || v.binding !== binding || typeof v.taskId !== "string" || !id.test(v.taskId) || typeof v.taskDigest !== "string" || !hash.test(v.taskDigest) || !["started", "result", "acknowledged", "rejected"].includes(v.phase))
                    throw Error();
                if (v.phase !== "started" && (!validWindowsReport(v.report) || v.report.taskId !== v.taskId))
                    throw Error();
                if (v.phase === "rejected" && !isDefinitiveWindowsRejection(v.rejectionCode))
                    throw Error();
                this.value = v;
            }
            catch {
                throw new Error("windows_worker_invalid_journal");
            }
        }
    }
    read(): WindowsWorkerReceipt | undefined { return this.value ? structuredClone(this.value) : undefined; }
    save(value: WindowsWorkerReceipt): void {
        if (value.binding !== this.binding)
            throw new Error("windows_worker_journal_binding_mismatch");
        const text = JSON.stringify(value);
        if (Buffer.byteLength(text) > 32000)
            throw new Error("windows_worker_journal_too_large");
        if (this.path) {
            mkdirSync(dirname(this.path), { recursive: true });
            const temporary = this.path + "." + randomUUID() + ".tmp";
            const fd = openSync(temporary, "wx", 0o600);
            try {
                writeFileSync(fd, text);
                fsyncSync(fd);
            }
            finally {
                closeSync(fd);
            }
            renameSync(temporary, this.path);
        }
        this.value = structuredClone(value);
    }
}
