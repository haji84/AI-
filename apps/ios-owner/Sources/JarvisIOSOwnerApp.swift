import SwiftUI

@main
struct JarvisIOSOwnerApp: App {
    @StateObject private var owner = OwnerCredentialRuntime()
    @StateObject private var daily = DailyDriverRuntime()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            TabView {
                DailyDriverView()
                    .environmentObject(owner)
                    .environmentObject(daily)
                    .tabItem {
                        Label("ホーム", systemImage: "sparkles")
                    }

                OwnerCredentialView()
                    .environmentObject(owner)
                    .tabItem {
                        Label("Owner", systemImage: "person.badge.key")
                    }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active { owner.hideRecoveryCode() }
            }
            .privacySensitive()
        }
    }
}

struct DailyDriverView: View {
    @EnvironmentObject private var owner: OwnerCredentialRuntime
    @EnvironmentObject private var daily: DailyDriverRuntime
    @State private var restored = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("GORIQ")
                            .font(.system(size: 34, weight: .black, design: .rounded))
                        Text("やりたいことを、そのまま入力")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    if owner.isEnrolled {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("GORIQに何をしてほしい？")
                                .font(.headline)

                            TextField(
                                "例：GitHubの続きを確認して、必要なら修正して",
                                text: $daily.command,
                                axis: .vertical
                            )
                            .lineLimit(2...6)
                            .textInputAutocapitalization(.sentences)
                            .submitLabel(.send)

                            HStack {
                                Spacer()
                                Button {
                                    daily.submit(owner: owner)
                                } label: {
                                    Image(systemName: "arrow.up")
                                        .font(.title3.bold())
                                        .frame(width: 48, height: 48)
                                }
                                .buttonStyle(.borderedProminent)
                                .clipShape(Circle())
                                .disabled(daily.command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || daily.isSubmitting)
                            }
                        }
                        .padding()
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 22))

                        statusGrid

                        if daily.humanGate {
                            VStack(alignment: .leading, spacing: 10) {
                                Label("確認が必要な操作があります", systemImage: "hand.raised.fill")
                                    .font(.headline)
                                    .foregroundStyle(.orange)
                                Button("Face IDで本人確認") {
                                    Task {
                                        do {
                                            try await owner.confirmProtectedOperation(reason: "保護された操作を確認します")
                                            daily.markProtectedIdentityConfirmed()
                                        } catch {
                                            daily.markProtectedIdentityConfirmationFailed(error.localizedDescription)
                                        }
                                    }
                                }
                                .buttonStyle(.borderedProminent)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding()
                            .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 16))
                        }

                        if let message = daily.message {
                            Text(message)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        if daily.goalId != nil {
                            Button {
                                daily.refresh(owner: owner)
                            } label: {
                                Label("進捗を更新", systemImage: "arrow.clockwise")
                            }
                            .buttonStyle(.bordered)
                        }
                    } else {
                        ContentUnavailableView(
                            "Owner登録が必要です",
                            systemImage: "person.badge.key",
                            description: Text("下の「Owner」タブで、このiPhoneをGoogleまたは復旧コードから登録してください。")
                        )
                    }
                }
                .padding()
            }
            .navigationTitle("ホーム")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                guard !restored else { return }
                restored = true
                daily.restore(owner: owner)
            }
        }
    }

    private var statusGrid: some View {
        Grid(horizontalSpacing: 12, verticalSpacing: 12) {
            GridRow {
                statusCard(title: "現在", value: daily.phase, detail: daily.currentWork)
                statusCard(title: "進捗", value: daily.progressText, detail: "閉じてもGoalは継続")
            }
            GridRow {
                statusCard(title: "確認", value: daily.humanGate ? "あり" : "なし", detail: "必要なときだけ")
                statusCard(title: "復旧", value: String(daily.recoveryCount), detail: "自動再試行")
            }
        }
    }

    private func statusCard(title: String, value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline)
                .lineLimit(2)
            Text(detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, minHeight: 88, alignment: .topLeading)
        .padding(12)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
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
                    Section("端末鍵") {
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
                        Text("通信できない場合の端末内削除です。サーバー側の失効はGORIQ端末管理で確認してください。")
                            .font(.footnote)
                    }
                }
                if let message { Section { Text(message).font(.footnote) } }
            }
            .navigationTitle("Owner")
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
