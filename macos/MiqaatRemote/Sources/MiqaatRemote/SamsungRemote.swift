import Foundation

/// Samsung 2017/Tizen 3 remote protocol. Controls the television, not Miqaat's private state.
/// Uses the TV's local (unencrypted) WebSocket endpoint on port 8001.
@MainActor
final class SamsungRemote: ObservableObject {
    @Published var address: String = UserDefaults.standard.string(forKey: "tvAddress") ?? "192.168.40.21"
    @Published private(set) var status = "Not connected"
    @Published private(set) var connected = false

    private var socket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var generation = UUID()
    private let clientName = "Miqaat Mac Remote"
    @Published var secureConnection = false

    func connect() {
        disconnect()
        let host = address.trimmingCharacters(in: .whitespacesAndNewlines)
        // Accept IPv4 addresses or DNS hostnames, not URL/port/credentials.
        guard !host.isEmpty,
              !host.contains("://"),
              !host.contains("/"),
              !host.contains("?"),
              !host.contains("#"),
              !host.contains("@"),
              !host.contains(":"),
              !host.contains(" ") else {
            status = "Enter the TV's IP address (for example 192.168.40.25)."
            return
        }
        UserDefaults.standard.set(host, forKey: "tvAddress")
        let encodedName = Data(clientName.utf8).base64EncodedString()
        let tokenKey = "tvToken.\(host)"
        var urlString = "ws://\(host):8001/api/v2/channels/samsung.remote.control?name=\(encodedName)"
        if let token = UserDefaults.standard.string(forKey: tokenKey), !token.isEmpty {
            urlString += "&token=\(token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? token)"
        }
        guard let url = URL(string: urlString) else {
            status = "Invalid TV address."
            return
        }
        let id = UUID()
        generation = id
        let newSession = URLSession(configuration: .default)
        let task = newSession.webSocketTask(with: url)
        session = newSession
        socket = task
        status = "Connecting on port \\(port)… approve access on the TV."
        task.resume()
        receive(on: task, id: id, host: host)
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(8))
            guard let self, self.generation == id, !self.connected else { return }
            self.status = "No approval received. Check TV and IP, or try TLS port 8002."
        }
    }

    func disconnect() {
        generation = UUID()
        connected = false
        pendingKeys.removeAll()
        socket?.cancel(with: .normalClosure, reason: nil)
        session?.invalidateAndCancel()
        socket = nil
        session = nil
        status = "Not connected"
    }

    func send(_ key: String) {
        // Do not send keys until the TV explicitly reports authorization.
        guard connected, let socket = socket else {
            status = "Connect and approve the remote on the TV first."
            return
        }
        let envelope: [String: Any] = [
            "method": "ms.remote.control",
            "params": [
                "Cmd": "Click",
                "DataOfCmd": key,
                "Option": "false",
                "TypeOfRemote": "SendRemoteKey"
            ]
        ]
        guard let json = try? JSONSerialization.data(withJSONObject: envelope),
              let payload = String(data: json, encoding: .utf8) else { return }
        let id = generation
        socket.send(.string(payload)) { [weak self] error in
            guard let error else { return }
            Task { @MainActor in
                guard let self, self.generation == id else { return }
                self.status = "Send failed: \(error.localizedDescription)"
                self.connected = false
            }
        }
    }

    private func receive(on task: URLSessionWebSocketTask, id: UUID, host: String) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.generation == id else { return }
                switch result {
                case .failure(let error):
                    self.connected = false
                    self.status = "Connection failed: \(error.localizedDescription)"
                case .success(let message):
                    let data: Data
                    switch message {
                    case .string(let text): data = Data(text.utf8)
                    case .data(let bytes): data = bytes
                    @unknown default:
                        self.receive(on: task, id: id, host: host)
                        return
                    }
                    if let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                       let event = object["event"] as? String {
                        switch event {
                        case "ms.channel.connect", "ms.channel.ready":
                            self.connected = true
                            self.status = "Connected to \(host)"
                            if let details = object["data"] as? [String: Any],
                               let token = details["token"] as? String, !token.isEmpty {
                                UserDefaults.standard.set(token, forKey: "tvToken.\(host)")
                            }
                        case "ms.channel.unauthorized":
                            self.connected = false
                            self.status = "TV denied access. Check the TV's device permissions."
                        case "ms.channel.timeOut", "ms.channel.disconnect":
                            self.connected = false
                            self.status = "TV disconnected. Press Connect to retry."
                        default: break
                        }
                    }
                    self.receive(on: task, id: id, host: host)
                }
            }
        }
    }
}
