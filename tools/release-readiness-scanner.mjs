#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TERM_PATTERNS = [
  ['SmartArt', /\bSmartArt\b/g],
  ['WordArt', /\bWordArt\b/g],
  ['Office Themes', /\bOffice Themes\b/g],
  ['Excel parity', /\bExcel parity\b/g],
  ['Excel-parity', /\bExcel-parity\b/g],
  ['Excel-compatible', /\bExcel-compatible\b/gi],
  ['Excel-style', /\bExcel-style\b/gi],
  ['OfficeJS', /\bOfficeJS\b/g],
  ['full Excel-compatible', /\bfull Excel-compatible\b/gi],
  ['OfficeJS-compatible', /\bOfficeJS-compatible\b/g],
  ['OfficeJS equivalent', /\bOfficeJS\s+equivalent\b/g],
  ['Excel-style ribbon', /\bExcel-style ribbon\b/gi],
  ['Excel-style backstage', /\bExcel-style backstage\b/gi],
  ['Backstage', /\bBackstage\b/g],
  ['Ribbon', /\bRibbon\b/g],
];

const DEFAULT_ROOTS = [
  'TRADEMARKS.md',
  'docs/README.md',
  'docs/ARCHITECTURE.md',
  'docs/guides',
  'docs/os',
  'docs/reference',
  'docs/spreadsheet',
  'docs/ui-design',
  'docs/generated',
  'examples',
  'runtime/sdk/package.json',
  'runtime/sdk/llms.txt',
  'runtime/sdk/src/generated',
  'runtime/embed/package.json',
  'runtime/spreadsheet-app/package.json',
  'runtime/spreadsheet-app/src',
];

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.txt',
]);

const SKIP_DIRS = new Set([
  '.git',
  '.turbo',
  '.next',
  'build',
  'dist',
  'node_modules',
  'target',
  'target-native',
  'target-wasm',
]);

export function scanReleaseReadiness(options = {}) {
  const root = resolve(options.root ?? ROOT);
  const roots = options.paths?.length ? options.paths : DEFAULT_ROOTS;
  const files = discoverFiles(root, roots);
  const hits = [];

  for (const file of files) {
    const relPath = toPosix(relative(root, file));
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const headingByLine = nearestHeadings(lines);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const lineNumber = lineIndex + 1;
      const line = lines[lineIndex] ?? '';
      for (const [term, pattern] of TERM_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(line))) {
          const classification = classifyHit({
            path: relPath,
            line,
            lineNumber,
            term,
            heading: headingByLine[lineNumber] ?? '',
          });

          hits.push({
            path: relPath,
            line: lineNumber,
            term,
            classification,
            text: truncate(line.trim()),
          });
        }
      }
    }
  }

  hits.sort(
    (a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.term.localeCompare(b.term),
  );

  return {
    hits,
    blockingHits: hits.filter((hit) => hit.classification.startsWith('blocked:')),
  };
}

export function classifyHit({ path, line, term, heading = '' }) {
  const normalizedPath = toPosix(path);
  const context = `${heading}\n${line}`;
  const lowerContext = context.toLowerCase();

  if (isFileFormatPath(normalizedPath)) {
    return 'allowed:file-format-path';
  }

  if (isRoundTripOrFidelityPath(normalizedPath)) {
    return 'allowed:fidelity-or-roundtrip';
  }

  if (isXlsxCompatibilityTest(normalizedPath)) {
    return 'allowed:xlsx-compatibility-test';
  }

  if (isCompatibilityDocHeading(heading)) {
    return 'allowed:compatibility-doc-section';
  }

  if ((term === 'SmartArt' || term === 'WordArt') && /\bOOXML\b/.test(context)) {
    return 'allowed:ooxml-mapping-context';
  }

  if (normalizedPath === 'TRADEMARKS.md') {
    return 'allowed:trademark-guidance';
  }

  if (isGeneratedApiReferenceIdentifier(normalizedPath, line)) {
    return 'review:generated-api-identifier-or-definition';
  }

  if (isInternalArchitectureDoc(normalizedPath)) {
    return 'review:internal-architecture-doc';
  }

  if (isGeneratedApiReference(normalizedPath)) {
    return 'blocked:public-generated-reference';
  }

  if (normalizedPath.endsWith('/package.json') || normalizedPath === 'package.json') {
    return 'blocked:public-package-surface';
  }

  if (normalizedPath.startsWith('runtime/spreadsheet-app/src/')) {
    return 'blocked:public-ux-or-runtime-surface';
  }

  if (
    normalizedPath.startsWith('docs/') ||
    normalizedPath.endsWith('/README.md') ||
    normalizedPath.endsWith('/llms.txt')
  ) {
    if (lowerContext.includes('file-format') || lowerContext.includes('import/export')) {
      return 'review:compatibility-context';
    }
    return 'blocked:public-doc-surface';
  }

  return 'review:unclassified-public-surface';
}

