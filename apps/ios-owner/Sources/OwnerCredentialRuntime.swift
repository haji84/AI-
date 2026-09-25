import Combine
import CryptoKit
import Foundation
import LocalAuthentication
import Security
import UIKit
import UniformTypeIdentifiers

@MainActor
final class OwnerCredentialRuntime: ObservableObject {
    @Published var serverURL = UserDefaults.standard.string(forKey: "ownerServerURL") ?? (Bundle.main.object(forInfoDictionaryKey: "GORIQServerURL") as? String ?? "")
    @Published private(set) var status = "未登録"
    @Published private(set) var revealedCode: String?
    @Published private(set) var isEnrolled = false
    @Published private(set) var hasStoredCode = false

    private let session: URLSession
    private let googleEnrollment = GoogleOwnerEnrollment()
    private static let codeAccount = "owner-production-code"
    private static let keyAccount = "owner-signing-key"
    private static let credentialAccount = "owner-trusted-credential"
    private static let deviceIdAccount = "owner-device-id"

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = true
        configuration.timeoutIntervalForRequest = 8
        session = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
        isEnrolled = Keychain.read(account: Self.credentialAccount) != nil
        hasStoredCode = Keychain.read(account: Self.codeAccount) != nil
        status = isEnrolled ? "登録済み・サーバー確認待ち" : "未登録"
    }

    func enroll(code: String) async throws {
        guard code.count >= 24, !code.contains(where: { $0.isNewline }) else { throw OwnerError.invalidCode }
        let base = try baseURL()
        let loginBody = "passcode=\(formEncode(code))"
        let login = try await send(base: base, path: "/api/owner-login", body: loginBody.data(using: .utf8)!, contentType: "application/x-www-form-urlencoded")
        if login.statusCode == 401 { throw OwnerError.ownerAuthentication }
        if login.statusCode == 503 { throw OwnerError.ownerAuthenticationUnavailable }
        guard login.statusCode == 200 else { throw OwnerError.ownerServerResponse }

        // Secure Enclave private material never leaves this iPhone. Its opaque
        // data representation is backed up only into this device's Keychain.
        let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, [.userPresence, .privateKeyUsage], nil)!
        let key = try SecureEnclave.P256.Signing.PrivateKey(compactRepresentable: false, accessControl: access)
        let bytes = key.publicKey.x963Representation
        guard bytes.count == 65, bytes.first == 4 else { throw OwnerError.keyUnavailable }
        let id = UUID().uuidString.replacingOccurrences(of: "-", with: "_")
        let publicJWK: [String: String] = [
            "kty": "EC", "crv": "P-256", "x": Data(bytes[1..<33]).base64URL,
            "y": Data(bytes[33..<65]).base64URL
        ]
        let body = try JSONSerialization.data(withJSONObject: ["deviceId": id, "label": "iPhone Owner", "publicKeyJwk": publicJWK])
        let enrollment = try await send(base: base, path: "/api/owner-login/trusted/enroll", body: body, contentType: "application/json")
        guard enrollment.statusCode == 200,
              let payload = try JSONSerialization.jsonObject(with: enrollment.data) as? [String: Any],
              let credential = payload["credential"] as? String else { throw OwnerError.enrollment }

        try storeTrustedDevice(keyData: key.dataRepresentation, credential: credential, deviceId: id, recoveryCode: code)
        UserDefaults.standard.set(serverURL, forKey: "ownerServerURL")
        isEnrolled = true
        hasStoredCode = true
        status = "登録済み・表示前に本人とサーバーを確認"
    }

    func enrollWithGoogle() async throws {
        let base = try baseURL()
        let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, [.userPresence, .privateKeyUsage], nil)!
        let key = try SecureEnclave.P256.Signing.PrivateKey(compactRepresentable: false, accessControl: access)
        let bytes = key.publicKey.x963Representation
        guard bytes.count == 65, bytes.first == 4 else { throw OwnerError.keyUnavailable }
        let id = UUID().uuidString.replacingOccurrences(of: "-", with: "_")
        let publicJWK = ["kty": "EC", "crv": "P-256", "x": Data(bytes[1..<33]).base64URL, "y": Data(bytes[33..<65]).base64URL]
        let credential = try await googleEnrollment.enroll(baseURL: base, deviceId: id, publicKeyJwk: publicJWK)
        try storeTrustedDevice(keyData: key.dataRepresentation, credential: credential, deviceId: id, recoveryCode: nil)
        UserDefaults.standard.set(serverURL, forKey: "ownerServerURL")
        isEnrolled = true
        hasStoredCode = false
        status = "GoogleでOwner登録済み"
    }

    func repairWithGoogle() async throws {
        let oldDeviceId = Keychain.read(account: Self.deviceIdAccount).flatMap { String(data: $0, encoding: .utf8) }
        try await enrollWithGoogle()
        do {
            try await verifyTrustedDeviceProof()
            if let oldDeviceId {
                try await revokeTrustedDeviceId(oldDeviceId)
            }
            status = "新しい端末鍵を確認し、以前の登録を失効しました"
        } catch {
            status = "新しい登録を確認できません。旧登録の失効状態も端末管理で確認してください"
            throw error
        }
    }

    private func revokeTrustedDeviceId(_ deviceId: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["deviceId": deviceId])
        let result = try await send(base: try baseURL(), path: "/api/owner-login/trusted/devices", body: body, contentType: "application/json")
        guard result.statusCode == 200 else { throw OwnerError.trustUnavailable }
    }

    private func storeTrustedDevice(keyData: Data, credential: String, deviceId: String, recoveryCode: String?) throws {
        try Keychain.save(keyData, account: Self.keyAccount)
        do {
            try Keychain.save(Data(credential.utf8), account: Self.credentialAccount)
            try Keychain.save(Data(deviceId.utf8), account: Self.deviceIdAccount)
            if let recoveryCode { try Keychain.saveProtected(Data(recoveryCode.utf8), account: Self.codeAccount) }
            else { Keychain.delete(account: Self.codeAccount) }
        } catch {
            forgetLocal()
            throw error
        }
    }

    func reveal() async throws {
        revealedCode = nil
        status = "信頼登録と本人を確認中"
        defer {
            if revealedCode == nil && status == "信頼登録と本人を確認中" {
                status = "確認できません。表示を停止しました"
            }
        }
        try await verifyTrustedDeviceProof()
        guard let data = try Keychain.readProtected(account: Self.codeAccount),
              let code = String(data: data, encoding: .utf8) else { throw OwnerError.keyUnavailable }
        revealedCode = code
        status = "本人と信頼登録を確認済み"
    }

    func copy() async throws {
        try await reveal()
        guard let code = revealedCode else { throw OwnerError.keyUnavailable }
        UIPasteboard.general.setItems([[UTType.plainText.identifier: code]], options: [
            .localOnly: true, .expirationDate: Date().addingTimeInterval(60)
        ])
        revealedCode = nil
        status = "コピーしました（60秒で期限切れ）"
    }

    func hide() { revealedCode = nil }

    func verifyTrustedDevice() async throws {
        status = "Face IDと端末鍵を確認中"
        do {
            try await verifyTrustedDeviceProof()
            status = "Face IDと端末鍵を確認済み"
        } catch {
            status = "端末鍵を確認できません"
            throw error
        }
    }

    func revokeAndForget() async throws {
        try await verifyTrustedDeviceProof()
        guard let idData = Keychain.read(account: Self.deviceIdAccount),
              let id = String(data: idData, encoding: .utf8) else { throw OwnerError.keyUnavailable }
        let body = try JSONSerialization.data(withJSONObject: ["deviceId": id])
        let result = try await send(base: try baseURL(), path: "/api/owner-login/trusted/devices", body: body, contentType: "application/json")
        guard result.statusCode == 200 else { throw OwnerError.trustUnavailable }
        forgetLocal()
    }

    func forgetLocalAfterAuthentication() throws {
        guard try Keychain.readProtected(account: Self.codeAccount) != nil else { throw OwnerError.keyUnavailable }
        forgetLocal()
        status = "このiPhoneの保存情報を削除しました。サーバー側の失効はGORIQ端末管理で確認してください"
    }

    func forgetLocal() {
        hide()
        for account in [Self.codeAccount, Self.keyAccount, Self.credentialAccount, Self.deviceIdAccount] {
            Keychain.delete(account: account)
        }
        isEnrolled = false
        hasStoredCode = false
        status = "未登録"
    }

    private func verifyTrustedDeviceProof() async throws {
        guard let credentialData = Keychain.read(account: Self.credentialAccount),
              let credential = String(data: credentialData, encoding: .utf8),
              let keyData = Keychain.read(account: Self.keyAccount) else { throw OwnerError.keyUnavailable }
        let base = try baseURL()
        let challengeBody = try JSONSerialization.data(withJSONObject: ["credential": credential])
        let challenge = try await send(base: base, path: "/api/owner-login/trusted/challenge", body: challengeBody, contentType: "application/json")
        guard challenge.statusCode == 200,
              let payload = try JSONSerialization.jsonObject(with: challenge.data) as? [String: Any],
              let nonce = payload["nonce"] as? String,
              let token = payload["token"] as? String else {
            status = "信頼登録を確認できません。表示を停止しました"
            throw OwnerError.trustUnavailable
        }
        let key = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: keyData)
        let signature = try key.signature(for: Data(nonce.utf8)).rawRepresentation.base64URL
        let verificationBody = try JSONSerialization.data(withJSONObject: [
            "credential": credential, "challengeToken": token, "signatureBase64Url": signature
        ])
        let verification = try await send(base: base, path: "/api/owner-login/trusted/verify", body: verificationBody, contentType: "application/json")
        guard verification.statusCode == 200 else {
            status = "信頼登録を確認できません。表示を停止しました"
            throw OwnerError.trustUnavailable
        }
    }

    private func baseURL() throws -> URL {
        guard let url = URL(string: serverURL), url.scheme == "https", url.user == nil,
              url.password == nil, url.query == nil, url.fragment == nil, url.host != nil else { throw OwnerError.invalidServer }
        return url
    }

    private func send(base: URL, path: String, body: Data, contentType: String) async throws -> (statusCode: Int, data: Data) {
        guard let url = URL(string: path, relativeTo: base)?.absoluteURL, url.host == base.host,
              url.scheme == "https" else { throw OwnerError.invalidServer }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.url?.host == base.host else { throw OwnerError.invalidServer }
        return (http.statusCode, data)
    }

    private func formEncode(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    }
}

