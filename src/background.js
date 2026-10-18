// Background service worker: opens the watch history page in a YouTube
// tab and hands the job to the content script running there.

import { HISTORY_URL, validateOptions } from './shared.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const isHistory = url => typeof url === 'string' && url.startsWith(HISTORY_URL);

// Always a fresh tab. Reusing one meant navigating a YouTube tab the user
// was already using — losing their place in a video, and leaving the page
// scrolled and filtered by the cleanup afterwards. A new tab also starts
// from a clean history page every time, with no filter chip already
// selected and nothing already scrolled.
async function getHistoryTab() {
  const tab = await chrome.tabs.create({ url: HISTORY_URL, active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  return tab;
}

async function waitForTab(tabId, timeout = 30000) {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete' && isHistory(tab.url)) return tab;
    await sleep(250);
  }

  throw new Error('The watch history page took too long to load.');
}

async function ping(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'ythc:ping' });
    return !!res?.ok;
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId) {
  for (let i = 0; i < 20; i++) {
    if (await ping(tabId)) return;

    // The manifest's content script runs on every youtube.com load, so a
    // tab we just created should already have it. This is the safety net
    // for the case where it didn't register in time.
    if (i === 4) {
      await chrome.scripting
        .executeScript({ target: { tabId }, files: ['src/cleaner.js'] })
        .catch(() => {});
    }

    await sleep(250);
  }

  throw new Error("Couldn't connect to the YouTube tab. Reload it and try again.");
}

async function start(options) {
  const problem = validateOptions(options);
  if (problem) return { ok: false, error: problem.message };

  const tab = await getHistoryTab();
  await waitForTab(tab.id);
  await ensureContentScript(tab.id);

  const res = await chrome.tabs.sendMessage(tab.id, { type: 'ythc:start', options });
  return { ...res, tabId: tab.id };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only the extension's own popup may start jobs.
  if (msg?.type !== 'ythc:start-job') return;
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('popup/'))) return;

  start(msg.options)
    .then(sendResponse)
    .catch(err => sendResponse({ ok: false, error: err?.message || String(err) }));

  return true;
});
