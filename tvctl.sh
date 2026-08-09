#!/usr/bin/env bash
# tvctl.sh — find, connect, build, and install Miqaat on the Samsung Tizen TV.
#
# Usage:
#   ./tvctl.sh deploy       # find TV, connect, build, push, install, launch (default)
#   ./tvctl.sh find         # discover the TV's IP on the LAN
#   ./tvctl.sh connect      # find + sdb connect
#   ./tvctl.sh build        # tizen package -> .wgt
#   ./tvctl.sh install      # push + install (auto-fixes error 118)
#   ./tvctl.sh launch       # start the app on the TV
#   ./tvctl.sh kill         # stop the app on the TV
#   ./tvctl.sh uninstall    # remove the app from the TV
#   ./tvctl.sh status       # is the TV reachable / is the app installed
#   ./tvctl.sh applist      # list every app installed on the TV (with app ids)
#   ./tvctl.sh logs         # tail TV app logs

set -euo pipefail

# ---- config -----------------------------------------------------------
APP_ID="Miqaat0001.Miqaat"
PROFILE="iptv-samsung"         # same Samsung cert as the IPTV app -> no error 118 churn
WGT_NAME="Miqaat.wgt"
STAGE_DIR=".tizen-stage"
APP_FILES=(config.xml icon.png index.html styles.css js assets)
TV_REMOTE_PATH="/home/owner/share/tmp/Miqaat.wgt"
TV_MAC_PREFIX="54:bd:79"       # known TV NIC prefix, used to re-find it if its IP changes
SUBNET="192.168.40"            # LAN /24 to scan when the MAC isn't in the ARP cache yet
SDB_PORT=26101
IP_CACHE_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.tv_ip_cache"

export PATH="$HOME/.tizen-extension-platform/server/sdktools/data/tools/ide/bin:$HOME/.tizen-extension-platform/server/sdktools/data/tools:$PATH"

cd "$(dirname "${BASH_SOURCE[0]}")"

log() { echo "==> $*"; }

# ---- discovery ----------------------------------------------------------
find_tv_ip() {
  local ip=""

  # 1. try the cached last-known-good IP first (fast path)
  if [ -f "$IP_CACHE_FILE" ]; then
    ip="$(cat "$IP_CACHE_FILE")"
    if [ -n "$ip" ] && nc -z -G 1 "$ip" "$SDB_PORT" >/dev/null 2>&1; then
      echo "$ip"; return 0
    fi
  fi

  # 2. check the current ARP cache for the TV's MAC prefix
  ip="$(arp -a | grep -i "$TV_MAC_PREFIX" | grep -oE '\([0-9.]+\)' | tr -d '()' | head -1)"
  if [ -n "$ip" ] && nc -z -G 1 "$ip" "$SDB_PORT" >/dev/null 2>&1; then
    echo "$ip" > "$IP_CACHE_FILE"; echo "$ip"; return 0
  fi

  # 3. refresh ARP by pinging the subnet, then re-check
  log "Scanning $SUBNET.0/24 for the TV (by MAC $TV_MAC_PREFIX)..." >&2
  for i in $(seq 1 254); do
    ping -c 1 -t 1 "$SUBNET.$i" >/dev/null 2>&1 &
  done
  wait
  ip="$(arp -a | grep -i "$TV_MAC_PREFIX" | grep -oE '\([0-9.]+\)' | tr -d '()' | head -1)"
  if [ -n "$ip" ] && nc -z -G 1 "$ip" "$SDB_PORT" >/dev/null 2>&1; then
    echo "$ip" > "$IP_CACHE_FILE"; echo "$ip"; return 0
  fi

  # 4. last resort: scan every host on the subnet for the open sdb port directly
  log "MAC not found in ARP, scanning for open sdb port $SDB_PORT directly..." >&2
  ip="$(seq 1 254 | xargs -P 50 -I{} sh -c "nc -z -G 1 $SUBNET.{} $SDB_PORT >/dev/null 2>&1 && echo $SUBNET.{}" | head -1)"
  if [ -n "$ip" ]; then
    echo "$ip" > "$IP_CACHE_FILE"; echo "$ip"; return 0
  fi

  return 1
}

cmd_find() {
  local ip
  if ip="$(find_tv_ip)"; then
    log "TV found at $ip"
  else
    echo "Could not find the TV on $SUBNET.0/24. Make sure it's powered on and connected." >&2
    exit 1
  fi
}

