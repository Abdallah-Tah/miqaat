# Miqaat Remote for macOS

A native SwiftUI remote for the Samsung UN55MU6290 (2017 / Tizen 3.0) used by Miqaat.

## Run on your Mac

Requires macOS 13+ and Xcode 15+ (Swift 5.9+).

1. Open Terminal and go to `macos/MiqaatRemote`.
2. Run `swift run`. Alternatively, open `Package.swift` in Xcode, choose the MiqaatRemote executable, and Run.
3. Turn on the Samsung TV and connect the Mac to the same home network.
4. Find the TV IP in Samsung TV Settings → Network → Network Status (or via the existing repository command `./tvctl.sh find` from the repository root if TV developer mode/SDB is configured).
5. Enter the TV IP in the Mac app and click **Connect**.
6. Accept the **Allow** request shown on the TV. The app saves the pairing token for that TV IP, when supplied.
7. Use Home to open the TV launcher, choose Miqaat, and control it with the arrow keys / OK / Back.

## What works

- TV D-pad, OK, Back, Exit, Home, Menu, Source, Power, Volume and Mute (subject to Samsung firmware).
- Miqaat's existing navigation screens.
- Numeric diagnostics shortcuts 1 / 2 / 8 while the Miqaat Diagnostics screen is already open.
- Saved TV IP and pairing token.

## Important limits

- This uses Samsung's local WebSocket remote interface on port **8001** (`ws://`), which is not encrypted. Only use it on a trusted home network; do not expose port 8001 to the internet. No cloud service or Samsung account is required.
- TV firmware may disable port 8001 or require TLS on 8002; this first version does not implement TLS.
- Power can turn the TV off; it normally cannot turn an already-off TV on via WebSocket. Wake-on-LAN is not implemented.
- The Miqaat shortcut keys are **TV remote key events**, not private APIs. They only work where the Miqaat app already handles them. There is no automatic launch of Miqaat yet.
- The native app is not tested against the physical TV yet; acceptance and key behavior need testing on the actual set.
- If macOS app sandboxing is enabled when building a packaged app, allow outgoing network connections in its entitlements.

This is a separate Mac utility. No changes are needed in Miqaat's ES5/Tizen code.
