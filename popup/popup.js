import {
  CATEGORIES,
  DATE_PRESETS,
  describeDateRange,
  isoDate,
  resolveDateRange,
  validateOptions,
} from '../src/shared.js';

const $ = id => document.getElementById(id);

const views = {
  setup: $('setup'),
  confirm: $('confirm'),
  running: $('running'),
};

const ui = {
  mode: 'delete',
  category: 'shorts',
  scope: 'all',
};

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

for (const [value, preset] of Object.entries(DATE_PRESETS)) {
  $('date-preset').append(new Option(preset.label, value));
}
$('date-from').max = $('date-to').max = isoDate(new Date());

function readOptions() {
  const category = CATEGORIES[ui.category];
  const datePreset = $('date-preset').value;
  const { from, to } = resolveDateRange(datePreset, $('date-from').value, $('date-to').value);
  const keyword = $('keyword').value.trim();

  // In delete mode "All" and "Videos" force the keyword choice unless a
  // date range is set.
  const allowEverything = category.allowAll || !!(from || to);
  const useKeyword =
    ui.mode === 'find' ? !!keyword : ui.scope === 'keyword' || !allowEverything;

  return {
    mode: ui.mode,
    category: ui.category,
    useKeyword,
    keyword: useKeyword ? keyword : '',
    matchChannel: $('match-channel').checked,
    speed: $('speed').value,
    datePreset,
    dateFrom: from,
    dateTo: to,
    findStyle: $('find-first').checked ? 'first' : 'step',
    findLimit: Number($('find-limit').value),
  };
}

function render() {
  const category = CATEGORIES[ui.category];
  const finding = ui.mode === 'find';

  for (const button of $('modes').querySelectorAll('button')) {
    button.setAttribute('aria-selected', String(button.dataset.mode === ui.mode));
  }
  for (const button of $('categories').querySelectorAll('button')) {
    button.setAttribute('aria-checked', String(button.dataset.category === ui.category));
  }

  $('mode-hint').textContent = finding
    ? 'Highlights matching items on your history page. Nothing is removed.'
    : 'Removes matching items from your watch history.';
  $('category-heading').textContent = finding ? 'Where to look' : 'What to clear';

  $('custom-range').hidden = $('date-preset').value !== 'custom';

  const { from, to } = resolveDateRange($('date-preset').value, $('date-from').value, $('date-to').value);
  const allowEverything = category.allowAll || !!(from || to);

  if (!allowEverything) ui.scope = 'keyword';

  const scopeAll = $('scope-all');
  scopeAll.disabled = !allowEverything;
  $('scope-all-label').classList.toggle('disabled', !allowEverything);
  $('scope-all-title').textContent =
    `Everything in ${category.label}${$('date-preset').value !== 'any' ? ' in this date range' : ''}`;
  $('scope-all-note').textContent = allowEverything
    ? 'No keyword needed.'
    : `Not allowed. Clearing all ${category.label === 'All' ? 'history' : 'videos'} needs a keyword or a date range.`;

  scopeAll.checked = ui.scope === 'all';
  $('scope-keyword').checked = ui.scope === 'keyword';

  $('scope-section').hidden = finding;
  $('keyword-section').hidden = !finding && ui.scope !== 'keyword';
  $('keyword-label').textContent = finding ? 'Keyword (optional if you pick dates)' : 'Keyword';
  $('find-section').hidden = !finding;
  $('speed-section').hidden = finding;

  $('start').textContent = finding ? 'Find' : 'Clear history';
  $('done').textContent = finding ? 'New search' : 'New cleanup';

  const error = validateOptions(readOptions());
  $('start').disabled = !!error;
  $('start').title = error || '';
  $('error').hidden = true;
}

function describe(options) {
  const category = CATEGORIES[options.category];
  const what = {
    all: 'every item',
    videos: 'every video',
    shorts: 'every Short',
    music: 'every Music item',
    podcasts: 'every Podcast item',
  }[options.category];

  let text = `This will remove ${what} from your YouTube watch history`;

  if (options.useKeyword) {
    text += ` whose title${options.matchChannel ? ' or channel' : ''} contains “${options.keyword}”`;
  }

  const dates = describeDateRange(options);
  if (dates) text += `${options.useKeyword ? ',' : ''} ${dates}`;

  return `${text}${category.label === 'All' ? '' : ` (${category.label} tab)`}.`;
}

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = false;
}

// ------------------------------------------------------------
// Talking to the YouTube tab
// ------------------------------------------------------------

let activeTabId = null;

