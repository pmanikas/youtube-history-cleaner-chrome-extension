import {
  CATEGORIES,
  DATE_PRESETS,
  MAX_FIND_LIMIT,
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

// Set once the user changes anything, so a freshly opened popup doesn't
// greet them with a list of what's missing.
let touched = false;

// Which input each validation problem is about.
const FIELDS = {
  keyword: 'keyword',
  dateFrom: 'date-from',
  dateTo: 'date-to',
  datePreset: 'date-preset',
  findLimit: 'find-limit',
  speed: 'speed',
};

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  // The tabs control the setup panel. With the confirmation or the progress
  // view up there is nothing for them to switch, so they go with it.
  $('modes').hidden = name !== 'setup';
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

  // Both groups are a single tab stop: the chosen item is the one Tab
  // reaches, and the arrow keys move within the group from there.
  for (const button of $('modes').querySelectorAll('button')) {
    const selected = button.dataset.mode === ui.mode;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected) $('setup').setAttribute('aria-labelledby', button.id);
  }
  for (const button of $('categories').querySelectorAll('button')) {
    const checked = button.dataset.category === ui.category;
    button.setAttribute('aria-checked', String(checked));
    button.tabIndex = checked ? 0 : -1;
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
  // aria-disabled, not disabled: a disabled radio drops out of the tab order,
  // so the note saying how to enable it — which is also its description —
  // would never be reached from the keyboard. Choosing it bounces back
  // instead, in the change handler below.
  scopeAll.setAttribute('aria-disabled', String(!allowEverything));
  $('scope-all-label').classList.toggle('disabled', !allowEverything);
  // "All" is a tab name, not a noun, so it can't be dropped into the
  // sentence the way "Shorts" or "Music" can.
  const where = category.label === 'All' ? 'your history' : category.label;
  $('scope-all-title').textContent =
    $('date-preset').value === 'any'
      ? `Everything in ${where}`
      : `Everything in ${where}, in this date range`;
  $('scope-all-note').textContent = allowEverything
    ? 'No keyword needed.'
    : 'Add a keyword or pick a date range to enable this.';

  scopeAll.checked = ui.scope === 'all';
  $('scope-keyword').checked = ui.scope === 'keyword';

  $('scope-section').hidden = finding;
  $('keyword-section').hidden = !finding && ui.scope !== 'keyword';
  $('keyword-label').textContent = finding ? 'Keyword (optional if you pick dates)' : 'Keyword';
  $('find-section').hidden = !finding;
  $('speed-section').hidden = finding;

  // Find is read-only, so it gets the safe accent colour. Removing keeps
  // the soft destructive style here and the solid red for the confirm.
  $('start').textContent = finding ? 'Find' : 'Clear history';
  $('start').classList.toggle('primary', finding);
  $('start').classList.toggle('destructive', !finding);
  $('done').textContent = finding ? 'New search' : 'New cleanup';

  // The button stays clickable. A disabled button with a title tooltip
  // gave no visible reason and was skipped by screen readers, so an
  // incomplete form showed a dead button and nothing else. Instead the
  // reason is spelled out once the user has touched the form, and
  // clicking anyway turns it into an error and focuses the field.
  const problem = validateOptions(readOptions());
  $('requirement').textContent = problem && touched ? problem.message : '';
  $('requirement').hidden = !(problem && touched);
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

  // "every Short watched in the last 7 days whose title contains “x”
  //  from your YouTube watch history (Shorts tab)."
  let text = `This will remove ${what}`;

  const dates = describeDateRange(options);
  if (dates) text += ` ${dates}`;

  if (options.useKeyword) {
    text += ` whose title${options.matchChannel ? ' or channel' : ''} contains “${options.keyword}”`;
  }

  text += ' from your YouTube watch history';

  return `${text}${category.label === 'All' ? '' : ` (${category.label} tab)`}.`;
}

// Shows why the action can't run and puts the cursor where the fix is.
function showProblem(problem) {
  $('requirement').hidden = true;
  showError(problem.message);

  const field = FIELDS[problem.field];
  if (field) $(field).focus();
}

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = false;
}

// ------------------------------------------------------------
// Talking to the YouTube tab
// ------------------------------------------------------------

let activeTabId = null;

// The last progress state the running view drew, so the confirmation can
// quote the number of highlighted matches.
let lastState = null;

