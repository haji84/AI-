import CryptoKit
import Darwin
import Foundation
import Security
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

private struct BootstrapResponse: Decodable {
    let bootstrapToken: String
    let expiresAt: String
    let bridgeId: String
}

private struct EnrollmentResponse: Decodable {
    let ok: Bool
    let deviceId: String
    let deviceSecret: String
    let mainSha: String
}

private struct DiscoveryResponse: Decodable {
    let service: String
    let protocolVersion: Int
    let pairingOpen: Bool
}

@MainActor
final class WorkerRuntime: ObservableObject {
    @Published var bridgeURL: String
    @Published var deviceId: String
    @Published var token: String
    @Published private(set) var status = "Starting"
    @Published private(set) var lastTaskId: String?
    @Published private(set) var lastResult: String?
    @Published private(set) var lastTransportError: String?
    @Published private(set) var evidenceLog = ""
    @Published private(set) var isRunning = false
    @Published private(set) var isDiscovering = false

    private var loop: Task<Void, Never>?
    private let session: URLSession
    private var completed = Set<String>()
    private static let credentialAccount = "physical-iphone-device-secret"

    init() {
        bridgeURL = UserDefaults.standard.string(forKey: "bridgeURL") ?? ""
        if let persisted = UserDefaults.standard.string(forKey: "deviceId"), !persisted.isEmpty {
            deviceId = persisted
        } else {
            let generated = UUID().uuidString.lowercased()
            deviceId = generated
            UserDefaults.standard.set(generated, forKey: "deviceId")
        }
        token = KeychainStore.load(account: Self.credentialAccount) ?? ""
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 10
        session = URLSession(configuration: configuration)
    }

    func autoStart() async {
        guard !isRunning else { return }
        isRunning = true
        do {
            if !bridgeURL.isEmpty, !token.isEmpty {
                status = "Reconnecting"
                do {
                    try await reconnect()
                    try startPolling()
                    return
                } catch {
                    lastTransportError = error.localizedDescription
                    status = "Saved connection unavailable"
                }
            }

            let bridgeReachable = bridgeURL.isEmpty ? false : await bridgeIsReachable(bridgeURL)
            if !bridgeReachable {
                status = "Finding Mac Bridge"
                isDiscovering = true
                defer { isDiscovering = false }
                bridgeURL = try await discoverBridge()
                UserDefaults.standard.set(bridgeURL, forKey: "bridgeURL")
            }

            if !token.isEmpty {
                status = "Reconnecting"
                try await reconnect()
            } else {
                status = "Secure pairing"
                try await bootstrapAndEnroll()
            }
            try startPolling()
        } catch {
            isRunning = false
            lastTransportError = error.localizedDescription
            status = "Waiting: \(error.localizedDescription)"
        }
    }

    func toggle() async {
        if isRunning { stop(); return }
        await autoStart()
    }

    func forgetConnection() {
        stop()
        bridgeURL = ""
        token = ""
        lastTransportError = nil
        UserDefaults.standard.removeObject(forKey: "bridgeURL")
        KeychainStore.delete(account: Self.credentialAccount)
        status = "Connection cleared"
    }

    func stop() {
        loop?.cancel()
        loop = nil
        isRunning = false
        status = "Stopped"
    }

    private func startPolling() throws {
        guard !bridgeURL.isEmpty, !deviceId.isEmpty, !token.isEmpty else { throw WorkerError.configuration }
        UserDefaults.standard.set(bridgeURL, forKey: "bridgeURL")
        UserDefaults.standard.set(deviceId, forKey: "deviceId")
        lastTransportError = nil
        status = "ACTIVE"
        loop = Task { await pollLoop() }
    }

