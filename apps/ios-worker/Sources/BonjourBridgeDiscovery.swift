import Foundation

@MainActor
final class BonjourBridgeDiscovery: NSObject, @preconcurrency NetServiceBrowserDelegate, @preconcurrency NetServiceDelegate {
    private var browser: NetServiceBrowser?
    private var services: [NetService] = []
    private var continuation: CheckedContinuation<String?, Never>?
    private var finished = false

    static func findBridge(timeout: TimeInterval = 4) async -> String? {
        let discovery = BonjourBridgeDiscovery()
        return await discovery.search(timeout: timeout)
    }

    private func search(timeout: TimeInterval) async -> String? {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            let browser = NetServiceBrowser()
            self.browser = browser
            browser.delegate = self
            browser.searchForServices(ofType: "_jarvisiphone._tcp.", inDomain: "local.")

            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
                self?.finish(nil)
            }
        }
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        guard !finished else { return }
        services.append(service)
        service.delegate = self
        service.resolve(withTimeout: 2)
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        guard !finished, let host = sender.hostName, sender.port > 0 else { return }
        let normalizedHost = host.hasSuffix(".") ? String(host.dropLast()) : host
        finish("http://\(normalizedHost):\(sender.port)/")
    }

    func netService(_ sender: NetService, didNotResolve errorDict: [String : NSNumber]) {
        // Keep browsing until the overall timeout so another advertised bridge can resolve.
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String : NSNumber]) {
        finish(nil)
    }

    private func finish(_ value: String?) {
        guard !finished else { return }
        finished = true
        browser?.stop()
        browser?.delegate = nil
        for service in services { service.stop(); service.delegate = nil }
        services.removeAll()
        let continuation = self.continuation
        self.continuation = nil
        continuation?.resume(returning: value)
    }
}
