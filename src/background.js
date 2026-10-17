// Background service worker: opens the watch history page in a YouTube
// tab and hands the job to the content script running there.

import { HISTORY_URL, validateOptions } from './shared.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const isYouTube = url => typeof url === 'string' && url.startsWith('https://www.youtube.com/');
const isHistory = url => typeof url === 'string' && url.startsWith(HISTORY_URL);

// Prefer the active tab if it's YouTube, then any YouTube tab already on
// history, then any YouTube tab, otherwise open a new one. A non-YouTube
// tab the user is looking at is never navigated away.
async function getHistoryTab() {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const ytTabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });

  let tab =
    (isYouTube(active?.url) && active) ||
    ytTabs.find(t => isHistory(t.url)) ||
    ytTabs[0];

  if (!tab) {
    return chrome.tabs.create({ url: HISTORY_URL, active: true });
  }

  if (!isHistory(tab.url)) {
    tab = await chrome.tabs.update(tab.id, { url: HISTORY_URL, active: true });
  } else if (!tab.active) {
    await chrome.tabs.update(tab.id, { active: true });
  }

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

    // Tabs opened before the extension was installed don't have the
    // content script yet.
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
  const error = validateOptions(options);
  if (error) return { ok: false, error };

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