async function findActiveJob() {
  const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });

  for (const tab of tabs) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'ythc:status' });
      const s = res?.state;
      if (s?.running || (s?.mode === 'find' && s.found > 0 && s.panelOpen)) {
        return { tabId: tab.id, state: s };
      }
    } catch {
      // No content script in this tab.
    }
  }

  return null;
}

async function sendToTab(type) {
  const job = activeTabId !== null ? { tabId: activeTabId } : await findActiveJob();
  if (!job) return;

  try {
    await chrome.tabs.sendMessage(job.tabId, { type });
  } catch {
    // Tab is gone.
  }
}

function renderProgress(state) {
  show('running');

  const finding = state.mode === 'find';

  $('run-title').textContent = state.running
    ? finding
      ? state.waiting
        ? 'Match found'
        : 'Searching…'
      : 'Cleaning…'
    : state.error
      ? 'Stopped'
      : 'Finished';
  $('run-message').textContent = state.message;
  $('run-message').className = state.error ? 'error' : '';
  $('run-deleted').textContent = state.deleted;
  $('run-deleted-box').hidden = finding;
  $('run-found').textContent = state.found;
  $('run-found-box').hidden = !finding;
  $('run-scanned').textContent = state.scanned;
  $('run-scanned-box').hidden = !finding && !state.useKeyword && !state.dateFrom && !state.dateTo;
  $('run-failed').textContent = state.failed;
  $('run-failed-box').hidden = !state.failed;

  const canStep = finding && (state.waiting || (!state.running && state.found > 0));
  $('next').hidden = !canStep;
  $('next').textContent = state.running ? 'Next match' : 'Next';
  $('prev').hidden = !(finding && !state.running && state.found > 1);

  $('stop').hidden = !state.running;
  $('done').hidden = state.running;
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'ythc:progress' || !sender.tab) return;
  if (activeTabId !== null && sender.tab.id !== activeTabId) return;

  activeTabId = sender.tab.id;
  renderProgress(msg.state);
});

// ------------------------------------------------------------
// Events
// ------------------------------------------------------------

$('modes').addEventListener('click', event => {
  const button = event.target.closest('button[data-mode]');
  if (!button) return;
  ui.mode = button.dataset.mode;
  render();
});

$('categories').addEventListener('click', event => {
  const button = event.target.closest('button[data-category]');
  if (!button) return;
  ui.category = button.dataset.category;
  render();
});

for (const radio of document.querySelectorAll('input[name="scope"]')) {
  radio.addEventListener('change', () => {
    ui.scope = radio.value;
    render();
    if (ui.scope === 'keyword') $('keyword').focus();
  });
}

for (const id of ['keyword', 'find-limit', 'date-from', 'date-to']) {
  $(id).addEventListener('input', render);
}
for (const id of ['match-channel', 'speed', 'date-preset', 'find-step', 'find-first']) {
  $(id).addEventListener('change', render);
}
$('find-limit').addEventListener('focus', () => {
  $('find-first').checked = true;
  render();
});

$('keyword').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !$('start').disabled) $('start').click();
});

async function startJob(options) {
  renderProgress({
    mode: options.mode,
    running: true,
    message: 'Opening watch history…',
    deleted: 0,
    found: 0,
    scanned: 0,
    failed: 0,
    useKeyword: options.useKeyword,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
  });

  try {
    const res = await chrome.runtime.sendMessage({ type: 'ythc:start-job', options });

    if (!res?.ok) {
      show('setup');
      showError(res?.error || 'Could not start.');
      return;
    }

    activeTabId = res.tabId;
  } catch (err) {
    show('setup');
    showError(err?.message || String(err));
  }
}

$('start').addEventListener('click', () => {
  const options = readOptions();
  const error = validateOptions(options);

  if (error) {
    showError(error);
    return;
  }

  if (options.mode === 'find') {
    startJob(options);
    return;
  }

  $('confirm-text').textContent = describe(options);
  show('confirm');
  $('cancel').focus();
});

$('cancel').addEventListener('click', () => show('setup'));

$('confirm-go').addEventListener('click', () => {
  const options = readOptions();
  const error = validateOptions(options);

  if (error) {
    show('setup');
    showError(error);
    return;
  }

  startJob(options);
});

$('stop').addEventListener('click', () => sendToTab('ythc:stop'));
$('next').addEventListener('click', () => sendToTab('ythc:next'));
$('prev').addEventListener('click', () => sendToTab('ythc:prev'));

$('done').addEventListener('click', () => {
  activeTabId = null;
  show('setup');
  render();
});

// ------------------------------------------------------------
// Start-up
// ------------------------------------------------------------

render();

findActiveJob().then(job => {
  if (!job) return;
  activeTabId = job.tabId;
  ui.mode = job.state.mode;
  render();
  renderProgress(job.state);
});