function discoverFiles(root, roots) {
  const files = [];
  for (const entry of roots) {
    const abs = resolve(root, entry);
    if (!existsSync(abs)) continue;
    collectFiles(abs, files);
  }
  return files;
}

function collectFiles(path, files) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    const base = path.split(/[\\/]/).pop();
    if (SKIP_DIRS.has(base)) return;
    for (const child of readdirSync(path)) {
      collectFiles(join(path, child), files);
    }
    return;
  }

  if (!stat.isFile()) return;
  if (!TEXT_EXTENSIONS.has(extname(path))) return;
  files.push(path);
}

function nearestHeadings(lines) {
  const headings = {};
  let current = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) current = heading[1];
    headings[index + 1] = current;
  }
  return headings;
}

function isFileFormatPath(path) {
  return path.startsWith('file-io/') || path.startsWith('compute/');
}

function isRoundTripOrFidelityPath(path) {
  return /\b(round-?trip|fidelity)\b/i.test(path);
}

function isXlsxCompatibilityTest(path) {
  return (
    /(^|\/)(__tests__|test|tests|e2e)(\/|$)/.test(path) &&
    /\b(xlsx|excel|ooxml|compat|fidelity|round-?trip)\b/i.test(path)
  );
}

function isCompatibilityDocHeading(heading) {
  return /\b(import\/export compatibility|file-format compatibility|xlsx compatibility|ooxml compatibility)\b/i.test(
    heading,
  );
}

function isGeneratedApiReferenceIdentifier(path, line) {
  return (
    isGeneratedApiReference(path) &&
    (/"(name|signature)"\s*:/.test(line) ||
      (/"definition"\s*:/.test(line) && !line.includes('/**')) ||
      /"[^"]*(smartArt|wordArt)[^"]*"\s*:/.test(line))
  );
}

function isInternalArchitectureDoc(path) {
  return (
    path === 'docs/ARCHITECTURE.md' ||
    path.startsWith('docs/spreadsheet/') ||
    path.startsWith('docs/ui-design/')
  );
}

function isGeneratedApiReference(path) {
  return (
    path === 'docs/generated/api-reference.json' || path.startsWith('runtime/sdk/src/generated/')
  );
}

function toPosix(path) {
  return path.replaceAll('\\', '/');
}

function truncate(text, maxLength = 240) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function parseArgs(argv) {
  const args = {
    json: false,
    paths: [],
    root: ROOT,
    strict: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--no-strict') {
      args.strict = false;
    } else if (arg === '--strict') {
      args.strict = true;
    } else if (arg === '--root') {
      args.root = argv[++index];
    } else if (arg === '--path') {
      args.paths.push(argv[++index]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function formatTextReport(result) {
  if (result.hits.length === 0) {
    return 'Release-readiness scanner found no risky Microsoft UX/docs naming terms.';
  }

  const lines = [
    `Release-readiness scanner found ${result.hits.length} hit(s), ${result.blockingHits.length} blocking.`,
  ];

  for (const hit of result.hits) {
    lines.push(`${hit.path}:${hit.line}: ${hit.term} [${hit.classification}] ${hit.text}`);
  }

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = scanReleaseReadiness(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatTextReport(result)}\n`);
  }

  if (args.strict && result.blockingHits.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
