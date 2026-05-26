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

function exactOccurrenceKey(entry) {
  return `${entry.path}\0${entry.ruleId}\0${entry.line}\0${entry.column}\0${entry.match}`;
}

function stableOccurrenceKey(entry) {
  return `${entry.path}\0${entry.ruleId}\0${entry.match}`;
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

function occurrenceCountsByStableKey(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const key = stableOccurrenceKey(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function takeExistingMetadataEntry(existingByStableKey, currentEntry) {
  const bucket = existingByStableKey.get(stableOccurrenceKey(currentEntry));
  if (!bucket || bucket.length === 0) return null;

  const exactKey = exactOccurrenceKey(currentEntry);
  const exactIndex = bucket.findIndex((entry) => exactOccurrenceKey(entry) === exactKey);
  if (exactIndex >= 0) {
    return bucket.splice(exactIndex, 1)[0];
  }
  return bucket.shift();
}

function existingAllowlistEntries() {
  if (!existsSync(ALLOWLIST_PATH)) return [];
  const existing = loadJsonc(ALLOWLIST_PATH);
  return existing.allowlist ?? [];
}

function migrateLegacyBaseline(current) {
  if (!existsSync(ALLOWLIST_PATH)) return new Map();
  const existing = loadJsonc(ALLOWLIST_PATH);
  const baseline = existing.baseline ?? {};
  const legacy = new Map();
  const remainingByRule = new Map(
    Object.entries(baseline).flatMap(([path, byRule]) =>
      Object.entries(byRule).map(([ruleId, count]) => [`${path}\0${ruleId}`, count]),
    ),
  );
  for (const entry of current) {
    const key = `${entry.path}\0${entry.ruleId}`;
    const remaining = remainingByRule.get(key) ?? 0;
    if (remaining > 0) {
      legacy.set(exactOccurrenceKey(entry), {
        ...entry,
        ...defaultMetadata(entry),
      });
      remainingByRule.set(key, remaining - 1);
    }
  }
  return legacy;
}

function writeAllowlist(current) {
  const existingEntries = existingAllowlistEntries();
  const existingByStableKey = occurrenceBucketsByStableKey(existingEntries);
  const legacyByKey = existingEntries.length === 0 ? migrateLegacyBaseline(current) : new Map();
  const allowlist = sortOccurrences(
    current.map((entry) => {
      const existing =
        takeExistingMetadataEntry(existingByStableKey, entry) ??
        legacyByKey.get(exactOccurrenceKey(entry));
      return {
        ...entry,
        ...(existing
          ? {
              owner: existing.owner,
              reason: existing.reason,
              migrationPlan: existing.migrationPlan,
            }
          : defaultMetadata(entry)),
      };
    }),
  );
  const payload = {
    $schema: './platform-dependency-allowlist.schema.json',
    description:
      'Occurrence-level baseline for direct platform dependency usage. Run `pnpm check:platform-dependencies -- --update` after deliberately reducing or reclassifying debt.',
    rules: Object.fromEntries(
      RULES.map((rule) => [
        rule.id,
        {
          category: rule.category,
          language: rule.language,
        },
      ]),
    ),
    allowlist,
  };
  const header = [
    '// Baseline for tools/check-platform-dependencies.mjs.',
    '// Entries are per matched occurrence. New direct platform dependency',
    '// occurrences are enforced by stable file/rule/match counts so line',
    '// movement does not create false positives.',
    '',
  ].join('\n');
  writeFileSync(ALLOWLIST_PATH, header + JSON.stringify(payload, null, 2) + '\n');
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

const current = sortOccurrences(scan());

if (UPDATE_MODE || !existsSync(ALLOWLIST_PATH)) {
  writeAllowlist(current);
  console.log(`Updated ${relative(ROOT, ALLOWLIST_PATH)} with ${current.length} occurrences.`);
  process.exit(0);
}

const allowlist = loadJsonc(ALLOWLIST_PATH);
if (!Array.isArray(allowlist.allowlist)) {
  console.error(
    'FAIL: platform dependency allowlist must use occurrence-level `allowlist` entries.',
  );
  console.error('Rebaseline with: pnpm check:platform-dependencies -- --update');
  process.exit(1);
}

const failureGroups = [];
const reductionGroups = [];
const metadataFailures = [];
const currentByStableKey = occurrenceBucketsByStableKey(current);
const allowedByStableKey = occurrenceBucketsByStableKey(allowlist.allowlist);
const currentCountsByStableKey = occurrenceCountsByStableKey(current);
const allowedCountsByStableKey = occurrenceCountsByStableKey(allowlist.allowlist);

for (const [key, entries] of currentByStableKey) {
  const allowedCount = allowedCountsByStableKey.get(key) ?? 0;
  if (entries.length > allowedCount) {
    failureGroups.push({ entries, allowedCount });
  }
}

for (const [key, entries] of allowedByStableKey) {
  const currentCount = currentCountsByStableKey.get(key) ?? 0;
  if (entries.length > currentCount) {
    reductionGroups.push({ entries, allowedCount: currentCount });
  }
}

for (const entry of allowlist.allowlist) {
  for (const field of ['owner', 'reason', 'migrationPlan']) {
    if (typeof entry[field] !== 'string' || entry[field].trim() === '' || entry[field] === 'TODO') {
      metadataFailures.push(`${formatOccurrence(entry)} missing ${field}`);
    }
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
  const reductionCount = countOccurrences(reductionGroups);
  console.log('Platform dependency debt decreased; consider rebaselining:');
  console.log(
    `Detected ${reductionCount} removed occurrences across ${reductionGroups.length} stable groups.`,
  );
  for (const group of reductionGroups.slice(0, 20)) {
    const representative = group.entries[0];
    const removedEntries = group.entries.slice(group.allowedCount);
    console.log(
      `  - ${representative.path} ${representative.ruleId} ${JSON.stringify(
        representative.match,
      )}: baseline ${group.entries.length}, found ${group.allowedCount}, removed ${removedEntries.length}`,
    );
    for (const entry of removedEntries.slice(0, 3)) {
      console.log(`      baseline at ${formatOccurrenceLocation(entry)}`);
    }
    if (removedEntries.length > 3) {
      console.log(`      ... ${removedEntries.length - 3} more baseline locations in this group`);
    }
  }
  if (reductionGroups.length > 20) {
    console.log(`  ... ${reductionGroups.length - 20} more groups`);
  }
}

console.log('Platform dependency guard passed.');
