// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MiqaatRemote",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "MiqaatRemote", targets: ["MiqaatRemote"])],
    targets: [
        .executableTarget(name: "MiqaatRemote", path: "Sources/MiqaatRemote")
    ]
)
