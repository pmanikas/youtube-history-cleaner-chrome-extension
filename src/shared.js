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

// days: the last N days including today.
// olderThan: watched more than N days ago.
export const DATE_PRESETS = {
  any: { label: 'Any time' },
  today: { label: 'Today', days: 1 },
  week: { label: 'Last 7 days', days: 7 },
  month: { label: 'Last 30 days', days: 30 },
  quarter: { label: 'Last 90 days', days: 90 },
  year: { label: 'Last 12 months', days: 365 },
  older30: { label: 'Older than 30 days', olderThan: 30 },
  older365: { label: 'Older than 1 year', olderThan: 365 },
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

export function describeDateRange({ dateFrom, dateTo, datePreset }) {
  if (!dateFrom && !dateTo) return '';
  if (datePreset && datePreset !== 'custom') return DATE_PRESETS[datePreset].label.toLowerCase();
  if (dateFrom && dateTo) return `watched from ${dateFrom} to ${dateTo}`;
  if (dateFrom) return `watched since ${dateFrom}`;
  return `watched on or before ${dateTo}`;
}

// Returns an error string, or null when the options are allowed.
export function validateOptions(options) {
  const category = CATEGORIES[options?.category];
  if (!category) return 'Unknown category.';
  if (!['delete', 'find'].includes(options.mode)) return 'Unknown mode.';
  if (!(options.speed in SPEEDS)) return 'Unknown speed.';
  if (!(options.datePreset in DATE_PRESETS)) return 'Unknown date range.';

  const { dateFrom = '', dateTo = '' } = options;

  if ((dateFrom && !ISO_DATE.test(dateFrom)) || (dateTo && !ISO_DATE.test(dateTo))) {
    return 'Enter valid dates.';
  }
  if (options.datePreset === 'custom' && !dateFrom && !dateTo) {
    return 'Pick a start date, an end date, or both.';
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return 'The start date must be before the end date.';
  }

  const keyword = (options.keyword || '').trim();
  const keywordOk = keyword.length >= MIN_KEYWORD_LENGTH;
  const hasDate = !!(dateFrom || dateTo);

  if (options.mode === 'find') {
    if (keyword && !keywordOk) return `Keywords need at least ${MIN_KEYWORD_LENGTH} characters.`;
    if (!keywordOk && !hasDate) return 'Enter a keyword or pick a date range to search for.';
    if (options.findStyle === 'first') {
      const n = Number(options.findLimit);
      if (!Number.isInteger(n) || n < 1 || n > MAX_FIND_LIMIT) {
        return `Number of matches must be between 1 and ${MAX_FIND_LIMIT}.`;
      }
    } else if (options.findStyle !== 'step') {
      return 'Unknown search style.';
    }
    return null;
  }

  // Delete mode. "All" and "Videos" need a keyword unless a date range
  // is set (so "Any time" can never reach your whole history).
  const needsKeyword = options.useKeyword || (!category.allowAll && !hasDate);

  if (needsKeyword && !keywordOk) {
    if (options.useKeyword) return `Enter a keyword of at least ${MIN_KEYWORD_LENGTH} characters.`;
    return `Clearing all ${category.label === 'All' ? 'history' : 'videos'} needs a keyword or a date range.`;
  }

  return null;
}
