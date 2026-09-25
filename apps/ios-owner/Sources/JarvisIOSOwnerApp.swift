import SwiftUI

@main
struct JarvisIOSOwnerApp: App {
    @StateObject private var owner = OwnerCredentialRuntime()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            OwnerCredentialView().environmentObject(owner)
                .onChange(of: scenePhase) { _, phase in
                    if phase != .active { owner.hide() }
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
                Section("本番ログインコード") {
                    LabeledContent("状態", value: owner.status)
                    HStack {
                        Text(owner.revealedCode ?? "••••••••••••")
                            .font(.system(.body, design: .monospaced))
                            .textSelection(.disabled)
                            .privacySensitive()
                        Spacer()
                    }
                    if owner.isEnrolled {
                        Button(owner.revealedCode == nil ? "表示" : "隠す") {
                            if owner.revealedCode != nil { owner.hide() }
                            else { run { try await owner.reveal() } }
                        }.disabled(working)
                        Button("コピー") { run { try await owner.copy() } }.disabled(working)
                        Button("変更") {
                            message = "本番コードの変更はZBook側で別途承認し、バックアップと復旧確認を伴って行います。変更後はこのiPhoneを再登録してください。"
                        }
                    }
                }

                if !owner.isEnrolled {
                    Section("このiPhoneをOwner端末として登録") {
                        TextField("GORIQのHTTPS URL", text: $owner.serverURL)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                            .autocorrectionDisabled()
                        SecureField("ZBookで確認した本番コード", text: $code)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button("本人確認して登録") {
                            let entered = code
                            code = ""
                            run { try await owner.enroll(code: entered) }
                        }.disabled(working || code.isEmpty)
                        Text("登録時に一度だけコードを入力します。以後、表示前に端末の本人確認とサーバーの信頼状態を確認します。")
                            .font(.footnote)
                    }
                } else {
                    Section {
                        Button("この端末の信頼登録を失効して削除", role: .destructive) {
                            run { try await owner.revokeAndForget() }
                        }.disabled(working)
                        Button("このiPhoneの保存情報だけ削除", role: .destructive) {
                            run { try owner.forgetLocalAfterAuthentication() }
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
