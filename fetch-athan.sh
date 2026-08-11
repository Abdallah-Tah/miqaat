#!/usr/bin/env bash
# Fetch athan audio from AlAdhan's CDN and transcode it down for the TV.
#
#   ./fetch-athan.sh
#
# The recordings are third-party audio served by aladhan.com for use with their
# adhan player, so they are NOT committed to this repo — run this once after a
# fresh clone. Source files are 128-227 kbps stereo and 2.9-5.2 MB each; a TV
# speaker gains nothing from that, so they are re-encoded to 56 kbps mono,
# which keeps the whole .wgt comfortably small.
#
# Reciter names come from https://aladhan.com/download-adhans, which attributes
# each file. Do not invent names for CDN files that page does not list.
#
# IMPORTANT: some of these are FAJR adhans -- they contain
# "as-salatu khayrun min an-nawm" ("prayer is better than sleep"), which is said
# only at Fajr. Playing one at Maghrib is wrong. Known-Fajr files are marked
# below and the app keeps a separate Fajr reciter setting.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
OUT="assets/athan"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$OUT"

command -v ffmpeg >/dev/null || { echo "ffmpeg required: brew install ffmpeg" >&2; exit 1; }

# CDN id -> local slot. a3 is skipped: it is Karl Jenkins' "The Armed Man:
# A Mass For Peace", a choral piece rather than a call to prayer.
# a6 and a10 are skipped too: they exist on the CDN but the download page does
# not attribute them, and unattributed audio is not worth shipping.
SLOTS=(
  "a4:alafasy-dubai"
  "a7:alafasy-2"
  "a9:alafasy-3"
  "a2:ozcan"
  "a11-mansour-al-zahrani:zahrani"
  "a1:nafees-fajr"
)

echo "fetching athan audio from cdn.aladhan.com"
for pair in "${SLOTS[@]}"; do
  src="${pair%%:*}"
  dst="${pair##*:}"
  url="https://cdn.aladhan.com/audio/adhans/${src}.mp3"

  curl -fsS -m 180 -o "$TMP/$src.mp3" "$url" || { echo "  ! failed $url" >&2; continue; }
  ffmpeg -nostdin -v error -y -i "$TMP/$src.mp3" \
         -ac 1 -b:a 56k -codec:a libmp3lame "$OUT/$dst.mp3"

  dur=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$OUT/$dst.mp3" | cut -d. -f1)
  printf "  %-10s <- %-4s  %sm%02ss  %s\n" \
    "$dst.mp3" "$src" "$((dur / 60))" "$((dur % 60))" "$(du -h "$OUT/$dst.mp3" | cut -f1)"
done

echo "total: $(du -sh "$OUT" | cut -f1)"
