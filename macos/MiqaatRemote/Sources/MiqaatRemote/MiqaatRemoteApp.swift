import SwiftUI

@main
struct MiqaatRemoteApp: App {
    @StateObject private var remote = SamsungRemote()

    var body: some Scene {
        WindowGroup("Miqaat Remote") {
            RemoteView()
                .environmentObject(remote)
                .frame(minWidth: 340, minHeight: 560)
        }
        .defaultSize(width: 390, height: 710)
    }
}
