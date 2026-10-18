#!/usr/bin/env node
// Writes src/shared.js's option constants into src/cleaner.js.
//
// Content scripts declared in the manifest can't import modules, so the
// content script needs its own copy of CATEGORIES, SPEEDS and the limits.
// That copy used to be maintained by hand under a "keep in sync" comment,
// and it drifted: shared.js spelled the filter chips "All"/"Videos" while
// cleaner.js had "all"/"videos".
//
//   npm run sync    rewrite the block in src/cleaner.js
//   npm test        fail if the block is out of date
//
// Only the constants are generated. The content script's validate() still
// mirrors validateOptions() by hand; it is the last hand-copied piece.

import { readFile, writeFile } from 'node:fs/promises';

import {
  CATEGORIES,
  MAX_FIND_LIMIT,
  MIN_KEYWORD_LENGTH,
  SPEEDS,
} from '../src/shared.js';

const TARGET = new URL('../src/cleaner.js', import.meta.url);

const START = '  // >>> generated from src/shared.js by tools/sync-shared.mjs - do not edit >>>';
const END = '  // <<< generated <<<';

function generate() {
  const categories = Object.entries(CATEGORIES).map(
    ([key, c]) =>
      `    ${key}: { label: '${c.label}', chip: '${c.chip}', allowAll: ${c.allowAll}, kind: '${c.kind}' },`
  );

  const speeds = Object.entries(SPEEDS)
    .map(([key, ms]) => `${key}: ${ms}`)
    .join(', ');

  return [
    START,
    `  const MIN_KEYWORD_LENGTH = ${MIN_KEYWORD_LENGTH};`,
    `  const MAX_FIND_LIMIT = ${MAX_FIND_LIMIT};`,
    '',
    '  const CATEGORIES = {',
    ...categories,
    '  };',
    '',
    `  const SPEEDS = { ${speeds} };`,
    END,
  ].join('\n');
}

function replaceBlock(source, block) {
  const from = source.indexOf(START);
  const to = source.indexOf(END);

  if (from === -1 || to === -1 || to < from) {
    throw new Error(`Couldn't find the generated block markers in ${TARGET.pathname}.`);
  }

  return source.slice(0, from) + block + source.slice(to + END.length);
}

const check = process.argv.includes('--check');
const source = await readFile(TARGET, 'utf8');
const updated = replaceBlock(source, generate());

if (source === updated) {
  console.log('src/cleaner.js constants are in sync with src/shared.js.');
  process.exit(0);
}

if (check) {
  console.error(
    "src/cleaner.js constants are out of date with src/shared.js. Run `npm run sync`."
  );
  process.exit(1);
}

await writeFile(TARGET, updated);
console.log('Updated the generated constants in src/cleaner.js.');
