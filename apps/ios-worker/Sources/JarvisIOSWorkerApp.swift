import SwiftUI

@main
struct JarvisIOSWorkerApp: App {
    @StateObject private var worker = WorkerRuntime()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(worker)
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var worker: WorkerRuntime

    var body: some View {
        NavigationStack {
            Form {
                Section("Worker") {
                    TextField("Bridge URL", text: $worker.bridgeURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    TextField("Device ID", text: $worker.deviceId)
                        .textInputAutocapitalization(.never)
                    SecureField("Enrollment token", text: $worker.token)
                    Button(worker.isRunning ? "Stop Worker" : "Enroll & Start") {
                        Task { await worker.toggle() }
                    }
                    .disabled(worker.bridgeURL.isEmpty || worker.deviceId.isEmpty || worker.token.isEmpty)
                }

                Section("Status") {
                    LabeledContent("State", value: worker.status)
                    LabeledContent("Last task", value: worker.lastTaskId ?? "-")
                    LabeledContent("Last result", value: worker.lastResult ?? "-")
                }

                Section("Evidence") {
                    Text(worker.evidenceLog.isEmpty ? "No physical-device evidence yet." : worker.evidenceLog)
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                }
            }
            .navigationTitle("JARVIS Worker")
        }
    }
}
