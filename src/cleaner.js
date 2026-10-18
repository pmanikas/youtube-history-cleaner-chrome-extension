// ============================================================
// Watch History Cleaner for YouTube - content script
//
// Runs only on https://www.youtube.com/*. It does nothing until the
// extension popup starts a job, and it only ever clicks YouTube's own
// "Remove from watch history" controls. Nothing is sent anywhere.
//
// Based on the original working Shorts cleaner console script.
// ============================================================

(() => {
  'use strict';

  if (window.__YTHC_LOADED__) return;
  window.__YTHC_LOADED__ = true;

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  // >>> generated from src/shared.js by tools/sync-shared.mjs - do not edit >>>
  const MIN_KEYWORD_LENGTH = 2;
  const MAX_FIND_LIMIT = 500;

  const CATEGORIES = {
    all: { label: 'All', chip: 'All', allowAll: false, kind: 'any' },
    videos: { label: 'Videos', chip: 'Videos', allowAll: false, kind: 'video' },
    shorts: { label: 'Shorts', chip: 'Shorts', allowAll: true, kind: 'short' },
    music: { label: 'Music', chip: 'Music', allowAll: true, kind: 'any' },
    podcasts: { label: 'Podcasts', chip: 'Podcasts', allowAll: true, kind: 'any' },
  };

  const SPEEDS = { fast: 120, normal: 250, careful: 500 };
  // <<< generated <<<

  const CONFIG = {
    // YouTube UI needs a tiny amount of time to create the popup menu.
    MENU_OPEN_TIMEOUT: 1500,

    // Delay after successfully clicking "Remove from watch history".
    // Set per job from the popup's speed option.
    DELETE_DELAY: 250,

    // Delay after horizontal "Next" movement inside a Shorts shelf.
    ROW_ADVANCE_DELAY: 250,

    // Delay after vertical scrolling / loading more history.
    SCROLL_DELAY: 900,

    // How many scrolls without any new history before considering
    // history exhausted.
    MAX_IDLE_SCROLLS: 6,

    // How long to wait for the history page to render.
    PAGE_READY_TIMEOUT: 15000,

    // How long to wait for a filter chip to become selected, and for
    // the filtered list to settle afterwards.
    CHIP_SELECT_TIMEOUT: 5000,
    CHIP_SETTLE_DELAY: 2000,

    // Switch-away-and-back attempts for YouTube's hidden-chip bug.
    CHIP_RETRIES: 4,

    // A card is skipped after this many failed delete attempts.
    MAX_ATTEMPTS_PER_CARD: 2,

    // Remove stale YouTube cards from the DOM *after* the real delete
    // click, and trim non-matching cards during keyword scans so the
    // page stays fast. This only affects the page view, never history.
    CLEAN_DOM_AFTER_DELETE: true,
    PRUNE_SKIPPED: true,
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const visible = el => {
    if (!el?.isConnected) return false;

    const style = getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number(style.opacity) === 0
    ) {
      return false;
    }

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const normalize = text =>
    (text || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase();

  // ------------------------------------------------------------
  // Job state
  // ------------------------------------------------------------

  const state = {
    mode: 'delete',
    running: false,
    finished: false,
    stopRequested: false,
    waiting: false,
    category: null,
    keyword: '',
    useKeyword: false,
    dateFrom: '',
    dateTo: '',
    deleted: 0,
    found: 0,
    failed: 0,
    scanned: 0,
    // Non-matching cards trimmed from the page view (not from history).
    hidden: 0,
    message: 'Idle',
    error: null,
  };

  const publicState = () => ({
    mode: state.mode,
    running: state.running,
    finished: state.finished,
    waiting: state.waiting,
    category: state.category,
    keyword: state.keyword,
    useKeyword: state.useKeyword,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    deleted: state.deleted,
    found: state.found,
    failed: state.failed,
    scanned: state.scanned,
    hidden: state.hidden,
    message: state.message,
    error: state.error,
    panelOpen: panel.isOpen(),
    matchCount: matches.length,
    canRemoveMatches: !removeMatchesProblem(),
  });

  function report(message, { error = false } = {}) {
    if (message) state.message = message;
    if (error) state.error = message;
    panel.update();

    try {
      chrome.runtime
        .sendMessage({ type: 'ythc:progress', state: publicState() })
        .catch(() => {});
    } catch {
      // Extension was reloaded; nothing to report to.
    }
  }

  const shouldStop = () =>
    state.stopRequested || window.__YT_SHORTS_CLEANER_STOP__ === true;

  // ------------------------------------------------------------
  // Cards
  // ------------------------------------------------------------

  const CARD_SELECTOR = [
    'ytd-video-renderer',
    'ytd-reel-item-renderer',
    'ytm-shorts-lockup-view-model',
    'ytm-shorts-lockup-view-model-v2',
    'yt-lockup-view-model',
  ].join(',');

  const SHELF_SELECTOR = [
    'ytd-reel-shelf-renderer',
    'grid-shelf-view-model',
    'ytd-rich-shelf-renderer[is-shorts]',
  ].join(',');

  const SHORT_LINK = 'a[href^="/shorts/"], a[href*="youtube.com/shorts/"]';
  const WATCH_LINK = 'a[href^="/watch"], a[href*="youtube.com/watch"]';

  const isShortCard = card => !!card?.querySelector(SHORT_LINK);
  const isHistoryCard = card =>
    !!card?.querySelector(`${SHORT_LINK}, ${WATCH_LINK}`);

  function cardId(card) {
    const href =
      card?.querySelector(`${SHORT_LINK}, ${WATCH_LINK}`)?.getAttribute('href') ||
      '';

    return (
      href.match(/\/shorts\/([^?&#/]+)/)?.[1] ||
      href.match(/[?&]v=([^&#]+)/)?.[1] ||
      '?'
    );
  }

  const TITLE_SELECTORS = [
    '#video-title',
    'h3',
    '.yt-lockup-metadata-view-model__title',
    '.yt-lockup-metadata-view-model-wiz__title',
    '.shortsLockupViewModelHostMetadataTitle',
    '.shortsLockupViewModelHostOutsideMetadataTitle',
  ];

  const CHANNEL_SELECTORS = [
    'ytd-channel-name',
    '#channel-name',
    'a[href^="/@"]',
    'a[href^="/channel/"]',
    '.yt-content-metadata-view-model__metadata-text',
    '.yt-content-metadata-view-model-wiz__metadata-text',
  ];

  function cardTitle(card) {
    const parts = new Set();

    for (const el of card.querySelectorAll(TITLE_SELECTORS.join(','))) {
      const text = el.getAttribute('title') || el.textContent;
      if (text?.trim()) parts.add(text.trim());
    }

    for (const a of card.querySelectorAll(`${SHORT_LINK}, ${WATCH_LINK}`)) {
      const text = a.getAttribute('title');
      if (text?.trim()) parts.add(text.trim());
    }

    return [...parts].join(' | ');
  }

  function cardChannel(card) {
    const parts = new Set();

    for (const el of card.querySelectorAll(CHANNEL_SELECTORS.join(','))) {
      const text = el.textContent;
      if (text?.trim()) parts.add(text.trim());
    }

    return [...parts].join(' | ');
  }

  // Only the outermost matching element is a card (YouTube nests
  // lockups inside some renderers).
  function allCards(root = document) {
    return [...root.querySelectorAll(CARD_SELECTOR)].filter(card => {
      const outer = card.parentElement?.closest(CARD_SELECTOR);
      return !(outer && root.contains(outer)) && isHistoryCard(card);
    });
  }

  // ------------------------------------------------------------
  // Dates (from the history page's day headings)
  // ------------------------------------------------------------

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const monthIndex = word => {
    const key = word.slice(0, 3);
    return word.length >= 3 ? MONTHS.indexOf(key) : -1;
  };

  // "Today", "Yesterday", "Monday", "Oct 3", "October 3, 2024",
  // "3 Oct 2024" -> 'YYYY-MM-DD' (local), or null if unknown.
  function parseDayHeading(text, now = new Date()) {
    const t = normalize(text).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return null;

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const shift = days =>
      iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days));

    if (t === 'today') return iso(today);
    if (t === 'yesterday') return shift(1);

    const weekday = WEEKDAYS.indexOf(t);
    if (weekday >= 0) {
      let diff = (today.getDay() - weekday + 7) % 7;
      if (diff < 2) diff += 7;
      return shift(diff);
    }

    let month = -1;
    let day = NaN;
    let year = NaN;
    let m;

    if ((m = t.match(/^(?:[a-z]+ )?([a-z]+) (\d{1,2})(?: (\d{4}))?$/))) {
      // "oct 3", "oct 3 2024", "mon oct 3"
      month = monthIndex(m[1]);
      day = Number(m[2]);
      year = m[3] ? Number(m[3]) : NaN;
    } else if ((m = t.match(/^(?:[a-z]+ )?(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/))) {
      // "3 oct", "3 oct 2024"
      month = monthIndex(m[2]);
      day = Number(m[1]);
      year = m[3] ? Number(m[3]) : NaN;
    }

    if (month < 0 || !(day >= 1 && day <= 31)) return null;

    if (Number.isNaN(year)) {
      // No year shown means this year, unless that would be in the future.
      year = today.getFullYear();
      if (new Date(year, month, day) > today) year--;
    }

    const date = new Date(year, month, day);
    if (date.getMonth() !== month) return null;
    return iso(date);
  }

  const SECTION_SELECTOR = 'ytd-item-section-renderer';
  const HEADING_SELECTORS = [
    'ytd-item-section-header-renderer #title',
    '#header #title',
    '#header h2',
    'h2',
  ];

  function cardDate(card) {
    const section = card.closest(SECTION_SELECTOR);
    if (!section) return null;

    if (section.dataset.ythcDate !== undefined) return section.dataset.ythcDate || null;

    let date = null;
    for (const selector of HEADING_SELECTORS) {
      const heading = section.querySelector(selector);
      if (heading && !heading.closest(CARD_SELECTOR)) {
        date = parseDayHeading(heading.textContent);
        if (date) break;
      }
    }

    // Cache only successful parses; headings can render late.
    if (date) section.dataset.ythcDate = date;
    return date;
  }

  const hasDateFilter = () => !!(job?.dateFrom || job?.dateTo);

  function dateMatches(card) {
    if (!hasDateFilter()) return true;

    const date = cardDate(card);
    // Unknown date: never act on a guess.
    if (!date) return false;
    if (job.dateFrom && date < job.dateFrom) return false;
    if (job.dateTo && date > job.dateTo) return false;
    return true;
  }

  // History is newest first, so once loaded items are older than the
  // start of the range there is nothing more to find.
  function reachedOlderThanRange() {
    if (!job?.dateFrom) return false;
    const cards = allCards();
    for (let i = cards.length - 1; i >= Math.max(0, cards.length - 5); i--) {
      const date = cardDate(cards[i]);
      if (date && date < job.dateFrom) return true;
    }
    return false;
  }

  let job = null;

  // Entries already removed in this job, so a card YouTube re-renders
  // isn't removed (or counted) twice.
  //
  // Keyed by entry, not by video: watching the same video on two days is
  // two history entries and both should go. Keying on the video id alone
  // removed only the first and silently skipped the rest.
  const removedIds = new Set();

  // The day heading above a card, as written. Stable across re-renders,
  // unlike the section element itself, so it can tell two entries for the
  // same video apart.
  function sectionKey(card) {
    const section = card.closest(SECTION_SELECTOR);
    if (!section) return '';
    if (section.dataset.ythcKey) return section.dataset.ythcKey;

    for (const selector of HEADING_SELECTORS) {
      const heading = section.querySelector(selector);
      if (heading && !heading.closest(CARD_SELECTOR)) {
        const text = normalize(heading.textContent);
        if (text) {
          section.dataset.ythcKey = text;
          return text;
        }
      }
    }

    return '';
  }

  // Two watches of the same video under the same day heading still
  // collapse to one entry. Nothing the page shows tells them apart.
  const entryKey = card => `${cardId(card)}|${sectionKey(card)}`;

  function matchesJob(card) {
    if (job.kind === 'short' && !isShortCard(card)) return false;
    if (job.kind === 'video' && isShortCard(card)) return false;
    if (!dateMatches(card)) return false;

    if (job.keyword) {
      let text = cardTitle(card);
      if (job.matchChannel) text += ' | ' + cardChannel(card);

      // Unknown title: never delete on a guess.
      if (!text.trim()) return false;
      if (!normalize(text).includes(job.keyword)) return false;
    }

    return true;
  }

  function markSeen(card) {
    if (card.dataset.ythcSeen !== '1') {
      card.dataset.ythcSeen = '1';
      state.scanned++;
    }
  }

  // Cards that should be deleted now.
  function eligibleCards(root = document) {
    const result = [];

    for (const card of allCards(root)) {
      if (card.dataset.ythcDone === '1') continue;
      if (removedIds.has(entryKey(card))) {
        card.dataset.ythcDone = '1';
        continue;
      }
      if (Number(card.dataset.ythcFailed || 0) >= CONFIG.MAX_ATTEMPTS_PER_CARD) {
        continue;
      }

      markSeen(card);

      if (matchesJob(card)) {
        result.push(card);
      } else if (
        CONFIG.PRUNE_SKIPPED &&
        job.mode === 'delete' &&
        !card.closest(SHELF_SELECTOR) &&
        card.getBoundingClientRect().bottom < 0
      ) {
        // Already scrolled past and not a match: trim it from the
        // page view so long keyword scans stay fast. Counted because
        // items disappearing off a history page looks exactly like
        // deletion, and it isn't one.
        card.remove();
        state.hidden++;
      }
    }

    return result;
  }

  const unseenCount = () =>
    allCards().filter(card => card.dataset.ythcSeen !== '1').length;

  // ------------------------------------------------------------
  // Deleting through YouTube's own menu
  // ------------------------------------------------------------

  function getDirectRemoveButton(card) {
    // The regular history list has an "X" button with this label.
    return [...card.querySelectorAll('button[aria-label]')].find(
      button =>
        !button.disabled &&
        normalize(button.getAttribute('aria-label')).includes(
          'remove from watch history'
        )
    );
  }

  function getMenuButton(card) {
    const selectors = [
      'button[aria-label="Action menu"]',
      'button[aria-label="More actions"]',
      'button[aria-label*="Action menu" i]',
      'button[aria-label*="More actions" i]',
      'button[title="More actions"]',
      'yt-icon-button#button > button',
      'button.yt-spec-button-shape-next--icon-button',
    ];

    for (const selector of selectors) {
      const candidates = [...card.querySelectorAll(selector)];

      for (const button of candidates) {
        if (!button.disabled) return button;
      }
    }

    return null;
  }

  function findRemoveMenuItem() {
    const selectors = [
      'ytd-menu-service-item-renderer',
      'tp-yt-paper-item',
      '[role="menuitem"]',
      'yt-list-item-view-model',
    ];

    const items = [...document.querySelectorAll(selectors.join(','))];

    return items.find(item => {
      if (!visible(item)) return false;
      return normalize(item.textContent).includes('remove from watch history');
    });
  }

  async function waitForRemoveMenuItem(timeout = CONFIG.MENU_OPEN_TIMEOUT) {
    const started = performance.now();

    while (performance.now() - started < timeout) {
      const item = findRemoveMenuItem();
      if (item) return item;
      await sleep(20);
    }

    return null;
  }

  function closeOpenMenu() {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
      })
    );
  }

  function clickMenuItem(item) {
    const clickable = item.matches('button, [role="menuitem"]')
      ? item
      : item.querySelector('button, [role="menuitem"]') || item;

    clickable.click();
  }

  function markFailed(card, id, reason) {
    card.dataset.ythcFailed = String(Number(card.dataset.ythcFailed || 0) + 1);

    if (Number(card.dataset.ythcFailed) >= CONFIG.MAX_ATTEMPTS_PER_CARD) {
      state.failed++;
    }

    console.warn(`[History Cleaner] ${reason}: ${id}`);
  }

  async function deleteCard(card) {
    // Find-only jobs never remove anything.
    if (job.mode !== 'delete') return false;
    if (shouldStop() || !card?.isConnected || !matchesJob(card)) return false;

    const id = cardId(card);
    // Read before the click: the card leaves the DOM right after.
    const key = entryKey(card);
    const direct = getDirectRemoveButton(card);

    if (direct) {
      direct.click();
    } else {
      const menuButton = getMenuButton(card);

      if (!menuButton) {
        markFailed(card, id, 'No action menu found');
        return false;
      }

      // Open YouTube's REAL action menu.
      menuButton.click();

      const removeItem = await waitForRemoveMenuItem();

      if (!removeItem) {
        closeOpenMenu();
        markFailed(card, id, '"Remove from watch history" not found');
        return false;
      }

      // YouTube itself receives the deletion action.
      clickMenuItem(removeItem);
    }

    card.dataset.ythcDone = '1';
    if (id !== '?') removedIds.add(key);
    state.deleted++;
    report(`Removing… (${state.deleted} removed)`);

    console.log(
      `%c[History Cleaner] Removed ${state.deleted}: ${id}`,
      'color:#2eaf5d;font-weight:bold'
    );

    await sleep(CONFIG.DELETE_DELAY);

    // YouTube often leaves deleted history cards rendered.
    // Only clean it AFTER the actual YouTube deletion click.
    if (CONFIG.CLEAN_DOM_AFTER_DELETE && card.isConnected) {
      card.remove();
    }

    return true;
  }

  // ------------------------------------------------------------
  // Rows, shelves and scrolling (from the original Shorts script)
  // ------------------------------------------------------------

  function firstShelfWithMatches() {
    const shelves = [...document.querySelectorAll(SHELF_SELECTOR)];
    return shelves.find(shelf => eligibleCards(shelf).length > 0) || null;
  }

  const shelfSignature = shelf =>
    [...shelf.querySelectorAll(`${SHORT_LINK}, ${WATCH_LINK}`)]
      .map(a => a.href)
      .join('|');

  async function processShelf(shelf) {
    let previousSignature = '';
    let stagnantPasses = 0;

    while (shelf?.isConnected && !shouldStop()) {
      if (!filterStillActive()) return;

      const cards = eligibleCards(shelf);

      if (cards.length) {
        stagnantPasses = 0;

        for (const card of cards) {
          if (shouldStop()) return;
          await deleteCard(card);
        }

        continue;
      }

      // Horizontal carousels: advance the shelf BEFORE doing any
      // vertical page scrolling.
      const next = [
        ...shelf.querySelectorAll('button[aria-label="Next"], #right-arrow button'),
      ].find(button => !button.disabled && visible(button));

      if (!next) break;

      const before = shelfSignature(shelf);
      next.click();
      await sleep(CONFIG.ROW_ADVANCE_DELAY);
      const after = shelfSignature(shelf);

      if (!after || after === before || after === previousSignature) {
        stagnantPasses++;
        if (stagnantPasses >= 2) break;
      } else {
        stagnantPasses = 0;
      }

      previousSignature = after;
    }

    // Shelf is now stale/empty.
    if (
      CONFIG.CLEAN_DOM_AFTER_DELETE &&
      shelf?.isConnected &&
      allCards(shelf).every(card => card.dataset.ythcDone === '1')
    ) {
      shelf.remove();
    }
  }

  async function processLooseCards() {
    const cards = eligibleCards().filter(card => !card.closest(SHELF_SELECTOR));

    for (const card of cards) {
      if (shouldStop() || !filterStillActive()) break;
      await deleteCard(card);
    }

    return cards.length > 0;
  }

  async function loadNextRows() {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'instant',
    });

    await sleep(CONFIG.SCROLL_DELAY);

    // YouTube shows a spinner while it fetches the next page.
    for (let i = 0; i < 10 && unseenCount() === 0; i++) {
      const spinner = document.querySelector(
        'ytd-continuation-item-renderer tp-yt-paper-spinner, ytd-continuation-item-renderer #spinner'
      );
      if (!spinner || !visible(spinner)) break;
      await sleep(500);
    }

    return unseenCount() > 0;
  }

  // ------------------------------------------------------------
  // History page and filter chips
  // ------------------------------------------------------------

  const onHistoryPage = () => location.pathname === '/feed/history';

  function findChips() {
    const raw = [
      ...document.querySelectorAll(
        [
          'ytd-browse[page-subtype="history"] yt-chip-cloud-chip-renderer',
          'ytd-browse[page-subtype="history"] chip-view-model',
          'ytd-browse[page-subtype="history"] ytd-feed-filter-chip-bar-renderer [role="tab"]',
          'ytd-browse[page-subtype="history"] chip-bar-view-model [role="tab"]',
        ].join(',')
      ),
    ];

    // Keep the outermost element of each chip.
    const chips = raw.filter(
      el => !raw.some(other => other !== el && other.contains(el))
    );

    return chips.map(el => ({ el, label: normalize(el.textContent) }));
  }

  // Chip labels are compared normalized, so CATEGORIES can hold the
  // readable "Shorts" and still match the page's own text.
  const findChip = label => {
    const wanted = normalize(label);
    return findChips().find(chip => chip.label === wanted)?.el || null;
  };

  const SELECTED_CLASS =
    /(^|\s)(iron-selected|ytChipShapeActive|selected|chip-selected)(\s|$)/;

  function isChipSelected(el) {
    if (!el?.isConnected) return false;

    const nodes = [el, ...el.querySelectorAll('*')];

    return nodes.some(
      node =>
        node.hasAttribute('selected') ||
        node.getAttribute('aria-selected') === 'true' ||
        node.getAttribute('aria-pressed') === 'true' ||
        SELECTED_CLASS.test(node.getAttribute('class') || '')
    );
  }

  function clickChip(el) {
    const clickable =
      el.querySelector('button, [role="tab"], a, #chip-shape-container') || el;
    clickable.click();
  }

  async function waitFor(predicate, timeout, interval = 100) {
    const started = performance.now();

    while (performance.now() - started < timeout) {
      if (predicate()) return true;
      await sleep(interval);
    }

    return predicate();
  }

  async function waitForHistoryPage() {
    return waitFor(
      () =>
        onHistoryPage() &&
        (findChips().length > 0 ||
          allCards().length > 0 ||
          !!document.querySelector('ytd-browse[page-subtype="history"] ytd-section-list-renderer')),
      CONFIG.PAGE_READY_TIMEOUT,
      250
    );
  }

  // Selects the history filter chip. YouTube sometimes doesn't render
  // a chip until you visit another one, so when the chip is missing we
  // switch to a different chip and look again.
  async function selectChip(label) {
    for (let attempt = 0; attempt <= CONFIG.CHIP_RETRIES; attempt++) {
      if (shouldStop()) return false;

      const chip = findChip(label);

      if (chip) {
        if (isChipSelected(chip)) return true;

        clickChip(chip);

        const selected = await waitFor(
          () => isChipSelected(findChip(label)),
          CONFIG.CHIP_SELECT_TIMEOUT
        );

        if (selected) {
          window.scrollTo({ top: 0, behavior: 'instant' });
          await sleep(CONFIG.CHIP_SETTLE_DELAY);
          if (isChipSelected(findChip(label))) return true;
        }

        continue;
      }

      const others = findChips().filter(c => c.label !== label);

      if (!others.length) {
        // No chip bar rendered yet; give the page a moment.
        await sleep(1000);
        continue;
      }

      report(`"${label}" tab is hidden, switching tabs to reveal it…`);

      const unselected = others.filter(c => !isChipSelected(c.el));
      const pool = unselected.length ? unselected : others;
      clickChip(pool[attempt % pool.length].el);

      await sleep(1500);
    }

    return false;
  }

  // Re-checked between deletions so a job without a keyword never
  // keeps deleting if YouTube drops the filter.
  function filterStillActive() {
    if (!onHistoryPage()) {
      fail('You left the history page, so cleaning stopped.');
      return false;
    }

    if (job.requiresChip && !isChipSelected(findChip(job.chip))) {
      fail(`The "${job.chipLabel}" filter is no longer selected, so cleaning stopped to stay safe.`);
      return false;
    }

    return true;
  }

  function fail(message) {
    if (!state.error) report(message, { error: true });
    state.stopRequested = true;
  }

  // ------------------------------------------------------------
  // Job runner
  // ------------------------------------------------------------

  function validate(options) {
    const category = CATEGORIES[options?.category];
    if (!category) return 'Unknown category.';
    if (!['delete', 'find'].includes(options.mode)) return 'Unknown mode.';

    const dateFrom = options.dateFrom || '';
    const dateTo = options.dateTo || '';
    if ((dateFrom && !ISO_DATE.test(dateFrom)) || (dateTo && !ISO_DATE.test(dateTo))) {
      return 'Invalid dates.';
    }
    if (dateFrom && dateTo && dateFrom > dateTo) return 'The start date must be before the end date.';

    const keyword = (options.keyword || '').trim();
    const keywordOk = keyword.length >= MIN_KEYWORD_LENGTH;

    if (options.mode === 'find') {
      if (!keywordOk && !dateFrom && !dateTo) return 'Enter a keyword or pick a date range.';
      if (options.findStyle === 'first') {
        const n = Number(options.findLimit);
        if (!Number.isInteger(n) || n < 1 || n > MAX_FIND_LIMIT) return 'Invalid number of matches.';
      }
      return null;
    }

    // "All" and "Videos" need a keyword unless a date range is set.
    const needsKeyword = options.useKeyword || (!category.allowAll && !dateFrom && !dateTo);

    if (needsKeyword && !keywordOk) {
      return `Clearing without a keyword isn't allowed for ${category.label} unless you pick a date range. Enter a keyword of at least ${MIN_KEYWORD_LENGTH} characters.`;
    }

    return null;
  }

  // Opens the history page and selects the category's filter tab.
  // Returns false (after reporting why) when it can't do so safely.
  async function prepareHistoryPage(category) {
    if (!(await waitForHistoryPage())) {
      fail('The watch history page did not load. Make sure you are signed in and try again.');
      return false;
    }

    report(`Selecting the "${category.label}" tab…`);

    if (await selectChip(job.chip)) return true;

    if (job.chip === 'All' && findChips().length === 0) {
      // Older layout without a filter bar: the page is already "All".
      // Deleting here still needs a keyword or a dated range.
      job.requiresChip = false;
      return true;
    }

    if (category.kind === 'short' || category.kind === 'video') {
      // Fall back to the All tab and tell Shorts from videos by link.
      const allSelected = findChips().length === 0 || (await selectChip('All'));

      if (!allSelected) {
        fail(`Couldn't open the "${category.label}" tab. Reload the history page and try again.`);
        return false;
      }

      job.chip = 'All';
      job.chipLabel = 'All';
      job.requiresChip = findChips().length > 0;
      report(`"${category.label}" tab not found, using All and filtering by type.`);
      return true;
    }

    fail(`Couldn't find the "${category.label}" tab in your history. Reload the page and try again.`);
    return false;
  }

  // Non-matching cards are trimmed from the page as the scan passes them,
  // which keeps long keyword scans fast but makes items vanish from a
  // history page the user is watching. Say so, or it reads as deletion.
  function hiddenNote() {
    if (!state.hidden) return '';
    return ` ${state.hidden} item${state.hidden === 1 ? ' that didn’t' : 's that didn’t'} match ${state.hidden === 1 ? 'was' : 'were'} hidden from this page to keep it fast — ${state.hidden === 1 ? 'it is' : 'they are'} still in your history. Reload the page to see ${state.hidden === 1 ? 'it' : 'them'}.`;
  }

  // 'YYYY-MM-DD' -> "3 Oct 2024" in the reader's own locale. Parsed as a
  // local date so the day never shifts across time zones. Presentation
  // only; shared.js has the same helper for the popup.
  function formatDate(value) {
    if (!ISO_DATE.test(value || '')) return value || '';

    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function describeFilter() {
    const parts = [];
    if (state.keyword) parts.push(`“${state.keyword}”`);
    if (state.dateFrom && state.dateTo) {
      parts.push(`${formatDate(state.dateFrom)} to ${formatDate(state.dateTo)}`);
    } else if (state.dateFrom) {
      parts.push(`since ${formatDate(state.dateFrom)}`);
    } else if (state.dateTo) {
      parts.push(`on or before ${formatDate(state.dateTo)}`);
    }
    return parts.join(', ');
  }

  async function runDelete() {
    report(job.keyword || hasDateFilter() ? `Scanning for ${describeFilter()}…` : 'Removing…');

    let idleScrolls = 0;

    while (!shouldStop()) {
      if (!filterStillActive()) break;

      const shelf = firstShelfWithMatches();

      if (shelf) {
        idleScrolls = 0;
        await processShelf(shelf);
        continue;
      }

      if (await processLooseCards()) {
        idleScrolls = 0;
        continue;
      }

      if (reachedOlderThanRange()) break;

      // Nothing left to remove among loaded items: load more.
      report(
        job.keyword || hasDateFilter()
          ? `Scanning for ${describeFilter()}… (${state.scanned} checked, ${state.deleted} removed)`
          : `Loading more history… (${state.deleted} removed)`
      );

      if (await loadNextRows()) {
        idleScrolls = 0;
        continue;
      }

      idleScrolls++;
      if (idleScrolls >= CONFIG.MAX_IDLE_SCROLLS) break;
    }
  }

  // ------------------------------------------------------------
  // Find-only mode: highlight matches, never remove
  // ------------------------------------------------------------

  const matches = [];
  const matchedIds = new Set();
  let cursor = -1;
  let resumeWaiter = null;

  function ensureHighlightStyle() {
    if (document.getElementById('ythc-highlight-style')) return;

    const style = document.createElement('style');
    style.id = 'ythc-highlight-style';
    style.textContent = `
      [data-ythc-match] { outline: 3px solid #fbc02d !important; outline-offset: 2px;
        border-radius: 12px; background: rgba(251, 192, 45, .14) !important; }
      [data-ythc-current] { outline-color: #ff6d00 !important; outline-width: 4px !important; }
    `;
    document.head.append(style);
  }

  function clearHighlights() {
    for (const el of document.querySelectorAll('[data-ythc-match], [data-ythc-current]')) {
      delete el.dataset.ythcMatch;
      delete el.dataset.ythcCurrent;
    }
    for (const el of document.querySelectorAll('[data-ythc-checked]')) {
      delete el.dataset.ythcChecked;
    }
    matches.length = 0;
    matchedIds.clear();
    cursor = -1;
  }

  // YouTube may re-render cards; find a match again by its video ID.
  function resolveMatch(i) {
    const match = matches[i];
    if (match.el.isConnected) return match.el;

    const el = allCards().find(card => entryKey(card) === match.key);
    if (el) {
      el.dataset.ythcMatch = '1';
      el.dataset.ythcChecked = '1';
      match.el = el;
    }
    return el || null;
  }

  function focusMatch(index) {
    if (!matches.length) return false;

    cursor = ((index % matches.length) + matches.length) % matches.length;

    for (const el of document.querySelectorAll('[data-ythc-current]')) {
      delete el.dataset.ythcCurrent;
    }

    // Re-apply highlights to any re-rendered matches.
    matches.forEach((_, i) => resolveMatch(i));

    const card = resolveMatch(cursor);
    if (!card) return false;
    card.dataset.ythcCurrent = '1';
    card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    return true;
  }

  function waitForNextClick() {
    state.waiting = true;
    report(`Match ${matches.length} found. Click Next match to keep searching.`);

    return new Promise(resolve => {
      resumeWaiter = () => {
        resumeWaiter = null;
        state.waiting = false;
        resolve();
      };
    });
  }

  // Shorts carousels may only render more items after clicking Next.
  async function advanceShelves() {
    let advanced = false;

    for (const shelf of document.querySelectorAll(SHELF_SELECTOR)) {
      const next = [
        ...shelf.querySelectorAll('button[aria-label="Next"], #right-arrow button'),
      ].find(button => !button.disabled && visible(button));

      if (!next) continue;

      const before = shelfSignature(shelf);
      next.click();
      await sleep(CONFIG.ROW_ADVANCE_DELAY);
      if (shelfSignature(shelf) !== before) advanced = true;
    }

    return advanced;
  }

  async function runFind() {
    ensureHighlightStyle();
    clearHighlights();

    const limit = job.findStyle === 'first' ? job.findLimit : Infinity;
    let idleScrolls = 0;

    report(`Searching for ${describeFilter()}…`);

    outer: while (!shouldStop()) {
      if (!onHistoryPage()) {
        fail('You left the history page, so the search stopped.');
        break;
      }

      const fresh = allCards().filter(card => card.dataset.ythcChecked !== '1');

      for (const card of fresh) {
        if (shouldStop()) break outer;

        card.dataset.ythcChecked = '1';
        markSeen(card);

        const key = entryKey(card);

        if (matchedIds.has(key)) {
          // A re-rendered copy of a match we already have.
          card.dataset.ythcMatch = '1';
          continue;
        }

        if (!matchesJob(card)) continue;
        matchedIds.add(key);

        card.dataset.ythcMatch = '1';
        matches.push({ el: card, key });
        state.found = matches.length;

        if (job.findStyle === 'step') {
          focusMatch(matches.length - 1);
          await waitForNextClick();
          if (shouldStop()) break outer;
          report(`Searching for ${describeFilter()}…`);
        } else {
          report(`Searching… ${matches.length} of ${limit} found`);
        }

        if (matches.length >= limit) break outer;
      }

      if (fresh.length) {
        idleScrolls = 0;
        continue;
      }

      if (reachedOlderThanRange()) break;
      if (await advanceShelves()) continue;

      report(`Searching for ${describeFilter()}… (${state.scanned} checked, ${matches.length} found)`);

      if (await loadNextRows()) {
        idleScrolls = 0;
        continue;
      }

      idleScrolls++;
      if (idleScrolls >= CONFIG.MAX_IDLE_SCROLLS) break;
    }

    state.waiting = false;
    if (matches.length && job.findStyle === 'first') focusMatch(0);
  }

  // ------------------------------------------------------------
  // Removing exactly what a find highlighted
  // ------------------------------------------------------------

  // null when the highlighted matches may be removed, otherwise why not.
  function removeMatchesProblem() {
    if (state.running) return 'A cleanup or search is already running in this tab.';
    if (!job || job.mode !== 'find') return 'Run a search first.';
    if (!matches.length) return 'Nothing is highlighted to remove.';

    // A find always needed a keyword or a date range, so this can never
    // reach a whole unfiltered history. Checked again rather than assumed.
    if (!job.keyword && !job.dateFrom && !job.dateTo) {
      return 'Highlighted items can only be removed when a keyword or a date range was used.';
    }

    if (!onHistoryPage()) return 'You left the history page.';
    return null;
  }

  async function runRemoveMatches(total) {
    report(`Removing ${total} highlighted item${total === 1 ? '' : 's'}…`);

    // Each match is tried once, so count the misses here rather than
    // relying on markFailed()'s retry threshold.
    let failed = 0;

    for (let i = 0; i < total; i++) {
      if (shouldStop() || !filterStillActive()) break;

      const card = resolveMatch(i);

      if (!card) {
        // YouTube re-rendered the page and this match is gone. Never
        // guess at a replacement.
        state.failed = ++failed;
        continue;
      }

      card.scrollIntoView({ behavior: 'instant', block: 'center' });

      const before = state.deleted;
      await deleteCard(card);
      if (state.deleted === before) state.failed = ++failed;
    }
  }

  // Removes the cards the find highlighted and nothing else. The job's
  // own filters stay in place, so deleteCard() re-checks every card
  // against them before clicking anything.
  async function removeMatches() {
    const total = matches.length;

    job.mode = 'delete';

    Object.assign(state, {
      mode: 'delete',
      running: true,
      finished: false,
      stopRequested: false,
      waiting: false,
      deleted: 0,
      failed: 0,
      error: null,
    });
    window.__YT_SHORTS_CLEANER_STOP__ = false;

    panel.show();

    try {
      await runRemoveMatches(total);
    } catch (err) {
      console.error('[History Cleaner]', err);
      fail(`Something went wrong: ${err?.message || err}`);
    } finally {
      closeOpenMenu();

      const stopped = shouldStop();
      state.running = false;
      state.waiting = false;
      state.finished = true;

      // The outlines pointed at items that are gone now.
      clearHighlights();
      state.found = 0;

      if (!state.error) {
        report(
          `${stopped ? 'Stopped' : 'Done'}. Removed ${state.deleted} of ${total} highlighted item${total === 1 ? '' : 's'}` +
            (state.failed ? `, ${state.failed} couldn't be removed (search again to retry).` : '.') +
            hiddenNote()
        );
      }
    }
  }

  async function run(options) {
    const category = CATEGORIES[options.category];
    const finding = options.mode === 'find';
    const keyword = (options.keyword || '').trim();
    const useKeyword = finding
      ? keyword.length >= MIN_KEYWORD_LENGTH
      : options.useKeyword || (!category.allowAll && !options.dateFrom && !options.dateTo);

    job = {
      mode: finding ? 'find' : 'delete',
      kind: category.kind,
      chip: category.chip,
      chipLabel: category.label,
      requiresChip: true,
      keyword: useKeyword ? normalize(keyword) : '',
      matchChannel: !!options.matchChannel,
      dateFrom: options.dateFrom || '',
      dateTo: options.dateTo || '',
      findStyle: options.findStyle === 'first' ? 'first' : 'step',
      findLimit: Number(options.findLimit) || 20,
    };

    CONFIG.DELETE_DELAY = SPEEDS[options.speed] ?? SPEEDS.normal;
    removedIds.clear();

    Object.assign(state, {
      mode: job.mode,
      running: true,
      finished: false,
      stopRequested: false,
      waiting: false,
      category: options.category,
      keyword: useKeyword ? keyword : '',
      useKeyword,
      dateFrom: job.dateFrom,
      dateTo: job.dateTo,
      deleted: 0,
      found: 0,
      failed: 0,
      scanned: 0,
      hidden: 0,
      error: null,
    });
    window.__YT_SHORTS_CLEANER_STOP__ = false;

    panel.show();
    report('Opening watch history…');

    try {
      if (!(await prepareHistoryPage(category))) return;

      if (finding) await runFind();
      else await runDelete();
    } catch (err) {
      console.error('[History Cleaner]', err);
      fail(`Something went wrong: ${err?.message || err}`);
    } finally {
      closeOpenMenu();
      state.running = false;
      state.waiting = false;
      state.finished = true;

      if (state.error) {
        report();
      } else if (finding) {
        const n = matches.length;
        report(
          n
            ? `${state.stopRequested ? 'Stopped' : 'Done'}. Found ${n} match${n === 1 ? '' : 'es'}, highlighted on the page. Nothing was removed.`
            : `${state.stopRequested ? 'Stopped' : 'Done'}. No matches found.`
        );
      } else {
        const stopped = state.stopRequested || window.__YT_SHORTS_CLEANER_STOP__ === true;
        report(
          `${stopped ? 'Stopped' : 'Done'}. Removed ${state.deleted} item${state.deleted === 1 ? '' : 's'}` +
            (state.failed ? `, ${state.failed} couldn't be removed (run again to retry).` : '.') +
            hiddenNote()
        );
      }
    }
  }

  // ------------------------------------------------------------
  // On-page status panel (so progress and Stop stay visible after
  // the popup closes)
  // ------------------------------------------------------------

  const panel = (() => {
    let host = null;
    let els = null;

    // The panel's Remove button is irreversible and has no confirmation
    // view to fall back on, so it arms on the first click and only acts
    // on a second one.
    let armed = false;
    let armTimer = null;

    function disarm() {
      clearTimeout(armTimer);
      armed = false;
    }

    function build() {
      host = document.createElement('div');
      host.id = 'ythc-panel-host';
      const root = host.attachShadow({ mode: 'closed' });

      const style = document.createElement('style');
      style.textContent = `
        .panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
          width: 300px; box-sizing: border-box; padding: 14px 16px; border-radius: 12px;
          background: #0f0f0f; color: #f1f1f1; font: 13px/1.4 Roboto, Arial, sans-serif;
          box-shadow: 0 6px 24px rgba(0,0,0,.35); }
        .title { font-weight: 600; font-size: 14px; margin: 0 0 6px; }
        .msg { margin: 0 0 8px; color: #ddd; word-wrap: break-word; }
        .msg.error { color: #ff8a80; }
        .stats { display: flex; gap: 12px; margin: 0 0 10px; color: #aaa; font-size: 12px; }
        .stats b { color: #fff; font-weight: 600; }
        .row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
        button { font: inherit; font-weight: 500; border: 0; border-radius: 18px; padding: 6px 14px; cursor: pointer; }
        .stop { background: #cc0000; color: #fff; }
        .close, .prev { background: #3f3f3f; color: #fff; }
        .next { background: #f1f1f1; color: #0f0f0f; }
        .remove { background: #5a2020; color: #ffb4ab; }
        .remove.armed { background: #cc0000; color: #fff; font-weight: 600; }
        [hidden] { display: none !important; }
      `;

      const wrap = document.createElement('div');
      wrap.className = 'panel';
      wrap.setAttribute('role', 'status');

      const title = document.createElement('p');
      title.className = 'title';

      const msg = document.createElement('p');
      msg.className = 'msg';

      const stats = document.createElement('div');
      stats.className = 'stats';

      const row = document.createElement('div');
      row.className = 'row';

      const stop = document.createElement('button');
      stop.className = 'stop';
      stop.textContent = 'Stop';
      stop.addEventListener('click', requestStop);

      const prev = document.createElement('button');
      prev.className = 'prev';
      prev.textContent = 'Previous';
      prev.addEventListener('click', () => step(-1));

      const next = document.createElement('button');
      next.className = 'next';
      next.textContent = 'Next match';
      next.addEventListener('click', () => step(1));

      const remove = document.createElement('button');
      remove.className = 'remove';
      remove.addEventListener('click', () => {
        if (armed) {
          disarm();
          removeMatches();
          return;
        }

        armed = true;
        armTimer = setTimeout(() => {
          disarm();
          panel.update();
        }, 5000);
        panel.update();
      });

      const close = document.createElement('button');
      close.className = 'close';
      close.textContent = 'Close';
      close.addEventListener('click', () => {
        disarm();
        host.remove();
        if (!state.running) clearHighlights();
      });

      row.append(prev, next, remove, stop, close);
      wrap.append(title, msg, stats, row);
      root.append(style, wrap);

      els = { title, msg, stats, prev, next, remove, stop, close };
    }

    function stat(label, value) {
      const span = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = String(value);
      span.append(b, ` ${label}`);
      return span;
    }

    return {
      show() {
        if (!host) build();
        if (!host.isConnected) document.documentElement.append(host);
        this.update();
      },
      update() {
        if (!host?.isConnected) return;

        els.msg.textContent = state.message;
        els.msg.classList.toggle('error', !!state.error);

        const finding = state.mode === 'find';

        // The panel used to say "Watch History Cleaner" while running a
        // find, which removes nothing.
        els.title.textContent = `History Cleaner · ${finding ? 'Searching' : 'Removing'}`;
        const items = [finding ? stat('found', state.found) : stat('removed', state.deleted)];
        if (finding || state.useKeyword || state.dateFrom || state.dateTo) {
          items.push(stat('checked', state.scanned));
        }
        if (state.failed) items.push(stat('failed', state.failed));
        els.stats.replaceChildren(...items);

        const browsing = finding && !state.running && matches.length > 0;
        els.next.hidden = !(finding && (state.waiting || browsing));
        els.next.textContent = state.running ? 'Next match' : 'Next';
        els.prev.hidden = !(browsing && matches.length > 1);

        const canRemove = !removeMatchesProblem();
        if (!canRemove && armed) disarm();
        els.remove.hidden = !canRemove;
        els.remove.classList.toggle('armed', armed);
        els.remove.textContent = armed
          ? 'Click again to remove'
          : `Remove these ${matches.length}`;

        els.stop.hidden = !state.running;
        els.close.hidden = state.running;
      },
      isOpen: () => !!host?.isConnected,
    };
  })();

  function requestStop() {
    state.stopRequested = true;
    if (state.running) report('Stopping…');
    resumeWaiter?.();
  }

  // Next/Previous: resumes a paused search, or jumps between the
  // highlighted matches once the search is done.
  function step(direction) {
    if (resumeWaiter) {
      if (direction > 0) resumeWaiter();
      return;
    }

    if (state.running || state.mode !== 'find' || !matches.length) return;

    if (focusMatch(cursor + direction)) {
      report(`Match ${cursor + 1} of ${matches.length}. Nothing was removed.`);
    } else {
      report(`Match ${cursor + 1} is no longer on the page. Try Next.`);
    }
  }

  // ------------------------------------------------------------
  // Messages from the popup / background worker
  // ------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case 'ythc:ping':
      case 'ythc:status':
        sendResponse({ ok: true, state: publicState() });
        return;

      case 'ythc:start': {
        if (state.running) {
          sendResponse({ ok: false, error: 'A cleanup or search is already running in this tab. Stop it first.' });
          return;
        }

        const error = validate(msg.options);
        if (error) {
          sendResponse({ ok: false, error });
          return;
        }

        run(msg.options);
        sendResponse({ ok: true });
        return;
      }

      case 'ythc:remove-matches': {
        const problem = removeMatchesProblem();
        if (problem) {
          sendResponse({ ok: false, error: problem });
          return;
        }

        const count = matches.length;
        removeMatches();
        sendResponse({ ok: true, count });
        return;
      }

      case 'ythc:stop':
        requestStop();
        sendResponse({ ok: true });
        return;

      case 'ythc:next':
      case 'ythc:prev':
        step(msg.type === 'ythc:next' ? 1 : -1);
        sendResponse({ ok: true });
        return;
    }
  });
})();