// Which view Cancel returns to, and whether confirming means "remove the
// highlighted matches" rather than "start a new cleanup".
let confirmReturn = 'setup';
let confirmRemovesMatches = false;

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
  if (!job) return null;

  try {
    return await chrome.tabs.sendMessage(job.tabId, { type });
  } catch {
    // Tab is gone.
    return null;
  }
}

// How often the live region may repeat itself while the numbers climb.
const PROGRESS_INTERVAL = 5000;

let lastPhase = '';
let lastSpokenAt = 0;

function resetAnnouncements() {
  lastPhase = '';
  lastSpokenAt = 0;
  $('run-status').textContent = '';
}

// Joins what there is to say into one sentence, whatever each part's own
// punctuation is ("Cleaning…", "Done.").
const sentence = parts =>
  `${parts.filter(Boolean).map(part => String(part).replace(/[.…\s]+$/, '')).join('. ')}.`;

// The message and the counters change once per removal, which is far faster
// than a screen reader can read. So the live region speaks the moment the
// job changes phase — found a match, stopped, finished — and otherwise only
// every few seconds. While the job runs it reads the phase and the counts
// rather than the message, which is the part that changes with every item.
function announce(state, title) {
  // Waiting at a match, or finished: every new message is a thing the user
  // just did or asked for, so it is always worth saying. Mid-run it is the
  // phase that matters, not the per-item message.
  const settled = !state.running || state.waiting;
  const phase = `${title}|${state.running}|${state.waiting}|${settled ? state.message : ''}`;
  const now = Date.now();

  if (phase === lastPhase && now - lastSpokenAt < PROGRESS_INTERVAL) return;

  lastPhase = phase;
  lastSpokenAt = now;

  const counts = state.mode === 'find'
    ? `${state.found} found, ${state.scanned} checked`
    : `${state.deleted} removed`;

  // The content script's closing message ("Done. Removed 12 items.") already
  // carries the totals, so it is left to say it on its own.
  const parts = !state.running && state.message
    ? [state.message]
    : state.waiting
      ? [state.message, counts]
      : [title, counts];

  $('run-status').textContent = sentence(parts);
}

