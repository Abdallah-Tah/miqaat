import SwiftUI

struct RemoteView: View {
    @EnvironmentObject private var remote: SamsungRemote

    private let ink = Color(red: 0.92, green: 0.95, blue: 0.91)
    private let emerald = Color(red: 0.35, green: 0.76, blue: 0.57)

    var body: some View {
        ScrollView {
            VStack(spacing: 17) {
                VStack(spacing: 3) {
                    Text("MIQAAT").font(.system(size: 13, weight: .semibold, design: .rounded))
                        .tracking(5).foregroundStyle(emerald)
                    Text("TV Remote").font(.system(size: 30, weight: .bold, design: .rounded))
                        .foregroundStyle(ink)
                    Text("Samsung Tizen • Mac").font(.caption).foregroundStyle(.gray)
                }
                .padding(.top, 12)

                VStack(spacing: 9) {
                    HStack {
                        TextField("TV IP address, e.g. 192.168.40.25", text: $remote.address)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit { remote.connect() }
                            .accessibilityLabel("Samsung TV IP address")
                        Button(remote.connected ? "Reconnect" : "Connect") { remote.connect() }
                            .buttonStyle(.borderedProminent)
                            .tint(emerald)
                    }
                    HStack(spacing: 7) {
                        Circle().fill(remote.connected ? emerald : .orange).frame(width: 7, height: 7)
                        Text(remote.status).font(.caption).foregroundStyle(.secondary)
                        Spacer()
                    }
                    if remote.connected {
                        Button("Disconnect") { remote.disconnect() }
                            .font(.caption).buttonStyle(.plain).foregroundStyle(.secondary)
                    }
                }
                .padding(14)
                .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 16))

                HStack(spacing: 12) {
                    remoteButton("Power", icon: "power", key: "KEY_POWER")
                    remoteButton("Home", icon: "house", key: "KEY_HOME")
                    remoteButton("Source", icon: "tv", key: "KEY_SOURCE")
                }

                VStack(spacing: 2) {
                    remoteButton("", icon: "chevron.up", key: "KEY_UP", wide: true)
                    HStack(spacing: 2) {
                        remoteButton("", icon: "chevron.left", key: "KEY_LEFT", wide: true)
                        remoteButton("OK", icon: nil, key: "KEY_ENTER", wide: true)
                            .fontWeight(.bold)
                        remoteButton("", icon: "chevron.right", key: "KEY_RIGHT", wide: true)
                    }
                    remoteButton("", icon: "chevron.down", key: "KEY_DOWN", wide: true)
                }
                .padding(7)
                .background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 24))

                HStack(spacing: 12) {
                    remoteButton("Back", icon: "arrow.uturn.backward", key: "KEY_RETURN")
                    remoteButton("Exit", icon: "xmark", key: "KEY_EXIT")
                    remoteButton("Menu", icon: "line.3.horizontal", key: "KEY_MENU")
                }

                HStack(spacing: 12) {
                    remoteButton("Vol −", icon: "speaker.minus", key: "KEY_VOLDOWN")
                    remoteButton("Mute", icon: "speaker.slash", key: "KEY_MUTE")
                    remoteButton("Vol +", icon: "speaker.plus", key: "KEY_VOLUP")
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("MIQAAT / DIAGNOSTICS").font(.caption.weight(.semibold))
                        .tracking(1.5).foregroundStyle(emerald)
                    Text("Open Miqaat from the TV Home screen. D-pad controls its menus; diagnostics shortcuts work only while the Miqaat Diagnostics screen is open.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        remoteButton("Test Athan 1", icon: "play.circle", key: "KEY_1")
                        remoteButton("Alarm +60s 2", icon: "alarm", key: "KEY_2")
                        remoteButton("Logs 8", icon: "list.bullet", key: "KEY_8")
                    }
                }
                .padding(14)
                .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 16))

                Text("The TV must be on and connected to the same local network. Approve the pairing request on the TV.")
                    .font(.caption2).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 10)
            }
            .padding(18)
        }
        .background(Color(red: 0.055, green: 0.11, blue: 0.105))
        .preferredColorScheme(.dark)
    }

    private func remoteButton(_ title: String, icon: String?, key: String, wide: Bool = false) -> some View {
        Button {
            remote.send(key)
        } label: {
            VStack(spacing: 4) {
                if let icon {
                    Image(systemName: icon).font(.system(size: 19, weight: .medium))
                }
                if !title.isEmpty {
                    Text(title).font(.system(size: 12, weight: .medium)).lineLimit(1)
                }
            }
            .foregroundStyle(ink)
            .frame(maxWidth: wide ? 90 : .infinity)
            .frame(height: wide ? 57 : 55)
            .background(.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .disabled(!remote.connected)
        .opacity(remote.connected ? 1 : 0.48)
    }
}
