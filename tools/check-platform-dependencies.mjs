#!/usr/bin/env node

// Gate: check:platform-dependencies
//
// Tracks direct platform dependency usage in production source. Existing debt is
// baselined in tools/platform-dependency-allowlist.jsonc; new direct calls fail
// until they are routed through an approved owner or deliberately rebaselined.

import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const UPDATE_MODE = process.argv.includes('--update');

const ALLOWLIST_PATH = join(ROOT, 'tools/platform-dependency-allowlist.jsonc');

const SCAN_ROOTS = [
  'apps',
  'canvas',
  'charts',
  'compute',
  'contracts',
  'domain-types',
  'file-io',
  'infra',
  'kernel',
  'runtime',
  'shell',
  'spreadsheet-utils',
  'table-engine',
  'types',
  'typeset',
  'ui',
  'views',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.rs']);

const SKIP_SEGMENTS = new Set([
  '.git',
  '.turbo',
  'coverage',
  'dev',
  'dist',
  'fixtures',
  'node_modules',
  'target',
  'target-native',
  'target-wasm',
  'tests',
  '__tests__',
  '__fixtures__',
  'benches',
  'examples',
]);

const SKIP_FILE_PATTERNS = [
  /\.d\.ts$/,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /(^|\/)vite\.config\.ts$/,
  /(^|\/)jest\.config\.ts$/,
  /(^|\/)vitest\.config\.ts$/,
  /(^|\/)build\.rs$/,
];

const RULES = [
  {
    id: 'ts-date-now',
    language: 'ts',
    category: 'host-wall-time',
    pattern: /\bDate\.now\s*\(/g,
  },
  {
    id: 'ts-performance-now',
    language: 'ts',
    category: 'elapsed-time',
    pattern: /\bperformance\.now\s*\(/g,
  },
  {
    id: 'ts-performance-mark-measure',
    language: 'ts',
    category: 'elapsed-time',
    pattern: /\bperformance\.(?:mark|measure)\s*\(/g,
  },
  {
    id: 'ts-math-random',
    language: 'ts',
    category: 'entropy-or-id-generation',
    pattern: /\bMath\.random\s*\(/g,
  },
  {
    id: 'ts-crypto-random-uuid',
    language: 'ts',
    category: 'id-generation',
    pattern: /\b(?:globalThis\.)?crypto\.randomUUID\s*\(/g,
  },
  {
    id: 'ts-crypto-get-random-values',
    language: 'ts',
    category: 'entropy',
    pattern: /\b(?:globalThis\.)?crypto\.getRandomValues\s*\(/g,
  },
  {
    id: 'ts-process-global',
    language: 'ts',
    category: 'runtime-detection',
    pattern: /\bprocess\./g,
  },
  {
    id: 'ts-import-meta-env',
    language: 'ts',
    category: 'environment',
    pattern: /\bimport\.meta\.env\b/g,
  },
  {
    id: 'ts-runtime-global-detection',
    language: 'ts',
    category: 'runtime-detection',
    pattern: /\btypeof\s+(?:window|document|process|globalThis\.process)\b/g,
  },
  {
    id: 'ts-dynamic-import-meta',
    language: 'ts',
    category: 'environment',
    pattern: /new\s+Function\s*\([^)]*import\.meta[^)]*\)/g,
  },
  {
    id: 'rs-system-time-now',
    language: 'rs',
    category: 'rust-wall-time',
    pattern: /\b(?:std::time::)?SystemTime::now\s*\(/g,
  },
  {
    id: 'rs-instant-now',
    language: 'rs',
    category: 'elapsed-time',
    pattern: /\b(?:std::time::)?Instant::now\s*\(/g,
  },
  {
    id: 'rs-chrono-utc-now',
    language: 'rs',
    category: 'rust-wall-time',
    pattern: /\b(?:chrono::)?Utc::now\s*\(/g,
  },
  {
    id: 'rs-js-sys-date-now',
    language: 'rs',
    category: 'rust-wall-time',
    pattern: /\bjs_sys::Date::now\s*\(/g,
  },
  {
    id: 'rs-uuid-new-v4',
    language: 'rs',
    category: 'id-generation',
    pattern: /\b(?:uuid::)?Uuid::new_v4\s*\(/g,
  },
  {
    id: 'rs-randomness',
    language: 'rs',
    category: 'entropy',
    pattern: /\b(?:rand::|thread_rng\s*\(|OsRng|getrandom\s*\()/g,
  },
  {
    id: 'rs-runtime-primitives-call',
    language: 'rs',
    category: 'runtime-primitive-usage',
    pattern: /\bmog_runtime_primitives::[A-Za-z0-9_:]+/g,
  },
  {
    id: 'rs-cfg-wasm32',
    language: 'rs',
    category: 'target-mechanics',
    pattern: /#\s*\[\s*cfg[^\]\n]*target_arch\s*=\s*"wasm32"[^\]\n]*\]/g,
  },
];

function loadJsonc(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const noTrailingCommas = stripped.replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(noTrailingCommas);
}

function extensionOf(path) {
  const match = path.match(/(\.[^.\/]+)$/);
  return match ? match[1] : '';
}

function shouldSkipPath(relPath) {
  const segments = relPath.split('/');
  if (segments.some((segment) => SKIP_SEGMENTS.has(segment))) return true;
  return SKIP_FILE_PATTERNS.some((pattern) => pattern.test(relPath));
}

function walk(dir, results = []) {
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir).sort();
  for (const entry of entries) {
    const absPath = join(dir, entry);
    const relPath = relative(ROOT, absPath).replaceAll('\\', '/');
    if (shouldSkipPath(relPath)) continue;
    let stat;
    try {
      stat = lstatSync(absPath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      walk(absPath, results);
      continue;
    }
    if (!stat.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(extensionOf(relPath))) continue;
    results.push(absPath);
  }
  return results;
}

function lineColumnForOffset(text, offset) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function findMatches(text, rule, path) {
  rule.pattern.lastIndex = 0;
  const matches = [];
  let match;
  while ((match = rule.pattern.exec(text)) !== null) {
    const { line, column } = lineColumnForOffset(text, match.index);
    matches.push({
      path,
      ruleId: rule.id,
      category: rule.category,
      line,
      column,
      match: match[0],
    });
    if (match[0].length === 0) rule.pattern.lastIndex += 1;
  }
  return matches;
}

function scan() {
  const occurrences = [];
  for (const root of SCAN_ROOTS) {
    for (const absPath of walk(join(ROOT, root))) {
      const relPath = relative(ROOT, absPath).replaceAll('\\', '/');
      const ext = extensionOf(relPath);
      const language = ext === '.rs' ? 'rs' : 'ts';
      const text = readFileSync(absPath, 'utf-8');
      for (const rule of RULES) {
        if (rule.language !== language) continue;
        occurrences.push(...findMatches(text, rule, relPath));
      }
    }
  }
  return occurrences;
}

function stableOccurrenceKey(entry) {
  return `${entry.path}\0${entry.ruleId}\0${entry.match}`;
}

function stableKeyParts(key) {
  const [path, ruleId, match] = key.split('\0');
  return { path, ruleId, match };
}

function sortOccurrences(entries) {
  return [...entries].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.line - b.line ||
      a.column - b.column ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.match.localeCompare(b.match),
  );
}

function sortGroups(entries) {
  return [...entries].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.match.localeCompare(b.match),
  );
}

function defaultOwnerMetadata() {
  return {
    'local-elapsed-budget-owner': {
      reason: 'Existing elapsed-time/profiling occurrence pending owner-specific clock migration.',
      migrationPlan:
        'Route through a local monotonic clock owned by the scheduler, parser, solver, or UI runtime.',
    },
    'platform-contract-migration': {
      reason: 'Existing direct platform dependency captured by the platform dependency inventory.',
      migrationPlan: 'Replace with the semantic owner contract named by the platform facts matrix.',
    },
    'target-mechanics-owner': {
      reason: 'Existing target-specific mechanics occurrence pending review.',
      migrationPlan:
        'Keep only at binding/local compatibility boundaries; remove from domain logic.',
    },
    'test-dev-only': {
      reason: 'Test or development-only platform dependency occurrence.',
      migrationPlan: 'Keep outside production contract or remove when the test no longer needs it.',
    },
  };
}

function defaultMetadata(entry) {
  if (entry.path.includes('__tests__') || entry.path.includes('/tests/')) {
    return {
      owner: 'test-dev-only',
      reason: 'Test or development-only platform dependency occurrence.',
      migrationPlan: 'Keep outside production contract or remove when the test no longer needs it.',
    };
  }
  if (entry.category === 'elapsed-time') {
    return {
      owner: 'local-elapsed-budget-owner',
      reason: 'Existing elapsed-time/profiling occurrence pending owner-specific clock migration.',
      migrationPlan:
        'Route through a local monotonic clock owned by the scheduler, parser, solver, or UI runtime.',
    };
  }
  if (entry.category === 'target-mechanics') {
    return {
      owner: 'target-mechanics-owner',
      reason: 'Existing target-specific mechanics occurrence pending review.',
      migrationPlan:
        'Keep only at binding/local compatibility boundaries; remove from domain logic.',
    };
  }
  return {
    owner: 'platform-contract-migration',
    reason: 'Existing direct platform dependency captured by the platform dependency inventory.',
    migrationPlan: 'Replace with the semantic owner contract named by the platform facts matrix.',
  };
}

function effectiveMetadata(entry, ownerDefaults) {
  const ownerDefault = ownerDefaults[entry.owner] ?? {};
  return {
    owner: entry.owner,
    reason: entry.reason ?? ownerDefault.reason,
    migrationPlan: entry.migrationPlan ?? ownerDefault.migrationPlan,
  };
}

function metadataOverrideFields(metadata, ownerDefaults) {
  const ownerDefault = ownerDefaults[metadata.owner];
  if (
    ownerDefault &&
    ownerDefault.reason === metadata.reason &&
    ownerDefault.migrationPlan === metadata.migrationPlan
  ) {
    return {};
  }
  return {
    reason: metadata.reason,
    migrationPlan: metadata.migrationPlan,
  };
}

function occurrenceBucketsByStableKey(entries) {
  const buckets = new Map();
  for (const entry of sortOccurrences(entries)) {
    const key = stableOccurrenceKey(entry);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      buckets.set(key, [entry]);
    }
  }
  return buckets;
}

function groupsFromOccurrences(occurrences, ownerDefaults) {
  return sortGroups(
    [...occurrenceBucketsByStableKey(occurrences).entries()].map(([key, entries]) => {
      const representative = entries[0];
      const metadata = representative.owner
        ? effectiveMetadata(representative, ownerDefaults)
        : defaultMetadata(representative);
      return {
        ...stableKeyParts(key),
        category: representative.category,
        allowedCount: entries.length,
        ...metadata,
      };
    }),
  );
}

function normalizeAllowlistGroups(payload) {
  const ownerDefaults = payload.ownerDefaults ?? defaultOwnerMetadata();
  const entries = payload.allowlist;
  if (!Array.isArray(entries)) return { ownerDefaults, groups: null };

  if (entries.every((entry) => typeof entry.allowedCount === 'number')) {
    return {
      ownerDefaults,
      groups: sortGroups(
        entries.map((entry) => ({
          path: entry.path,
          ruleId: entry.ruleId,
          category: entry.category,
          match: entry.match,
          allowedCount: entry.allowedCount,
          ...effectiveMetadata(entry, ownerDefaults),
        })),
      ),
    };
  }

  return {
    ownerDefaults,
    groups: groupsFromOccurrences(entries, ownerDefaults),
  };
}

function existingAllowlistGroups() {
  if (!existsSync(ALLOWLIST_PATH)) return { ownerDefaults: defaultOwnerMetadata(), groups: [] };
  const existing = loadJsonc(ALLOWLIST_PATH);
  const normalized = normalizeAllowlistGroups(existing);
  return {
    ownerDefaults: normalized.ownerDefaults,
    groups: normalized.groups ?? [],
  };
}

function compactGroupForOutput(group, ownerDefaults) {
  const metadata = {
    owner: group.owner,
    reason: group.reason,
    migrationPlan: group.migrationPlan,
  };
  return {
    path: group.path,
    ruleId: group.ruleId,
    category: group.category,
    match: group.match,
    allowedCount: group.allowedCount,
    owner: group.owner,
    ...metadataOverrideFields(metadata, ownerDefaults),
  };
}

function writeAllowlist(current) {
  const ownerDefaults = defaultOwnerMetadata();
  const existing = existingAllowlistGroups();
  const existingByStableKey = new Map(
    existing.groups.map((entry) => [stableOccurrenceKey(entry), entry]),
  );
  const allowlist = sortGroups(
    groupsFromOccurrences(current, ownerDefaults).map((group) => {
      const existingGroup = existingByStableKey.get(stableOccurrenceKey(group));
      const metadata =
        existingGroup && ownerDefaults[existingGroup.owner]
          ? {
              owner: existingGroup.owner,
              ...ownerDefaults[existingGroup.owner],
            }
          : existingGroup
            ? effectiveMetadata(existingGroup, existing.ownerDefaults)
            : defaultMetadata(group);
      return compactGroupForOutput(
        {
          ...group,
          ...metadata,
        },
        ownerDefaults,
      );
    }),
  );
  const payload = {
    $schema: './platform-dependency-allowlist.schema.json',
    description:
      'Grouped count baseline for direct platform dependency usage. Run `pnpm check:platform-dependencies -- --update` after deliberately reducing or reclassifying debt.',
    rules: Object.fromEntries(
      RULES.map((rule) => [
        rule.id,
        {
          category: rule.category,
          language: rule.language,
        },
      ]),
    ),
    ownerDefaults,
    allowlist,
  };
  const header = [
    '// Baseline for tools/check-platform-dependencies.mjs.',
    '// Entries are grouped by stable file/rule/match counts. Exact',
    '// line/column locations are generated by the scanner at runtime.',
    '',
  ].join('\n');
  writeFileSync(ALLOWLIST_PATH, header + formatAllowlistPayload(payload) + '\n');
}

function formatOccurrence(entry) {
  return `${entry.path}:${entry.line}:${entry.column} ${entry.ruleId} ${JSON.stringify(entry.match)}`;
}

function formatOccurrenceLocation(entry) {
  return `${entry.path}:${entry.line}:${entry.column}`;
}

function countOccurrences(groups) {
  return groups.reduce((total, group) => total + group.entries.length - group.allowedCount, 0);
}

function countReductions(groups) {
  return groups.reduce((total, group) => total + group.group.allowedCount - group.currentCount, 0);
}

function formatGroup(group) {
  return `${group.path} ${group.ruleId} ${JSON.stringify(group.match)}`;
}

function formatAllowlistPayload(payload) {
  const lines = [];
  lines.push('{');
  lines.push(`  "$schema": ${JSON.stringify(payload.$schema)},`);
  lines.push(`  "description": ${JSON.stringify(payload.description)},`);
  lines.push(`  "rules": ${indentJson(payload.rules, 2)},`);
  lines.push(`  "ownerDefaults": ${indentJson(payload.ownerDefaults, 2)},`);
  lines.push('  "allowlist": [');
  payload.allowlist.forEach((entry, index) => {
    const suffix = index === payload.allowlist.length - 1 ? '' : ',';
    lines.push(`    ${JSON.stringify(entry)}${suffix}`);
  });
  lines.push('  ]');
  lines.push('}');
  return lines.join('\n');
}

function indentJson(value, spaces) {
  const indent = ' '.repeat(spaces);
  return JSON.stringify(value, null, 2).replace(/\n/g, `\n${indent}`);
}

const current = sortOccurrences(scan());

if (UPDATE_MODE || !existsSync(ALLOWLIST_PATH)) {
  writeAllowlist(current);
  const groupCount = groupsFromOccurrences(current, defaultOwnerMetadata()).length;
  console.log(
    `Updated ${relative(ROOT, ALLOWLIST_PATH)} with ${groupCount} grouped baseline entries for ${current.length} occurrences.`,
  );
  process.exit(0);
}

const allowlist = loadJsonc(ALLOWLIST_PATH);
const normalizedAllowlist = normalizeAllowlistGroups(allowlist);
if (!normalizedAllowlist.groups) {
  console.error('FAIL: platform dependency allowlist must use grouped `allowlist` entries.');
  console.error('Rebaseline with: pnpm check:platform-dependencies -- --update');
  process.exit(1);
}

const failureGroups = [];
const reductionGroups = [];
const metadataFailures = [];
const currentByStableKey = occurrenceBucketsByStableKey(current);
const allowedGroupsByStableKey = new Map(
  normalizedAllowlist.groups.map((entry) => [stableOccurrenceKey(entry), entry]),
);

for (const [key, entries] of currentByStableKey) {
  const allowedCount = allowedGroupsByStableKey.get(key)?.allowedCount ?? 0;
  if (entries.length > allowedCount) {
    failureGroups.push({ entries, allowedCount });
  }
}

for (const [key, group] of allowedGroupsByStableKey) {
  const currentCount = currentByStableKey.get(key)?.length ?? 0;
  if (group.allowedCount > currentCount) {
    reductionGroups.push({ group, currentCount });
  }
}

for (const entry of normalizedAllowlist.groups) {
  for (const field of ['owner', 'reason', 'migrationPlan']) {
    if (
      typeof entry[field] !== 'string' ||
      entry[field].trim() === '' ||
      entry[field] === 'TODO'
    ) {
      metadataFailures.push(`${formatGroup(entry)} missing ${field}`);
    }
  }
  if (!Number.isInteger(entry.allowedCount) || entry.allowedCount < 0) {
    metadataFailures.push(`${formatGroup(entry)} has invalid allowedCount`);
  }
}

if (failureGroups.length > 0) {
  const failureCount = countOccurrences(failureGroups);
  console.error('FAIL: new direct platform dependency usage detected.');
  console.error('Stable file/rule/match occurrence counts exceeded the allowlist.');
  console.error('Line/column drift is ignored; only count increases fail.');
  console.error(
    `Detected ${failureCount} new occurrences across ${failureGroups.length} stable groups.`,
  );
  for (const group of failureGroups.slice(0, 40)) {
    const representative = group.entries[0];
    const excessEntries = group.entries.slice(group.allowedCount);
    console.error(
      `  - ${representative.path} ${representative.ruleId} ${JSON.stringify(
        representative.match,
      )}: found ${group.entries.length}, allowed ${group.allowedCount}, new ${excessEntries.length}`,
    );
    for (const entry of excessEntries.slice(0, 3)) {
      console.error(`      current at ${formatOccurrenceLocation(entry)}`);
    }
    if (excessEntries.length > 3) {
      console.error(`      ... ${excessEntries.length - 3} more locations in this group`);
    }
  }
  if (failureGroups.length > 40) {
    console.error(`  ... ${failureGroups.length - 40} more groups`);
  }
  console.error('\nRoute the usage through the approved owner or rebaseline with:');
  console.error('  pnpm check:platform-dependencies -- --update');
  process.exit(1);
}

if (metadataFailures.length > 0) {
  console.error('FAIL: platform dependency allowlist entries are missing owner metadata.');
  for (const failure of metadataFailures.slice(0, 80)) {
    console.error(`  - ${failure}`);
  }
  if (metadataFailures.length > 80) {
    console.error(`  ... ${metadataFailures.length - 80} more`);
  }
  process.exit(1);
}

if (reductionGroups.length > 0) {
  const reductionCount = countReductions(reductionGroups);
  console.log('Platform dependency debt decreased; consider rebaselining:');
  console.log(
    `Detected ${reductionCount} removed occurrences across ${reductionGroups.length} stable groups.`,
  );
  for (const group of reductionGroups.slice(0, 20)) {
    console.log(
      `  - ${formatGroup(group.group)}: baseline ${group.group.allowedCount}, found ${group.currentCount}, removed ${
        group.group.allowedCount - group.currentCount
      }`,
    );
  }
  if (reductionGroups.length > 20) {
    console.log(`  ... ${reductionGroups.length - 20} more groups`);
  }
}

console.log('Platform dependency guard passed.');
