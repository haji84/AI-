import SwiftUI

@main
struct JarvisIOSOwnerApp: App {
    @StateObject private var owner = OwnerCredentialRuntime()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            OwnerCredentialView().environmentObject(owner)
                .onChange(of: scenePhase) { _, phase in
                    if phase != .active { owner.hideRecoveryCode() }
                }
                .privacySensitive()
        }
    }
}

struct OwnerCredentialView: View {
    @EnvironmentObject private var owner: OwnerCredentialRuntime
    @State private var code = ""
    @State private var message: String?
    @State private var working = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Owner認証情報") {
                    LabeledContent("状態", value: owner.status)
                }

                if !owner.isEnrolled {
                    Section("このiPhoneをOwner端末として登録") {
                        TextField("GORIQのHTTPS URL", text: $owner.serverURL)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                            .autocorrectionDisabled()
                        Button("GoogleでOwner登録") {
                            run { try await owner.enrollWithGoogle() }
                        }.disabled(working || owner.serverURL.isEmpty)
                        Text("Google本人確認後、このiPhoneのSecure Enclave端末鍵をOwnerとして登録します。本番コードの入力は不要です。")
                            .font(.footnote)
                        SecureField("iPhoneに表示された復旧コード", text: $code)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                        Button("復旧コードでOwner登録") {
                            let entered = code
                            code = ""
                            run { try await owner.enrollWithRecoveryCode(entered) }
                        }.disabled(working || owner.serverURL.isEmpty || code.isEmpty)
                        Text("登録済みのiPhoneで発行した、5分間・1回限りの復旧コードを入力します。")
                            .font(.footnote)
                    }
                } else {
                    Section("別端末のOwner登録") {
                        if let recoveryCode = owner.recoveryCode, let expiry = owner.recoveryExpiresAt {
                            TimelineView(.periodic(from: .now, by: 1)) { context in
                                let remaining = max(0, Int(expiry.timeIntervalSince(context.date).rounded(.up)))
                                if remaining > 0 {
                                    Text(recoveryCode)
                                        .font(.system(.title3, design: .monospaced).weight(.semibold))
                                        .textSelection(.disabled)
                                        .privacySensitive()
                                    Text("有効期限まで \(remaining / 60)分\(remaining % 60)秒")
                                        .font(.footnote)
                                } else {
                                    Text("復旧コードは期限切れです")
                                        .font(.footnote)
                                }
                            }
                            Button("復旧コードを隠す") { owner.hideRecoveryCode() }
                                .disabled(working)
                            Button("復旧コードを取り消す", role: .destructive) {
                                run { try await owner.cancelRecoveryCode() }
                            }.disabled(working)
                        } else {
                            Button("別端末の復旧コードを表示") {
                                run { try await owner.issueRecoveryCode() }
                            }.disabled(working)
                        }
                        Text("Face IDとこのiPhoneの端末鍵を確認後、5分間・1回限りの登録コードを表示します。")
                            .font(.footnote)
                    }
                    Section {
                        Button("Googleで端末鍵を再登録") {
                            run { try await owner.repairWithGoogle() }
                        }.disabled(working)
                        Button("Face IDと端末鍵でログイン") {
                            run { try await owner.verifyTrustedDevice() }
                        }.disabled(working)
                        Button("この端末の信頼登録を失効して削除", role: .destructive) {
                            run { try await owner.revokeAndForget() }
                        }.disabled(working)
                        Button("このiPhoneの保存情報だけ削除", role: .destructive) {
                            run { try await owner.forgetLocalAfterAuthentication() }
                        }.disabled(working)
                        Text("通信できない場合の端末内削除です。サーバー側の失効は別のOwner端末の端末管理で確認してください。")
                            .font(.footnote)
                    }
                }
                if let message { Section { Text(message).font(.footnote) } }
            }
            .navigationTitle("Owner認証情報")
        }
    }

    private func run(_ operation: @escaping () async throws -> Void) {
        working = true
        message = nil
        Task {
            defer { working = false }
            do { try await operation() }
            catch { message = error.localizedDescription }
        }
    }
}
