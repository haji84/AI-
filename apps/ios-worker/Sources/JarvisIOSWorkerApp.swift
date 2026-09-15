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
    @State private var showAdvanced = false

    var body: some View {
        NavigationStack {
            Form {
                Section("JARVIS Worker") {
                    LabeledContent("State", value: worker.status)
                    LabeledContent("Device", value: worker.deviceId)
                        .font(.caption)
                    if !worker.bridgeURL.isEmpty {
                        LabeledContent("Bridge", value: worker.bridgeURL)
                            .font(.caption)
                    }
                    Button(worker.isRunning ? "Stop Worker" : "Connect") {
                        Task { await worker.toggle() }
                    }
                    if worker.isDiscovering {
                        ProgressView("Searching the local network…")
                    }
                }

                Section("Status") {
                    LabeledContent("Last task", value: worker.lastTaskId ?? "-")
                    LabeledContent("Last result", value: worker.lastResult ?? "-")
                }

                DisclosureGroup("Advanced / fallback", isExpanded: $showAdvanced) {
                    TextField("Bridge URL", text: $worker.bridgeURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    TextField("Device ID", text: $worker.deviceId)
                        .textInputAutocapitalization(.never)
                    SecureField("Device credential", text: $worker.token)
                    Button("Retry with these settings") {
                        Task { await worker.toggle() }
                    }
                    Button("Forget saved connection", role: .destructive) {
                        worker.forgetConnection()
                    }
                }

                Section("Evidence") {
                    Text(worker.evidenceLog.isEmpty ? "No physical-device evidence yet." : worker.evidenceLog)
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                }
            }
            .navigationTitle("JARVIS Worker")
            .task { await worker.autoStart() }
        }
    }
}
