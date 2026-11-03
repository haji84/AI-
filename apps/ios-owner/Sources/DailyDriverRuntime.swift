import Combine
import Foundation

@MainActor
final class DailyDriverRuntime: ObservableObject {
    @Published var command = ""
    @Published private(set) var phase = "待機中"
    @Published private(set) var currentWork = "入力待ち"
    @Published private(set) var progressText = "自動"
    @Published private(set) var humanGate = false
    @Published private(set) var recoveryCount = 0
    @Published private(set) var goalId: String?
    @Published private(set) var nextAction: String?
    @Published private(set) var message: String?
    @Published private(set) var isSubmitting = false

    private var pollTask: Task<Void, Never>?
    private let lastGoalKey = "goriq-native-last-goal-id"

    deinit { pollTask?.cancel() }

    func restore(owner: OwnerCredentialRuntime) {
        guard owner.isEnrolled,
              let saved = UserDefaults.standard.string(forKey: lastGoalKey),
              !saved.isEmpty else { return }
        goalId = saved
        phase = "受付済み"
        currentWork = "前回のGoalを確認中"
        startPolling(owner: owner, goalId: saved)
    }

    func submit(owner: OwnerCredentialRuntime) {
        let text = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSubmitting else { return }
        isSubmitting = true
        message = nil

        Task {
            defer { isSubmitting = false }
            do {
                try await owner.ensureOwnerSession(extendIdle: true)
                let idempotencyKey = UUID().uuidString
                let body: [String: Any] = [
                    "text": text,
                    "idempotencyKey": idempotencyKey
                ]
                var result = try await owner.ownerAPIRequest(
                    path: "/api/jarvis/work",
                    method: "POST",
                    jsonBody: body
                )
                if result.statusCode == 401 {
                    owner.invalidateOwnerSession()
                    try await owner.ensureOwnerSession(extendIdle: true)
                    result = try await owner.ownerAPIRequest(
                        path: "/api/jarvis/work",
                        method: "POST",
                        jsonBody: body
                    )
                }
                guard result.statusCode == 202 || result.statusCode == 200 else {
                    throw DailyDriverError.server(result.statusCode)
                }
                guard let body = try JSONSerialization.jsonObject(with: result.data) as? [String: Any] else {
                    throw DailyDriverError.invalidResponse
                }

                command = ""
                let action = body["action"] as? String
                nextAction = body["nextAction"] as? String

                if action == "DEVICE_ACTION" {
                    goalId = nil
                    UserDefaults.standard.removeObject(forKey: lastGoalKey)
                    phase = "端末操作受付済み"
                    currentWork = nextAction ?? "端末へ安全な操作を送信しました"
                    progressText = "自動"
                    humanGate = false
                    return
                }

                if action == "DEVICE_ACTION_PROTECTED" {
                    phase = "確認が必要"
                    currentWork = nextAction ?? "保護対象の操作です"
                    humanGate = true
                    message = body["message"] as? String
                    return
                }

                guard let id = body["goalId"] as? String, !id.isEmpty else {
                    phase = "受付済み"
                    currentWork = nextAction ?? "GORIQが処理を引き継ぎました"
                    return
                }

                goalId = id
                UserDefaults.standard.set(id, forKey: lastGoalKey)
                phase = "受付済み"
                currentWork = nextAction ?? "GORIQが処理を引き継ぎました"
                progressText = "自動"
                humanGate = false
                startPolling(owner: owner, goalId: id)
            } catch {
                phase = "受付失敗"
                currentWork = "再試行できます"
                message = error.localizedDescription
            }
        }
    }

    func markProtectedIdentityConfirmed() {
        phase = "本人確認済み"
        currentWork = "Rollback準備完了後に実行できます"
        message = "本人確認は完了しました。操作はまだ実行されていません。"
    }

    func markProtectedIdentityConfirmationFailed(_ detail: String) {
        phase = "確認が必要"
        message = detail
    }

    func refresh(owner: OwnerCredentialRuntime) {
        guard let goalId else { return }
        Task { await pollOnce(owner: owner, goalId: goalId, retryAuth: true) }
    }

    private func startPolling(owner: OwnerCredentialRuntime, goalId: String) {
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled {
                let terminal = await pollOnce(owner: owner, goalId: goalId, retryAuth: true)
                if terminal { return }
                try? await Task.sleep(nanoseconds: 1_500_000_000)
            }
        }
    }

    @discardableResult
    private func pollOnce(owner: OwnerCredentialRuntime, goalId: String, retryAuth: Bool) async -> Bool {
        do {
            var result = try await owner.ownerAPIRequest(path: "/api/jarvis/work/\(goalId)")
            if result.statusCode == 401 && retryAuth {
                owner.invalidateOwnerSession()
                try await owner.ensureOwnerSession(extendIdle: false)
                result = try await owner.ownerAPIRequest(path: "/api/jarvis/work/\(goalId)")
            }
            if result.statusCode == 404 {
                UserDefaults.standard.removeObject(forKey: lastGoalKey)
                self.goalId = nil
                phase = "待機中"
                currentWork = "入力待ち"
                return true
            }
            guard result.statusCode == 200,
                  let body = try JSONSerialization.jsonObject(with: result.data) as? [String: Any],
                  let run = body["run"] as? [String: Any] else { return false }

            phase = run["phase"] as? String ?? "実行中"
            currentWork = (run["currentWork"] as? String) ?? nextAction ?? "GORIQが処理中"
            recoveryCount = run["recoveryCount"] as? Int ?? 0
            humanGate = phase == "HUMAN_GATE"

            if let progress = body["progress"] as? [String: Any],
               progress["determinate"] as? Bool == true,
               let value = progress["value"] as? Double {
                progressText = "\(Int((value * 100).rounded()))%"
            } else {
                progressText = "自動"
            }

            let terminal = ["COMPLETED", "BLOCKED", "FAILED", "HUMAN_GATE"].contains(phase)
            if terminal {
                if phase == "COMPLETED" {
                    UserDefaults.standard.removeObject(forKey: lastGoalKey)
                }
                return true
            }
            return false
        } catch {
            message = error.localizedDescription
            return false
        }
    }
}

enum DailyDriverError: LocalizedError {
    case authentication
    case invalidResponse
    case server(Int)

    var errorDescription: String? {
        switch self {
        case .authentication:
            return "Owner認証を更新できませんでした"
        case .invalidResponse:
            return "GORIQからの応答を読み取れませんでした"
        case .server(let status):
            return "GORIQ Runtimeからエラーが返りました（HTTP \(status)）"
        }
    }
}
