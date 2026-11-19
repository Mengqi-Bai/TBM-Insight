// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TBM_ENGINECUANative",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "tbm-cua-native", targets: ["CuaNative"])],
    targets: [
        .executableTarget(name: "CuaNative"),
        .testTarget(name: "CuaNativeTests", dependencies: ["CuaNative"], path: "tests/swift"),
    ],
    swiftLanguageModes: [.v6]
)
