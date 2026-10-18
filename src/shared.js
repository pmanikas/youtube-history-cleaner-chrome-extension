// Shared definitions used by the popup and the background worker.
// (The content script keeps its own copy of the safety rules because
// content scripts declared in the manifest can't import modules.)

export const HISTORY_URL = 'https://www.youtube.com/feed/history';

export const MIN_KEYWORD_LENGTH = 2;
export const MAX_FIND_LIMIT = 500;

// category -> YouTube history filter chip label, and whether
// "everything in this category" (no keyword) is allowed.
export const CATEGORIES = {
  all: { label: 'All', chip: 'All', allowAll: false },
  videos: { label: 'Videos', chip: 'Videos', allowAll: false },
  shorts: { label: 'Shorts', chip: 'Shorts', allowAll: true },
  music: { label: 'Music', chip: 'Music', allowAll: true },
  podcasts: { label: 'Podcasts', chip: 'Podcasts', allowAll: true },
};

export const SPEEDS = {
  fast: 120,
  normal: 250,
  careful: 500,
};

// label: what the dropdown shows.
// phrase: a sentence fragment for the confirmation ("every Short <phrase>").
// days: the last N days including today.
// olderThan: watched more than N days ago.
export const DATE_PRESETS = {
  any: { label: 'Any time' },
  today: { label: 'Today', days: 1, phrase: 'watched today' },
  week: { label: 'Last 7 days', days: 7, phrase: 'watched in the last 7 days' },
  month: { label: 'Last 30 days', days: 30, phrase: 'watched in the last 30 days' },
  quarter: { label: 'Last 90 days', days: 90, phrase: 'watched in the last 90 days' },
  year: { label: 'Last 12 months', days: 365, phrase: 'watched in the last 12 months' },
  older30: { label: 'Older than 30 days', olderThan: 30, phrase: 'watched more than 30 days ago' },
  older365: { label: 'Older than 1 year', olderThan: 365, phrase: 'watched more than a year ago' },
  custom: { label: 'Custom range' },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysAgo(n, today = new Date()) {
  return isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
}

// Turns a preset (or custom inputs) into an inclusive local-date range
// of 'YYYY-MM-DD' strings. Either end may be '' (open).
export function resolveDateRange(preset, customFrom = '', customTo = '', today = new Date()) {
  const p = DATE_PRESETS[preset];
  if (!p || preset === 'any') return { from: '', to: '' };
  if (preset === 'custom') return { from: customFrom || '', to: customTo || '' };
  if (p.days) return { from: daysAgo(p.days - 1, today), to: '' };
  return { from: '', to: daysAgo(p.olderThan + 1, today) };
}

// 'YYYY-MM-DD' -> "3 Oct 2024" in the reader's own locale. Parsed as a
// local date so the day never shifts across time zones.
export function formatDate(value) {
  const parts = ISO_DATE.test(value || '') ? value.split('-').map(Number) : null;
  if (!parts) return value || '';

  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// A sentence fragment that reads correctly after "every Short…":
// "watched in the last 7 days", "watched between 1 Jan 2026 and 1 Feb 2026".
// Empty when no date filter is set.
export function describeDateRange({ dateFrom, dateTo, datePreset }) {
  const phrase = DATE_PRESETS[datePreset]?.phrase;
  if (phrase) return phrase;
  if (!dateFrom && !dateTo) return '';
  if (dateFrom && dateTo) {
    return `watched between ${formatDate(dateFrom)} and ${formatDate(dateTo)}`;
  }
  if (dateFrom) return `watched on or after ${formatDate(dateFrom)}`;
  return `watched on or before ${formatDate(dateTo)}`;
}

// Returns null when the options are allowed, otherwise
// { message, field } where `field` names the input the popup should
// focus so the user can act on the message straight away.
export function validateOptions(options) {
  const problem = (message, field = null) => ({ message, field });

  const category = CATEGORIES[options?.category];
  if (!category) return problem('Unknown category.');
  if (!['delete', 'find'].includes(options.mode)) return problem('Unknown mode.');
  if (!(options.speed in SPEEDS)) return problem('Unknown speed.', 'speed');
  if (!(options.datePreset in DATE_PRESETS)) return problem('Unknown date range.', 'datePreset');

  const { dateFrom = '', dateTo = '' } = options;

  if (dateFrom && !ISO_DATE.test(dateFrom)) return problem('Enter a valid start date.', 'dateFrom');
  if (dateTo && !ISO_DATE.test(dateTo)) return problem('Enter a valid end date.', 'dateTo');
  if (options.datePreset === 'custom' && !dateFrom && !dateTo) {
    return problem('Pick a start date, an end date, or both.', 'dateFrom');
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return problem('The start date must be before the end date.', 'dateFrom');
  }

  const keyword = (options.keyword || '').trim();
  const keywordOk = keyword.length >= MIN_KEYWORD_LENGTH;
  const hasDate = !!(dateFrom || dateTo);

  if (options.mode === 'find') {
    if (keyword && !keywordOk) {
      return problem(`Keywords need at least ${MIN_KEYWORD_LENGTH} characters.`, 'keyword');
    }
    if (!keywordOk && !hasDate) {
      return problem('Enter a keyword or pick a date range to search for.', 'keyword');
    }
    if (options.findStyle === 'first') {
      const n = Number(options.findLimit);
      if (!Number.isInteger(n) || n < 1 || n > MAX_FIND_LIMIT) {
        return problem(`Number of matches must be between 1 and ${MAX_FIND_LIMIT}.`, 'findLimit');
      }
    } else if (options.findStyle !== 'step') {
      return problem('Unknown search style.');
    }
    return null;
  }

  // Delete mode. "All" and "Videos" need a keyword unless a date range
  // is set (so "Any time" can never reach your whole history).
  const needsKeyword = options.useKeyword || (!category.allowAll && !hasDate);

  if (needsKeyword && !keywordOk) {
    if (options.useKeyword) {
      return problem(`Enter a keyword of at least ${MIN_KEYWORD_LENGTH} characters.`, 'keyword');
    }
    return problem(
      `Clearing all ${category.label === 'All' ? 'history' : 'videos'} needs a keyword or a date range.`,
      'keyword'
    );
  }

  return null;
}
