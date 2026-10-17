#!/usr/bin/env bash
# Rebuilds the Chrome Web Store screenshots in store/ from the popup captures in
# docs/. The listing copy lives here; the drawing lives in make-screenshot.swift.
#
# macOS only: it uses Swift with CoreGraphics, which ships with the command line
# tools. Run it with `npm run screenshots`.

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v swift >/dev/null 2>&1; then
  echo "swift not found. Install the Xcode command line tools: xcode-select --install" >&2
  exit 1
fi

mkdir -p store

swift tools/make-screenshot.swift \
  store/screenshot-1-remove.png \
  docs/popup-remove.png \
  "Clear your watch history in bulk" \
  "Pick a category, a keyword and a date range, then remove every matching item in one pass." \
  "All, Videos, Shorts, Music or Podcasts" \
  "Keyword and date filters work together" \
  "Uses YouTube's own remove control"

swift tools/make-screenshot.swift \
  store/screenshot-2-find.png \
  docs/popup-find.png \
  "Find matches without deleting" \
  "Find only highlights the items that match on the page, so you can look before anything is removed." \
  "Yellow outline on every match" \
  "Step through one at a time, or highlight up to 500" \
  "Nothing is removed in this mode"