    private func bootstrapAndEnroll() async throws {
        guard let bootstrapURL = endpoint("bootstrap") else { throw URLError(.badURL) }
        var bootstrapRequest = URLRequest(url: bootstrapURL)
        bootstrapRequest.httpMethod = "POST"
        bootstrapRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        bootstrapRequest.httpBody = try JSONSerialization.data(withJSONObject: [
            "deviceId": deviceId,
            "clientNonce": UUID().uuidString + UUID().uuidString
        ])
        let (bootstrapData, bootstrapHTTP) = try await session.data(for: bootstrapRequest)
        try requireSuccess(bootstrapHTTP)
        let bootstrap = try JSONDecoder().decode(BootstrapResponse.self, from: bootstrapData)

        guard let enrollURL = endpoint("enroll") else { throw URLError(.badURL) }
        var enrollRequest = URLRequest(url: enrollURL)
        enrollRequest.httpMethod = "POST"
        enrollRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        enrollRequest.setValue("Bootstrap \(bootstrap.bootstrapToken)", forHTTPHeaderField: "Authorization")
        enrollRequest.httpBody = try enrollmentBody()
        let (enrollData, enrollHTTP) = try await session.data(for: enrollRequest)
        try requireSuccess(enrollHTTP)
        let enrollment = try JSONDecoder().decode(EnrollmentResponse.self, from: enrollData)
        guard enrollment.ok, enrollment.deviceId == deviceId else { throw WorkerError.binding }
        token = enrollment.deviceSecret
        try KeychainStore.save(enrollment.deviceSecret, account: Self.credentialAccount)
    }

    private func reconnect() async throws {
        guard let url = endpoint("reconnect") else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try enrollmentBody()
        let (_, response) = try await session.data(for: request)
        try requireSuccess(response)
    }

