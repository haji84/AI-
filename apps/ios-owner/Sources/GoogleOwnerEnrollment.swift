import AuthenticationServices
import CryptoKit
import Foundation
import Security
import UIKit

@MainActor
final class GoogleOwnerEnrollment: NSObject, ASWebAuthenticationPresentationContextProviding {
    private let session: URLSession
    private var activeAuthentication: ASWebAuthenticationSession?

    override init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 10
        session = URLSession(configuration: configuration)
        super.init()
    }

    func enroll(baseURL: URL, deviceId: String, publicKeyJwk: [String: String]) async throws -> String {
        let state = try randomURLSafeString()
        let nonce = try randomURLSafeString()
        let verifier = try randomURLSafeString()
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        let beginBody = try JSONSerialization.data(withJSONObject: ["deviceId": deviceId, "publicKeyJwk": publicKeyJwk, "state": state, "nonce": nonce, "pkceChallenge": challenge])
        let beginData = try await post(baseURL: baseURL, path: "/api/owner-login/google/begin", body: beginBody)
        let begin = try JSONDecoder().decode(BeginResponse.self, from: beginData)
        guard let redirect = URL(string: begin.redirectUri), let callbackScheme = redirect.scheme, var components = URLComponents(string: begin.authorizationEndpoint) else { throw GoogleOwnerError.invalidConfiguration }
        components.queryItems = [
            URLQueryItem(name: "client_id", value: begin.clientId),
            URLQueryItem(name: "redirect_uri", value: begin.redirectUri),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "nonce", value: nonce),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        guard let authorizationURL = components.url else { throw GoogleOwnerError.invalidConfiguration }
        let callback = try await authenticate(url: authorizationURL, callbackScheme: callbackScheme)
        guard let callbackComponents = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              callbackComponents.queryItems?.first(where: { $0.name == "state" })?.value == state,
              let code = callbackComponents.queryItems?.first(where: { $0.name == "code" })?.value, !code.isEmpty else { throw GoogleOwnerError.authenticationRejected }
        let completeBody = try JSONSerialization.data(withJSONObject: ["contextId": begin.contextId, "deviceId": deviceId, "publicKeyJwk": publicKeyJwk, "state": state, "nonce": nonce, "code": code, "codeVerifier": verifier, "redirectUri": begin.redirectUri])
        let completeData = try await post(baseURL: baseURL, path: "/api/owner-login/google/complete", body: completeBody)
        return try JSONDecoder().decode(CompleteResponse.self, from: completeData).credential
    }

    private func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let authentication = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { url, error in
                if let error { continuation.resume(throwing: error); return }
                guard let url else { continuation.resume(throwing: GoogleOwnerError.authenticationRejected); return }
                continuation.resume(returning: url)
            }
            authentication.presentationContextProvider = self
            authentication.prefersEphemeralWebBrowserSession = true
            guard authentication.start() else { continuation.resume(throwing: GoogleOwnerError.authenticationRejected); return }
            self.activeAuthentication = authentication
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }

    private func post(baseURL: URL, path: String, body: Data) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL, url.scheme == "https", url.host == baseURL.host else { throw GoogleOwnerError.invalidConfiguration }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"; request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw GoogleOwnerError.enrollmentRejected }
        return data
    }

    private func randomURLSafeString() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw GoogleOwnerError.randomUnavailable }
        return Data(bytes).base64URL
    }
}

private struct BeginResponse: Decodable { let contextId: String; let expiresAt: Int; let clientId: String; let authorizationEndpoint: String; let redirectUri: String }
private struct CompleteResponse: Decodable { let ok: Bool; let credential: String }
private enum GoogleOwnerError: LocalizedError {
    case invalidConfiguration, authenticationRejected, enrollmentRejected, randomUnavailable
    var errorDescription: String? {
        switch self {
        case .invalidConfiguration: return "Google Owner登録の設定を確認できません"
        case .authenticationRejected: return "Google本人確認を完了できませんでした"
        case .enrollmentRejected: return "Google Owner登録を完了できませんでした"
        case .randomUnavailable: return "端末の安全な乱数を作成できません"
        }
    }
}

private extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
