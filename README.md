# Watch History Cleaner for YouTube

A Chrome extension (Manifest V3) that bulk-removes items from your YouTube watch history, or just finds and highlights them.

## Remove

| What to clear | Everything | By keyword |
|---|---|---|
| All | Only with a date range* | Yes |
| Videos | Only with a date range* | Yes |
| Shorts | Yes | Yes |
| Music | Yes | Yes |
| Podcasts | Yes | Yes |

\* Clearing All or Videos without a keyword is blocked when the date range is "Any time". Any other date range (including "Older than" and custom) works with or without a keyword. The rule is enforced in the popup, the background worker and the page script.

Keywords must be at least 2 characters, are not case sensitive, ignore accents, and match the title (optionally also the channel name).

## When watched (date filter)

Any time, Today, Last 7 days, Last 30 days, Last 90 days, Last 12 months, Older than 30 days, Older than 1 year, or a Custom range (From and/or To). It works together with the category and keyword. Dates come from the day headings on the history page ("Today", "Yesterday", "Monday", "Oct 3", "Oct 3, 2024"); items whose heading can't be read are never removed. Because history is newest first, a cleanup stops as soon as it reaches items older than the range.

## Find only

The **Find only** tab searches the same way (category, keyword and/or dates) but never removes anything. Matches get a yellow outline on the page.

- **One at a time**: scrolls to each match and waits until you click **Next match**.
- **Find the first N**: highlights up to N matches (1 to 500), then **Previous** / **Next** jump between them.

The buttons are in the popup and in the panel on the page. **Close** on the page panel clears the highlights.

## Install (unpacked)

1. Unzip `youtube-history-cleaner.zip` (or use this folder).
2. Open `chrome://extensions`, turn on **Developer mode**.
3. Click **Load unpacked** and pick the folder that contains `manifest.json`.
4. Sign in to YouTube, click the extension icon, choose what to clear, and confirm.

## How it works

1. The popup validates your choice and asks for confirmation.
2. The background worker reuses a YouTube tab (or opens one) and navigates it to `https://www.youtube.com/feed/history`. It never navigates a non-YouTube tab away.
3. The page script selects the matching filter tab (All, Videos, Shorts, Music, Podcasts). If the tab is missing, which happens because of a YouTube bug, it clicks a different tab and looks again, several times.
4. It removes matching items through YouTube's own "Remove from watch history" control (the X button or the ⋮ menu), Shorts row by row as in the original script, then scrolls for more until history runs out.
5. A panel in the bottom-right of the page shows progress and has a **Stop** button. You can also stop from the popup, or run `window.__YT_SHORTS_CLEANER_STOP__ = true` in the console.

Safety checks: a removal job stops immediately if the selected filter tab is no longer selected, or if you leave the history page. Shorts mode only removes items that link to `/shorts/`, and Videos mode never removes Shorts. If the Music or Podcasts tab can't be found, nothing is removed. If the Shorts or Videos tab can't be found, it falls back to the All tab and filters by link type.

## Known limits

- YouTube's interface must be in **English** (it looks for the "Remove from watch history" text and the English tab names).
- YouTube changes its page structure often; if items stop being removed, try the **Careful** speed or reload the page and run again.
- Matching uses only what the history page shows (title, channel). It does not use YouTube's own history search.

## Files

- `manifest.json`: Manifest V3, permissions `scripting` + host access to `https://www.youtube.com/*` only.
- `popup/`: the popup UI.
- `src/background.js`: opens the history tab and starts the job.
- `src/cleaner.js`: the content script that does the cleaning (based on the original Shorts script).
- `src/shared.js`: shared option rules.
- `PRIVACY.md`: privacy policy (needed for the Chrome Web Store).
- `LICENSE`: MIT.
- `package.json`: no dependencies, just `npm run zip` to build the upload archive.
- `store/`: 1280x800 screenshots for the Chrome Web Store listing.
- `docs/`: raw popup captures the store screenshots are built from.
- `tools/`: `screenshots.sh` (listing copy) and `make-screenshot.swift` (the drawing).

## Packaging

`npm run zip` writes `youtube-history-cleaner.zip` containing `manifest.json`, `popup/`, `src/` and `icons/` and nothing else, ready to upload to the Chrome Web Store. It uses the system `zip` command, so there are no dependencies to install. The zip itself is gitignored.

`npm run screenshots` rebuilds the 1280x800 listing screenshots in `store/` from the popup captures in `docs/`. Edit the headlines and bullets in `tools/screenshots.sh`, then re-run it. macOS only: the drawing is a Swift script using CoreGraphics, so it needs the Xcode command line tools and nothing else. Replace the captures in `docs/` when the popup changes.

## Chrome Web Store notes

- Single purpose: removing items from the user's own YouTube watch history.
- Permission justifications: `scripting` re-attaches the page script to YouTube tabs that were open before install; host access to `www.youtube.com` is needed to read and act on the history page.
- Data usage: no data collected; no remote code.
- The name uses "for YouTube" and the listing should say it is not affiliated with YouTube or Google. Don't use YouTube's logo in the icon or screenshots' branding.

## License

MIT, see [LICENSE](LICENSE). Pull requests are welcome; anything you contribute is taken under the same license.