    private func enrollmentBody() throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "deviceId": deviceId,
            "platform": "ios",
            "workerProtocolVersion": 1,
            "capabilities": ["ios-tooling", "local-storage"],
            "physicalDevice": true
        ])
    }

    private func pollLoop() async {
        while !Task.isCancelled {
            do {
                if let task = try await nextTask() {
                    lastTaskId = task.taskId
                    evidenceLog = "received task=\(task.taskId) nonce=\(task.nonce)"
                    try await execute(task)
                } else {
                    try await Task.sleep(for: .seconds(2))
                }
            } catch is CancellationError {
                break
            } catch {
                lastTransportError = error.localizedDescription
                status = "DEGRADED: \(error.localizedDescription)"
                try? await Task.sleep(for: .seconds(2))
                if !Task.isCancelled {
                    do {
                        try await reconnect()
                        status = "ACTIVE"
                    } catch {
                        lastTransportError = error.localizedDescription
                        status = "RECOVERING"
                        do {
                            bridgeURL = try await discoverBridge()
                            UserDefaults.standard.set(bridgeURL, forKey: "bridgeURL")
                            try await reconnect()
                            status = "ACTIVE"
                        } catch {
                            lastTransportError = error.localizedDescription
                            status = "RECOVERING"
                        }
                    }
                }
            }
        }
    }

    private func nextTask() async throws -> WorkerTask? {
        guard let nextURL = endpoint("tasks/next"), var components = URLComponents(url: nextURL, resolvingAgainstBaseURL: false) else { throw URLError(.badURL) }
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

        let output: String
        switch task.capability {
        case "ios-tooling":
            output = "physical-ios-worker-ok: \(task.input)"
        case "local-storage":
            UserDefaults.standard.set(task.input, forKey: "jarvis.lastBoundedValue")
            output = "stored-on-device"
        default:
            throw WorkerError.capability
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
        let result = WorkerResult(
            protocolVersion: unsigned.protocolVersion,
            taskId: unsigned.taskId,
            deviceId: unsigned.deviceId,
            ok: unsigned.ok,
            output: unsigned.output,
            evidence: unsigned.evidence,
            completedAt: unsigned.completedAt,
            nonce: unsigned.nonce,
            signature: signature
        )
        try await submit(result)
        completed.insert(task.taskId)
        lastResult = output
        lastTransportError = nil
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
            let protocolVersion: Int
            let taskId: String
            let deviceId: String
            let capability: String
            let mode: String
            let input: String
            let issuedAt: String
            let expiresAt: String
            let nonce: String
        }
        let value = Unsigned(
            protocolVersion: task.protocolVersion,
            taskId: task.taskId,
            deviceId: task.deviceId,
            capability: task.capability,
            mode: task.mode,
            input: task.input,
            issuedAt: task.issuedAt,
            expiresAt: task.expiresAt,
            nonce: task.nonce
        )
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
        guard var components = URLComponents(string: bridgeURL) else { return nil }
        let suffix = path.split(separator: "/").map(String.init).joined(separator: "/")
        let basePath = components.path == "/" ? "" : components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.path = "/" + [basePath, suffix].filter { !$0.isEmpty }.joined(separator: "/")
        components.query = nil
        components.fragment = nil
        return components.url
    }

    private func requireSuccess(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
    }

    private func bridgeIsReachable(_ base: String) async -> Bool {
        await Self.probeBridge(base: base) != nil
    }

    private func discoverBridge() async throws -> String {
        if !bridgeURL.isEmpty, let found = await Self.probeBridge(base: bridgeURL) { return found }

        if let bonjour = await BonjourBridgeDiscovery.findBridge(),
           let found = await Self.probeBridge(base: bonjour) {
            return found
        }

        guard let prefix = Self.localIPv4Prefix() else { throw WorkerError.discovery }
        let fallbackPorts = [8788, 8787]
        return try await withThrowingTaskGroup(of: String?.self) { group in
            for port in fallbackPorts {
                for host in 1...254 {
                    let candidate = "http://\(prefix).\(host):\(port)/"
                    group.addTask { await Self.probeBridge(base: candidate) }
                }
            }
            for try await result in group {
                if let result {
                    group.cancelAll()
                    return result
                }
            }
            throw WorkerError.discovery
        }
    }

    nonisolated private static func probeBridge(base: String) async -> String? {
        guard let url = URL(string: base)?.appending(path: "discover") else { return nil }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 0.6
        configuration.timeoutIntervalForResource = 0.8
        let probeSession = URLSession(configuration: configuration)
        do {
            let (data, response) = try await probeSession.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            let discovery = try JSONDecoder().decode(DiscoveryResponse.self, from: data)
            guard discovery.service == "jarvis-iphone-bridge", discovery.protocolVersion >= 2 else { return nil }
            return base.hasSuffix("/") ? base : base + "/"
        } catch {
            return nil
        }
    }

    nonisolated private static func localIPv4Prefix() -> String? {
        var pointer: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&pointer) == 0, let first = pointer else { return nil }
        defer { freeifaddrs(pointer) }
        for entry in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let interface = entry.pointee
            guard let address = interface.ifa_addr, address.pointee.sa_family == UInt8(AF_INET) else { continue }
            let name = String(cString: interface.ifa_name)
            guard name == "en0" || name == "en1" else { continue }
            var addr = address.pointee
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let result = getnameinfo(&addr, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
            guard result == 0 else { continue }
            let ip = String(cString: host)
            let parts = ip.split(separator: ".")
            if parts.count == 4 { return parts.prefix(3).joined(separator: ".") }
        }
        return nil
    }
}

private enum KeychainStore {
    static func load(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.haji84.jarvis.iosworker",
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ value: String, account: String) throws {
        guard let data = value.data(using: .utf8) else { throw WorkerError.configuration }
        delete(account: account)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.haji84.jarvis.iosworker",
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data
        ]
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else { throw WorkerError.keychain }
    }

    static func delete(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.haji84.jarvis.iosworker",
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}

enum WorkerError: LocalizedError {
    case binding, signature, expired, capability, discovery, configuration, keychain
    var errorDescription: String? {
        switch self {
        case .binding: "Task device binding mismatch"
        case .signature: "Task signature invalid"
        case .expired: "Task expired"
        case .capability: "Capability not authorized"
        case .discovery: "Mac Bridge was not found on this Wi-Fi network"
        case .configuration: "Worker configuration is incomplete"
        case .keychain: "Could not store device credential in Keychain"
        }
    }
}