function renderProgress(state) {
  show('running');
  lastState = state;

  const finding = state.mode === 'find';

  const title = state.running
    ? finding
      ? state.waiting
        ? 'Match found'
        : 'Searching…'
      : 'Cleaning…'
    : state.error
      ? 'Stopped'
      : 'Finished';

  $('run-title').textContent = title;
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

  // The whole point of Find: act on exactly what you just looked at.
  $('remove-found').hidden = !state.canRemoveMatches;
  $('remove-found').textContent = `Remove these ${state.matchCount ?? 0}`;

  $('stop').hidden = !state.running;
  $('done').hidden = state.running;

  announce(state, title);
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

// A tablist and a radiogroup are each one stop in the tab order; the arrow
// keys move inside them, taking the selection with the focus. `axis` is the
// pair of keys the group answers to: the tabs run across, the chips wrap
// over two rows, so they take the vertical keys as well.
function arrowKeys(container, axis, choose) {
  const horizontal = ['ArrowLeft', 'ArrowRight'];
  const vertical = ['ArrowUp', 'ArrowDown'];
  const keys = axis === 'both' ? [...horizontal, ...vertical] : horizontal;

  container.addEventListener('keydown', event => {
    const buttons = [...container.querySelectorAll('button')];
    const from = buttons.indexOf(document.activeElement);
    if (from < 0) return;

    let to;
    if (keys.includes(event.key)) {
      const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
      to = (from + (back ? -1 : 1) + buttons.length) % buttons.length;
    } else if (event.key === 'Home') {
      to = 0;
    } else if (event.key === 'End') {
      to = buttons.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    touched = true;
    choose(buttons[to]);
    render();
    buttons[to].focus();
  });
}

const chooseMode = button => { ui.mode = button.dataset.mode; };
const chooseCategory = button => { ui.category = button.dataset.category; };

$('modes').addEventListener('click', event => {
  const button = event.target.closest('button[data-mode]');
  if (!button) return;
  chooseMode(button);
  render();
});
arrowKeys($('modes'), 'horizontal', chooseMode);

$('categories').addEventListener('click', event => {
  const button = event.target.closest('button[data-category]');
  if (!button) return;
  chooseCategory(button);
  render();
});
arrowKeys($('categories'), 'both', chooseCategory);

for (const radio of document.querySelectorAll('input[name="scope"]')) {
  radio.addEventListener('change', () => {
    // Reachable but not choosable: re-rendering puts the choice back where
    // it was, and the radio's description says what would enable it.
    if (radio.getAttribute('aria-disabled') === 'true') {
      render();
      return;
    }

    ui.scope = radio.value;
    render();
    if (ui.scope === 'keyword') $('keyword').focus();
  });
}

// Anything the user changes counts as touching the form. Captured so the
// flag is set before the handler that re-renders runs.
$('setup').addEventListener('input', () => { touched = true; }, true);
$('setup').addEventListener('click', () => { touched = true; }, true);

for (const id of ['keyword', 'date-from', 'date-to']) {
  $(id).addEventListener('input', render);
}
for (const id of ['match-channel', 'speed', 'date-preset', 'find-step', 'find-first']) {
  $(id).addEventListener('change', render);
}
// Using the number means choosing the option it belongs to. On use, not on
// focus: the field is its own tab stop now, and tabbing past it on the way
// to Find shouldn't change what was chosen.
for (const event of ['input', 'mousedown']) {
  $('find-limit').addEventListener(event, () => {
    $('find-first').checked = true;
    render();
  });
}

$('keyword').addEventListener('keydown', event => {
  if (event.key === 'Enter') $('start').click();
});

async function startJob(options) {
  resetAnnouncements();
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
  const problem = validateOptions(options);

  if (problem) {
    showProblem(problem);
    return;
  }

  if (options.mode === 'find') {
    startJob(options);
    return;
  }

  confirmReturn = 'setup';
  confirmRemovesMatches = false;
  $('confirm-text').textContent = describe(options);
  $('preview').hidden = !previewOptions(options);
  show('confirm');
  $('cancel').focus();
});

// Removing exactly the items a find highlighted, with the count in the
// confirmation because this is the one path that knows it.
$('remove-found').addEventListener('click', () => {
  const count = lastState?.matchCount ?? 0;

  confirmReturn = 'running';
  confirmRemovesMatches = true;
  $('confirm-text').textContent =
    `This will remove the ${count} highlighted item${count === 1 ? '' : 's'} from your YouTube watch history.`;
  $('preview').hidden = true;
  show('confirm');
  $('cancel').focus();
});

// The same options run as a search, so the count is known before anything
// is removed. Null when a search couldn't run on them (no keyword, no dates).
function previewOptions(options) {
  const next = {
    ...options,
    mode: 'find',
    findStyle: 'first',
    findLimit: MAX_FIND_LIMIT,
  };

  return validateOptions(next) ? null : next;
}

$('preview').addEventListener('click', () => {
  const next = previewOptions(readOptions());

  if (!next) {
    show('setup');
    return;
  }

  // Keep the form in step with what is about to run, so "New search"
  // starts from the same place.
  ui.mode = 'find';
  $('find-first').checked = true;
  $('find-limit').value = String(next.findLimit);
  render();

  startJob(next);
});

$('cancel').addEventListener('click', () => {
  confirmRemovesMatches = false;
  show(confirmReturn);
});

$('confirm-go').addEventListener('click', async () => {
  if (confirmRemovesMatches) {
    confirmRemovesMatches = false;
    show('running');

    const res = await sendToTab('ythc:remove-matches');

    if (!res?.ok) {
      const problem = res?.error || 'Could not remove the highlighted items.';
      $('run-message').textContent = problem;
      $('run-message').className = 'error';
      // The only failure that never passes through renderProgress, so the
      // live region is written by hand or this one goes unsaid.
      $('run-status').textContent = sentence([problem]);
    }

    return;
  }

  const options = readOptions();
  const problem = validateOptions(options);

  if (problem) {
    show('setup');
    showProblem(problem);
    return;
  }

  startJob(options);
});

$('stop').addEventListener('click', () => sendToTab('ythc:stop'));
$('next').addEventListener('click', () => sendToTab('ythc:next'));
$('prev').addEventListener('click', () => sendToTab('ythc:prev'));

$('done').addEventListener('click', () => {
  activeTabId = null;
  lastState = null;
  resetAnnouncements();
  confirmReturn = 'setup';
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
