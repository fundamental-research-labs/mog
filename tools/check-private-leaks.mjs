#!/usr/bin/env node
/**
 * Public-repo private leak scanner.
 *
 * This gate catches committed references to private corpus provenance, sibling
 * internal repos, local developer paths, and private workbook-derived test
 * names. Keep exact sensitive identifiers out of this file; pass them through
 * MOG_PRIVATE_LEAK_PATTERNS as an untracked newline-delimited regex file.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = relative(ROOT, fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const MAX_TEXT_BYTES = 8 * 1024 * 1024;

const SKIP_DIR_PARTS = new Set([
  '.git',
  '.claude',
  '.codex',
  '.codex-batch',
  '.next',
  '.turbo',
  'artifacts',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'target-native',
  'target-wasm',
]);

const DATA_EXTENSIONS = new Set([
  '.csv',
  '.duckdb',
  '.parquet',
  '.sqlite',
  '.xls',
  '.xlsm',
  '.xlsx',
  '.zip',
]);

const ALLOWED_DATA_PATHS = [
  /^file-io\/xlsx\/parser\/test-corpus\//,
  /^runtime\/embed\/public\/showcase\.xlsx$/,
];

const HARD_PATTERNS = [
  {
    name: 'private-repo-path',
    regex: /\bmog-(?:internal|data)\b/i,
    hint: 'Do not reference private sibling repos from public code; use generic external-fixture wording.',
  },
  {
    name: 'local-absolute-path',
    regex:
      /(^|[\s"'(])(?:\/Users\/[^\s"'`),;]+|\/home\/[^/\s"'`),;]+\/(?:Code\/)?(?:mog-all|mog-internal|mog-data)\b[^\s"'`),;]*)/,
    hint: 'Replace local absolute paths with env vars or repo-relative public paths.',
  },
  {
    name: 'internal-eval-path',
    regex: /\b(?:dev\/app-eval|app-eval\/(?:audit|capture|scenarios|scripts))\b/i,
    hint: 'Public code should say eval harness or scenario coverage, not name private harness paths.',
  },
  {
    name: 'private-corpus-provenance',
    regex: /\b(?:private|internal|workspace-internal)\s+(?:xlsx\s+)?corpus\b/i,
    hint: 'Remove corpus provenance or move the reducer/test to the private repo.',
  },
  {
    name: 'private-workbook-provenance',
    regex: /\b(?:customer|client|proprietary)\s+(?:xlsx\s+)?workbook\b|\breal customer\b/i,
    hint: 'Replace private workbook provenance with synthetic fixture wording.',
  },
  {
    name: 'private-finding-reference',
    regex: /\b(?:FINDINGS\.md|feedback_no_ignored_tests|MOG_USER_FEEDBACK[A-Z0-9_]*|shortcut_mono)\b/i,
    hint: 'Do not reference private findings, feedback fixture dirs, or private environment names.',
  },
  {
    name: 'private-fixture-filename',
    regex: /\bgolden[_-]?(?:lbo|fpa)\b/i,
    hint: 'Use neutral fixture names such as sample-model or optional domain fixture.',
  },
];

const CONTEXT_KEYWORDS =
  /\b(?:benchmark|captured|corpus|external ref|fixture|formula|harness|local_sheets|make_local_sheets|reducer|sheet|workbook|xlsx)\b/i;

const CONTEXTUAL_PATTERNS = [
  {
    name: 'private-turn-reference',
    regex: /\b(?:[a-z][a-z0-9]{2,}_turn\d+|turn\d+|run-\d{2,})\b/i,
    hint: 'Do not commit private run or agent-turn handles.',
  },
  {
    name: 'business-specific-gaap-sheet',
    regex: /\b[A-Z]{2,}-GAAP\b/,
    hint: 'Use synthetic sheet names such as SourceData or Source-GAAP.',
  },
  {
    name: 'business-specific-comps-sheet',
    regex: /\b(?:Public|Trading|Transaction)\s+Comps\b/,
    hint: 'Use synthetic sheet names such as Peer Analysis.',
  },
  {
    name: 'business-specific-finance-sheet',
    regex:
      /\b(?:Debt|Forecasted|Loan|Revenue|Rev|Unit|Units)\s+(?:Bridge|Build|Details|Schedule|Store|Summary|By Store)\b/i,
    hint: 'Use generic synthetic sheet names instead of private workbook sheet labels.',
  },
  {
    name: 'private-derived-coordinate-note',
    regex:
      /\b(?:captured|copied|derived|mirrors|ported|reduced|from the|exact(?: formula)?(?: pattern)? from)\b.{0,80}\b(?:private|internal corpus|workspace-internal|real-world corpus|corpus (?:failures|that|pattern)|run-\d{2,}|turn\d+)\b/i,
    hint: 'State the behavior under test without naming private provenance.',
  },
];

const ALLOWLIST = [
  {
    path: 'AGENTS.md',
    regex: /\bmog-internal\b/,
    reason: 'Repository boundary policy text.',
  },
];

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

function collectFiles() {
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(`git ls-files failed:\n${result.stderr || result.stdout}`);
  }

  return result.stdout
    .split('\0')
    .filter(Boolean)
    .map(normalizePath)
    .filter((path) => path !== SELF)
    .filter((path) => !path.split('/').some((part) => SKIP_DIR_PARTS.has(part)))
    .sort();
}

function isAllowedDataPath(path) {
  return ALLOWED_DATA_PATHS.some((regex) => regex.test(path));
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

function isAllowed(path, line, patternName) {
  return ALLOWLIST.some((entry) => {
    if (entry.path !== path) return false;
    if (entry.patternName && entry.patternName !== patternName) return false;
    return entry.regex.test(line);
  });
}

function makeFinding(path, lineNumber, pattern, line, target = 'content') {
  return {
    path,
    lineNumber,
    category: pattern.name,
    hint: pattern.hint,
    target,
    line: line.trim().slice(0, 240),
  };
}

function scanText(path, text, externalPatterns) {
  const findings = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    for (const pattern of HARD_PATTERNS) {
      if (pattern.regex.test(line) && !isAllowed(path, line, pattern.name)) {
        findings.push(makeFinding(path, lineNumber, pattern, line));
      }
    }

    for (const pattern of externalPatterns) {
      if (pattern.regex.test(line) && !isAllowed(path, line, pattern.name)) {
        findings.push(makeFinding(path, lineNumber, pattern, line));
      }
    }

    const context = [lines[index - 1] ?? '', line, lines[index + 1] ?? ''].join('\n');
    if (!CONTEXT_KEYWORDS.test(context)) continue;

    for (const pattern of CONTEXTUAL_PATTERNS) {
      if (pattern.regex.test(line) && !isAllowed(path, line, pattern.name)) {
        findings.push(makeFinding(path, lineNumber, pattern, line));
      }
    }

    const opaqueRegression = /\bregression_([a-z0-9]{6,})\b/.exec(line);
    if (opaqueRegression && /\d/.test(opaqueRegression[1]) && CONTEXT_KEYWORDS.test(context)) {
      findings.push(
        makeFinding(
          path,
          lineNumber,
          {
            name: 'opaque-corpus-regression-name',
            hint: 'Rename corpus-derived regression handles to descriptive synthetic names.',
          },
          line,
        ),
      );
    }
  }

  return findings;
}

function scanPath(path, externalPatterns) {
  const findings = [];
  const fakeLine = path;

  for (const pattern of HARD_PATTERNS) {
    if (pattern.regex.test(fakeLine) && !isAllowed(path, fakeLine, pattern.name)) {
      findings.push(makeFinding(path, 0, pattern, fakeLine, 'path'));
    }
  }

  for (const pattern of externalPatterns) {
    if (pattern.regex.test(fakeLine) && !isAllowed(path, fakeLine, pattern.name)) {
      findings.push(makeFinding(path, 0, pattern, fakeLine, 'path'));
    }
  }

  const ext = extname(path).toLowerCase();
  if (DATA_EXTENSIONS.has(ext) && !isAllowedDataPath(path)) {
    findings.push({
      path,
      lineNumber: 0,
      category: 'unapproved-data-fixture',
      target: 'path',
      line: path,
      hint:
        'Move private data files out of the public repo, or add a narrow public fixture allowlist entry with provenance.',
    });
  }

  return findings;
}

function loadExternalPatterns() {
  const patternFile = process.env.MOG_PRIVATE_LEAK_PATTERNS;
  if (!patternFile) return [];

  const absolute = resolve(ROOT, patternFile);
  const text = readFileSync(absolute, 'utf8');

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((pattern, index) => ({
      name: `external-private-pattern-${index + 1}`,
      regex: new RegExp(pattern, 'i'),
      hint: 'Matched private pattern supplied by MOG_PRIVATE_LEAK_PATTERNS.',
    }));
}

function scanRepository() {
  const externalPatterns = loadExternalPatterns();
  const findings = [];

  for (const path of collectFiles()) {
    const absolute = resolve(ROOT, path);
    if (!existsSync(absolute)) continue;

    findings.push(...scanPath(path, externalPatterns));

    const stat = statSync(absolute);
    if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) continue;

    const buffer = readFileSync(absolute);
    if (looksBinary(buffer)) continue;

    findings.push(...scanText(path, buffer.toString('utf8'), externalPatterns));
  }

  findings.sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) return byPath;
    return a.lineNumber - b.lineNumber || a.category.localeCompare(b.category);
  });

  return findings;
}

function formatFinding(finding) {
  const loc = finding.lineNumber > 0 ? `${finding.path}:${finding.lineNumber}` : finding.path;
  return [
    `${loc} [${finding.category}]`,
    `  ${finding.line}`,
    `  ${finding.hint}`,
  ].join('\n');
}

function runSelfTest() {
  const externalPatterns = [];
  const blocked = [
    ['test.rs', '// From source_turn6 benchmark.'],
    ['test.rs', 'let locals = make_local_sheets(&["SOURCE-GAAP"]);'],
    ['test.rs', 'fn regression_ib6cymnt() {} // corpus reducer'],
    ['test.ts', 'const p = "/Users/name/Code/mog-all/mog-data/corpus/model.xlsx";'],
    ['test.ts', '// derived from customer workbook row 12'],
  ];
  const allowed = [
    ['test.rs', '// Gated by corpus-tests; set MOG_XLSX_CORPUS_DIR externally.'],
    ['test.rs', 'fn regression_fullcol_bbox_extent_miss() {}'],
    ['test.rs', 'let sheets = ["SourceData", "Dest"];'],
    ['test.ts', 'const label = "external XLSX fixture path";'],
  ];

  for (const [path, line] of blocked) {
    const findings = [...scanPath(path, externalPatterns), ...scanText(path, line, externalPatterns)];
    if (findings.length === 0) {
      throw new Error(`self-test expected blocked line to fail: ${line}`);
    }
  }

  for (const [path, line] of allowed) {
    const findings = [...scanPath(path, externalPatterns), ...scanText(path, line, externalPatterns)];
    if (findings.length !== 0) {
      throw new Error(`self-test expected allowed line to pass: ${line}`);
    }
  }

  console.log('check:private-leaks self-test PASSED');
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const findings = scanRepository();

if (findings.length > 0) {
  console.error(`check:private-leaks FAILED -- ${findings.length} private leak candidate(s):\n`);
  console.error(findings.map(formatFinding).join('\n\n'));
  console.error(
    '\nReplace private provenance with synthetic names, move private reducers to the internal repo, or add a narrow allowlist entry with owner/reason.',
  );
  process.exit(1);
}

console.log('check:private-leaks PASSED -- no private corpus or local-path markers found.');