cmd_connect() {
  local ip
  ip="$(find_tv_ip)" || { echo "TV not found on the network." >&2; exit 1; }
  log "Connecting to $ip:$SDB_PORT..."
  sdb connect "$ip" || true
  if ! sdb devices | grep -q "$ip"; then
    echo "sdb rejected the connection. On the TV: Apps -> press 1,2,3,4,5 -> Developer mode -> set Host PC IP to this Mac's IP, then restart the TV." >&2
    exit 1
  fi
  log "Connected."
}

# ---- build / install ---------------------------------------------------
cmd_build() {
  log "Staging app files (${APP_FILES[*]})..."
  rm -rf "$STAGE_DIR"
  mkdir -p "$STAGE_DIR"
  for f in "${APP_FILES[@]}"; do
    # -e / cp -R so js/ and assets/ come along, not just the flat files
    [ -e "$f" ] || { echo "Missing required file: $f" >&2; exit 1; }
    cp -R "$f" "$STAGE_DIR/"
  done

  log "Building .wgt package (profile: $PROFILE)..."
  rm -f "$WGT_NAME"
  tizen package -t wgt -s "$PROFILE" -o "$(pwd)" -- "$STAGE_DIR"
  rm -rf "$STAGE_DIR"
  [ -f "$WGT_NAME" ] || { echo "Build did not produce '$WGT_NAME'." >&2; exit 1; }
  log "Built '$WGT_NAME' ($(du -h "$WGT_NAME" | cut -f1))."
}

cmd_install() {
  [ -f "$WGT_NAME" ] || cmd_build
  log "Pushing package to TV..."
  sdb push "$WGT_NAME" "$TV_REMOTE_PATH"

  log "Installing $APP_ID..."
  local out
  out="$(sdb shell 0 vd_appinstall "$APP_ID" "$TV_REMOTE_PATH" 2>&1)"
  echo "$out"

  if echo "$out" | grep -q "118"; then
    log "Error 118 (certificate mismatch) — uninstalling old copy and retrying..."
    sdb shell 0 vd_appuninstall "$APP_ID" || true
    sdb shell 0 vd_appinstall "$APP_ID" "$TV_REMOTE_PATH"
  elif ! echo "$out" | grep -q "install completed"; then
    echo "Install did not report success — check output above." >&2
    exit 1
  fi
  log "Install complete."
}

cmd_launch() {
  log "Launching $APP_ID..."
  sdb shell 0 was_execute "$APP_ID"
}

cmd_kill() {
  log "Stopping $APP_ID..."
  sdb shell 0 was_kill "$APP_ID"
}

cmd_uninstall() {
  log "Uninstalling $APP_ID..."
  sdb shell 0 vd_appuninstall "$APP_ID"
}

cmd_status() {
  local ip
  if ip="$(find_tv_ip)"; then
    log "TV reachable at $ip:$SDB_PORT"
  else
    echo "TV not reachable."
    exit 1
  fi
  sdb connect "$ip" >/dev/null 2>&1 || true
  sdb devices
}

# Dump every installed app id — needed to build the interruption label map
# (Netflix / YouTube / Prime ids differ across firmware, don't trust blog posts).
cmd_applist() {
  log "Installed apps on the TV:"
  sdb shell 0 applist
}

cmd_logs() {
  log "Tailing TV logs (Ctrl+C to stop)..."
  sdb dlog | grep -i --line-buffered "miqaat\|Miqaat"
}

cmd_deploy() {
  cmd_connect
  cmd_build
  cmd_install
  cmd_launch
  log "Deployed and launched on the TV."
}

# ---- dispatch -----------------------------------------------------------
case "${1:-deploy}" in
  find) cmd_find ;;
  connect) cmd_connect ;;
  build) cmd_build ;;
  install) cmd_install ;;
  launch) cmd_launch ;;
  kill) cmd_kill ;;
  uninstall) cmd_uninstall ;;
  status) cmd_status ;;
  applist) cmd_applist ;;
  logs) cmd_logs ;;
  deploy) cmd_deploy ;;
  *)
    echo "Usage: $0 {deploy|find|connect|build|install|launch|kill|uninstall|status|applist|logs}" >&2
    exit 1
    ;;
esac
