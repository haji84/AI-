import CryptoKit
import Foundation
import UIKit

struct WorkerTask: Codable {
    let protocolVersion: Int
    let taskId: String
    let deviceId: String
    let capability: String
    let mode: String
    let input: String
    let issuedAt: String
    let expiresAt: String
    let nonce: String
    let signature: String
}

struct WorkerResultUnsigned: Codable {
    let protocolVersion: Int
    let taskId: String
    let deviceId: String
    let ok: Bool
    let output: String
    let evidence: [String: String]
    let completedAt: String
    let nonce: String
}

struct WorkerResult: Codable {
    let protocolVersion: Int
    let taskId: String
    let deviceId: String
    let ok: Bool
    let output: String
    let evidence: [String: String]
    let completedAt: String
    let nonce: String
    let signature: String
}

@MainActor
final class WorkerRuntime: ObservableObject {
    @Published var bridgeURL = UserDefaults.standard.string(forKey: "bridgeURL") ?? ""
    @Published var deviceId = UserDefaults.standard.string(forKey: "deviceId") ?? UIDevice.current.identifierForVendor?.uuidString.lowercased() ?? UUID().uuidString.lowercased()
    @Published var token = ""
    @Published private(set) var status = "Not enrolled"
    @Published private(set) var lastTaskId: String?
    @Published private(set) var lastResult: String?
    @Published private(set) var evidenceLog = ""
    @Published private(set) var isRunning = false

    private var loop: Task<Void, Never>?
    private let session = URLSession(configuration: .default)
    private var completed = Set<String>()

    func toggle() async {
        if isRunning { stop(); return }
        UserDefaults.standard.set(bridgeURL, forKey: "bridgeURL")
        UserDefaults.standard.set(deviceId, forKey: "deviceId")
        isRunning = true
        status = "Enrolling"
        do {
            try await enroll()
            status = "ACTIVE"
            loop = Task { await pollLoop() }
        } catch {
            status = "Enrollment failed: \(error.localizedDescription)"
            isRunning = false
        }
    }

    func stop() {
        loop?.cancel()
        loop = nil
        isRunning = false
        status = "Stopped"
    }

    private func enroll() async throws {
        guard let url = endpoint("enroll") else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "deviceId": deviceId,
            "platform": "ios",
            "workerProtocolVersion": 1,
            "capabilities": ["ios-tooling", "local-storage"],
            "physicalDevice": true
        ])
        let (_, response) = try await session.data(for: request)
        try requireSuccess(response)
    }

    private func pollLoop() async {
        while !Task.isCancelled {
            do {
                if let task = try await nextTask() { try await execute(task) }
                else { try await Task.sleep(for: .seconds(2)) }
            } catch is CancellationError { break }
            catch {
                status = "DEGRADED: \(error.localizedDescription)"
                try? await Task.sleep(for: .seconds(5))
                if !Task.isCancelled { status = "RECOVERING" }
            }
        }
    }

    private func nextTask() async throws -> WorkerTask? {
        guard var components = URLComponents(url: endpoint("tasks/next")!, resolvingAgainstBaseURL: false) else { throw URLError(.badURL) }
        components.queryItems = [URLQueryItem(name: "deviceId", value: deviceId)]
        guard let url = components.url else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        if http.statusCode == 204 { return nil }
        guard (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
        return try JSONDecoder().decode(WorkerTask.self, from: data)
    }

    private func execute(_ task: WorkerTask) async throws {
        guard task.deviceId == deviceId else { throw WorkerError.binding }
        guard !completed.contains(task.taskId) else { return }
        guard verifyTask(task) else { throw WorkerError.signature }
        guard ISO8601DateFormatter().date(from: task.expiresAt).map({ $0 > Date() }) == true else { throw WorkerError.expired }

        lastTaskId = task.taskId
        let output: String
        switch task.capability {
        case "ios-tooling": output = "physical-ios-worker-ok: \(task.input)"
        case "local-storage":
            UserDefaults.standard.set(task.input, forKey: "jarvis.lastBoundedValue")
            output = "stored-on-device"
        default: throw WorkerError.capability
        }

        let unsigned = WorkerResultUnsigned(
            protocolVersion: 1,
            taskId: task.taskId,
            deviceId: deviceId,
            ok: true,
            output: output,
            evidence: [
                "physicalDevice": "true",
                "platform": "ios",
                "deviceModel": UIDevice.current.model,
                "systemVersion": UIDevice.current.systemVersion,
                "executor": "JarvisIOSWorker"
            ],
            completedAt: ISO8601DateFormatter().string(from: Date()),
            nonce: task.nonce
        )
        let signature = try hmac(canonical(unsigned))
        let result = WorkerResult(protocolVersion: unsigned.protocolVersion, taskId: unsigned.taskId, deviceId: unsigned.deviceId, ok: unsigned.ok, output: unsigned.output, evidence: unsigned.evidence, completedAt: unsigned.completedAt, nonce: unsigned.nonce, signature: signature)
        try await submit(result)
        completed.insert(task.taskId)
        lastResult = output
        evidenceLog = "task=\(task.taskId) device=\(deviceId) physical=true completed=\(unsigned.completedAt)"
        status = "ACTIVE"
    }

    private func submit(_ result: WorkerResult) async throws {
        guard let url = endpoint("results") else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(result)
        let (_, response) = try await session.data(for: request)
        try requireSuccess(response)
    }

    private func verifyTask(_ task: WorkerTask) -> Bool {
        struct Unsigned: Encodable {
            let protocolVersion: Int; let taskId: String; let deviceId: String; let capability: String; let mode: String; let input: String; let issuedAt: String; let expiresAt: String; let nonce: String
        }
        let value = Unsigned(protocolVersion: task.protocolVersion, taskId: task.taskId, deviceId: task.deviceId, capability: task.capability, mode: task.mode, input: task.input, issuedAt: task.issuedAt, expiresAt: task.expiresAt, nonce: task.nonce)
        guard let data = try? canonical(value), let expected = try? hmac(data) else { return false }
        return expected.lowercased() == task.signature.lowercased()
    }

    private func canonical<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }

    private func hmac(_ data: Data) throws -> String {
        guard let keyData = token.data(using: .utf8) else { throw WorkerError.signature }
        let code = HMAC<SHA256>.authenticationCode(for: data, using: SymmetricKey(data: keyData))
        return code.map { String(format: "%02x", $0) }.joined()
    }

    private func endpoint(_ path: String) -> URL? {
        guard var base = URL(string: bridgeURL) else { return nil }
        base.append(path: path)
        return base
    }

    private func requireSuccess(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
    }
}

enum WorkerError: LocalizedError {
    case binding, signature, expired, capability
    var errorDescription: String? {
        switch self {
        case .binding: "Task device binding mismatch"
        case .signature: "Task signature invalid"
        case .expired: "Task expired"
        case .capability: "Capability not authorized"
        }
    }
}