private extension Data {
    var base64URL: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private enum Keychain {
    private static let service = "com.haji84.jarvis.iosowner"
    static func delete(account: String) {
        SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account] as CFDictionary)
    }
    static func save(_ value: Data, account: String) throws {
        delete(account: account)
        let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service,
            kSecAttrAccount: account, kSecValueData: value, kSecAttrAccessible: kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly]
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else { throw OwnerError.keyUnavailable }
    }
    static func saveProtected(_ value: Data, account: String) throws {
        delete(account: account)
        guard let control = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, nil) else { throw OwnerError.keyUnavailable }
        let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service,
            kSecAttrAccount: account, kSecValueData: value, kSecAttrAccessControl: control]
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else { throw OwnerError.keyUnavailable }
    }
    static func read(account: String) -> Data? {
        let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service,
            kSecAttrAccount: account, kSecReturnData: true, kSecMatchLimit: kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }
    static func readProtected(account: String) throws -> Data? {
        let context = LAContext()
        context.localizedReason = "本番ログインコードを表示します"
        let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service,
            kSecAttrAccount: account, kSecReturnData: true, kSecMatchLimit: kSecMatchLimitOne,
            kSecUseAuthenticationContext: context]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw OwnerError.keyUnavailable }
        return item as? Data
    }
}

enum OwnerError: LocalizedError {
    case invalidCode, invalidServer, ownerAuthentication, ownerAuthenticationUnavailable, ownerServerResponse, enrollment, trustUnavailable, keyUnavailable
    var errorDescription: String? {
        switch self {
        case .invalidCode: "コード形式を確認してください"
        case .invalidServer: "HTTPSのGORIQ URLを確認してください"
        case .ownerAuthentication: "Owner認証に失敗しました。入力したコードが本番サーバーと一致しません"
        case .ownerAuthenticationUnavailable: "本番Owner認証がサーバーに設定されていません"
        case .ownerServerResponse: "本番サーバーから想定外の応答が返りました"
        case .enrollment: "端末登録に失敗しました"
        case .trustUnavailable: "端末の信頼状態を確認できません"
        case .keyUnavailable: "この端末の保護鍵を使用できません"
        }
    }
}
