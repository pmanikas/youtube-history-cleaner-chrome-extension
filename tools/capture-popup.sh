#!/usr/bin/env bash
# Rebuilds the popup captures in docs/ that the store screenshots are built
# from. They used to be hand-taken in Chrome, so they drifted away from the
# real popup; this renders the actual popup/ files instead.
#
# The popup can't run outside the extension (it calls chrome.* on load), so
# this serves a copy with a small stub of the APIs it touches, sets each
# state, and shoots it with headless Chrome at the popup's own 340x700.
#
# macOS, and Google Chrome in /Applications. Run it with `npm run capture`,
# then `npm run screenshots` to rebuild the store images.

set -euo pipefail

cd "$(dirname "$0")/.."

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT="${PORT:-8731}"

if [ ! -x "$CHROME" ]; then
  echo "Google Chrome not found at $CHROME" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"; [ -n "${server:-}" ] && kill "$server" 2>/dev/null || true' EXIT

cp -R popup src icons "$work/"

python3 - "$work" <<'PY'
import pathlib, sys

root = pathlib.Path(sys.argv[1]) / "popup"
html = (root / "popup.html").read_text()

STUB = """
  <script>
    // Just enough of the extension APIs for the popup to render.
    window.chrome = {
      runtime: {
        id: 'capture',
        getURL: p => 'chrome-extension://capture/' + p,
        onMessage: { addListener: () => {} },
        sendMessage: async () => ({ ok: true, tabId: 1 }),
      },
      tabs: { query: async () => [], sendMessage: async () => ({ ok: true }) },
    };
  </script>
"""

html = html.replace('<script type="module"', STUB + '  <script type="module"')


def page(name, setup):
    (root / name).write_text(
        html.replace("</body>", f"  <script>\n    window.addEventListener('load', () => {{\n{setup}\n    }});\n  </script>\n</body>")
    )


page("capture-remove.html", """      document.querySelector('button[data-mode="delete"]').click();
      document.querySelector('button[data-category="all"]').click();
      const p = document.getElementById('date-preset');
      p.value = 'week'; p.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('scope-keyword').click();
      document.getElementById('keyword').blur();
      // Clicking the radio counts as touching the form; the capture shows
      // the resting state, not a prompt to fill the keyword in.
      document.getElementById('requirement').hidden = true;""")

page("capture-find.html", """      document.querySelector('button[data-mode="find"]').click();
      document.querySelector('button[data-category="all"]').click();
      const p = document.getElementById('date-preset');
      p.value = 'week'; p.dispatchEvent(new Event('change', { bubbles: true }));
      const k = document.getElementById('keyword');
      k.value = 'minecraft'; k.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('find-first').click();
      k.blur();""")
PY

( cd "$work" && python3 -m http.server "$PORT" >/dev/null 2>&1 ) &
server=$!

# Wait for the server rather than guessing at a sleep.
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://localhost:$PORT/popup/capture-remove.html" && break
  sleep 0.25
done

mkdir -p docs

for state in remove find; do
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --force-color-profile=srgb --force-light-mode \
    --blink-settings=preferredColorScheme=1 \
    --window-size=340,700 --virtual-time-budget=4000 \
    --screenshot="docs/popup-$state.png" \
    "http://localhost:$PORT/popup/capture-$state.html" >/dev/null 2>&1
  echo "wrote docs/popup-$state.png"
done
