#!/usr/bin/env node

import {
  existsSync,
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_MANIFEST_PATH = 'tools/public-source/public-source-manifest.jsonc';

const DEFAULT_EXCLUDED_PATHS = ['.claude', 'AGENTS.md', 'agents/skills', 'dev', 'output', 'plans'];

const DEFAULT_BUILD_OUTPUT_DIRS = [
  '.next',
  'artifacts',
  'coverage',
  'dist',
  'node_modules',
  'pkg',
  'target',
  'target-native',
  'target-wasm',
];

const DEFAULT_BUILD_OUTPUT_FILE_PATTERNS = ['*.map', '*.tsbuildinfo', '.DS_Store'];

const DEFAULT_SOURCE_BINARY_EXTENSIONS = [
  '.a',
  '.bin',
  '.dll',
  '.dylib',
  '.exe',
  '.lib',
  '.node',
  '.o',
  '.rlib',
  '.so',
  '.wasm',
];

const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cfg',
  '.cjs',
  '.cmake',
  '.cpp',
  '.css',
  '.csv',
  '.cts',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.lock',
  '.md',
  '.mjs',
  '.mts',
  '.py',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const TEXT_BASENAMES = new Set([
  '.dockerignore',
  '.editorconfig',
  '.env.example',
  '.env.sample',
  '.env.template',
  '.gitattributes',
  '.gitignore',
  '.npmignore',
  '.nvmrc',
  'Cargo.lock',
  'Dockerfile',
  'LICENSE',
  'NOTICE',
  'README',
  'TRADEMARKS.md',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
]);

const PRIVATE_REPO_NAME = ['mog', 'internal'].join('-');
const PRIVATE_REPO_OWNER = 'fundamental-research-labs';
const PRIVATE_REPO_SLUG = [PRIVATE_REPO_OWNER, PRIVATE_REPO_NAME].join('/');
const PRIVATE_UPSTREAM_SLUG = ['lyfegame', 'shortcut'].join('/');
const PRIVATE_PACKAGE_SCOPE = `@${PRIVATE_REPO_OWNER}/`;
const PRIVATE_GITHUB_PACKAGES_HOST = ['npm', 'pkg', 'github', 'com'].join('.');
const PRIVATE_GHCR_HOST = ['ghcr', 'io'].join('.');

const PRIVATE_TERM_PATTERNS = [
  {
    term: PRIVATE_REPO_SLUG,
    pattern: new RegExp(`\\b${escapeRegExp(PRIVATE_REPO_SLUG)}\\b`, 'gi'),
    message: 'Private repository reference remains in public source',
  },
  {
    term: PRIVATE_REPO_NAME,
    pattern: new RegExp(`\\b${escapeRegExp(PRIVATE_REPO_NAME)}\\b`, 'gi'),
    message: 'Private repository name remains in public source',
  },
  {
    term: PRIVATE_UPSTREAM_SLUG,
    pattern: new RegExp(`\\b${escapeRegExp(PRIVATE_UPSTREAM_SLUG)}\\b`, 'gi'),
    message: 'Private upstream repository reference remains in public source',
  },
  {
    term: PRIVATE_GITHUB_PACKAGES_HOST,
    pattern: new RegExp(`\\b${escapeRegExp(PRIVATE_GITHUB_PACKAGES_HOST)}\\b`, 'gi'),
    message: 'Private GitHub Packages registry reference remains in public source',
  },
  {
    term: `${PRIVATE_PACKAGE_SCOPE}*`,
    pattern: new RegExp(
      `${escapeRegExp(PRIVATE_PACKAGE_SCOPE.slice(0, -1))}(?:/[a-z0-9._-]+)?`,
      'gi',
    ),
    message: 'Private package scope remains in public source',
  },
  {
    term: `${PRIVATE_GHCR_HOST} private path`,
    pattern: new RegExp(
      `\\b${escapeRegExp(PRIVATE_GHCR_HOST)}/(?:${escapeRegExp(PRIVATE_REPO_OWNER)}/[a-z0-9._/-]*|[a-z0-9._/-]*${escapeRegExp(PRIVATE_REPO_NAME)}[a-z0-9._/-]*)`,
      'gi',
    ),
    message: 'Private GHCR image path remains in public source',
  },
];

const FORBIDDEN_PATH_REFERENCE_PATTERNS = [
  {
    term: pathReferenceTerm('dev'),
    pattern: /(^|[^A-Za-z0-9_.-/])((?:\.{1,2}\/)*dev\/)/g,
  },
  {
    term: pathReferenceTerm('plans'),
    pattern: /(^|[^A-Za-z0-9_.-/])((?:\.{1,2}\/)*plans\/)/g,
  },
  {
    term: pathReferenceTerm('.claude'),
    pattern: /(^|[^A-Za-z0-9_.-/])((?:\.{1,2}\/)*\.claude\/)/g,
  },
  {
    term: `${pathReferenceTerm('agents').slice(0, -1)}/${pathReferenceTerm('skills')}`,
    pattern: /(^|[^A-Za-z0-9_.-/])((?:\.{1,2}\/)*agents\/skills\/)/g,
  },
];

const ABSOLUTE_LOCAL_PATH_PATTERNS = [
  {
    term: '/Users/<user>/...',
    pattern: /(?:file:\/\/)?\/Users\/[A-Za-z0-9._-]+(?:\/[^\s"'`)<\]}]*)?/g,
  },
  {
    term: '/home/<user>/...',
    pattern: /(?:file:\/\/)?\/home\/[A-Za-z0-9._-]+(?:\/[^\s"'`)<\]}]*)?/g,
  },
  {
    term: '/Volumes/...',
    pattern: /\/Volumes\/[^\s"'`)<\]}]+/g,
  },
  {
    term: '/private/var/folders/...',
    pattern: /\/private\/var\/folders\/[^\s"'`)<\]}]+/g,
  },
  {
    term: 'C:\\Users\\<user>\\...',
    pattern: /\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\s"'`<>|]+/g,
  },
];

const FINDING_CATEGORY_ORDER = [
  'manifest',
  'excluded-path',
  'nested-build-output',
  'source-binary',
  'symlink-escape',
  'private-term',
  'forbidden-path-reference',
  'absolute-local-path',
];

export function scanPublicSourceHygiene(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    throw new Error(`Projected repo root is not a directory: ${root}`);
  }

  const manifestPath = resolve(options.manifestPath ?? resolve(root, DEFAULT_MANIFEST_PATH));
  const findings = [];
  const manifestState = loadManifestState(root, manifestPath, findings);
  const rules = buildRules(manifestState.manifest, options);
  const stats = {
    directoriesScanned: 0,
    filesScanned: 0,
    symlinksScanned: 0,
    textFilesScanned: 0,
  };

  const rootRealPath = realpathSync.native(root);
  walkDirectory({
    root,
    rootRealPath,
    dir: root,
    rules,
    findings,
    stats,
  });

  const sortedFindings = sortFindings(dedupeFindings(findings));
  return {
    status: sortedFindings.length === 0 ? 'passed' : 'failed',
    manifest: {
      loaded: manifestState.loaded,
      path: manifestState.loaded ? toPosix(relative(root, manifestPath)) : null,
    },
    stats,
    findings: sortedFindings,
    blockingFindings: sortedFindings,
  };
}

export function formatTextReport(result) {
  const lines = [];
  lines.push(`public-source hygiene: ${result.status}`);
  lines.push(`manifest: ${result.manifest.loaded ? result.manifest.path : '<none>'}`);
  lines.push(`directories scanned: ${result.stats.directoriesScanned}`);
  lines.push(`files scanned: ${result.stats.filesScanned}`);
  lines.push(`text files scanned: ${result.stats.textFilesScanned}`);
  lines.push(`symlinks scanned: ${result.stats.symlinksScanned}`);
  lines.push(`blocking findings: ${result.blockingFindings.length}`);

  if (result.blockingFindings.length > 0) {
    lines.push('');
  }

  for (const finding of result.blockingFindings) {
    const location = finding.line ? `${finding.path}:${finding.line}` : finding.path;
    lines.push(`[${finding.category}] ${location}`);
    lines.push(`  ${finding.message}`);
    if (finding.term) {
      lines.push(`  term: ${finding.term}`);
    }
    if (finding.excerpt) {
      lines.push(`  text: ${finding.excerpt}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function parseJsonc(raw) {
  return JSON.parse(removeTrailingJsonCommas(stripJsonComments(raw)));
}

function loadManifestState(root, manifestPath, findings) {
  if (!existsSync(manifestPath)) {
    return { loaded: false, manifest: null };
  }

  try {
    return {
      loaded: true,
      manifest: parseJsonc(readFileSync(manifestPath, 'utf8')),
    };
  } catch (error) {
    addFinding(findings, {
      category: 'manifest',
      path: toPosix(relative(root, manifestPath)),
      message: `Failed to parse public source manifest: ${error.message}`,
    });
    return { loaded: true, manifest: null };
  }
}

function buildRules(manifest, options = {}) {
  const containers = [manifest, isObject(manifest?.hygiene) ? manifest.hygiene : null];
  return {
    ignoreInstalledDependencies: Boolean(options.ignoreInstalledDependencies),
    excludedPaths: [
      ...DEFAULT_EXCLUDED_PATHS,
      ...stringValues(containers, [
        'excludeAlways',
        'excluded',
        'excludedPathPatterns',
        'excludedPaths',
        'excludePaths',
      ]),
    ],
    buildOutputDirs: new Set([
      ...DEFAULT_BUILD_OUTPUT_DIRS,
      ...stringValues(containers, ['buildOutputDirs', 'nestedBuildOutputDirs']),
    ]),
    buildOutputFilePatterns: [
      ...DEFAULT_BUILD_OUTPUT_FILE_PATTERNS,
      ...stringValues(containers, ['buildOutputFilePatterns', 'nestedBuildOutputFilePatterns']),
    ],
    sourceBinaryExtensions: new Set([
      ...DEFAULT_SOURCE_BINARY_EXTENSIONS,
      ...stringValues(containers, [
        'forbiddenSourceBinaryExtensions',
        'sourceBinaryExtensions',
      ]).map((ext) => (ext.startsWith('.') ? ext : `.${ext}`)),
    ]),
    allowedFindings: normalizeFindingAllowRules(
      valuesForKeys(containers, ['allowedFindings', 'allowedHygieneFindings']),
    ),
    allowedExcludedPaths: normalizePathAllowRules(
      valuesForKeys(containers, ['allowedExcludedPaths']),
    ),
    allowedBuildOutputPaths: normalizePathAllowRules(
      valuesForKeys(containers, ['allowedBuildOutputPaths', 'allowedNestedBuildOutputPaths']),
    ),
    allowedSourceBinaryPaths: normalizePathAllowRules(
      valuesForKeys(containers, [
        'allowedBinaryPaths',
        'allowedSourceBinaries',
        'allowedSourceBinaryPaths',
        'sourceBinaryAllowlist',
        'allowedBinaryArtifacts',
      ]),
    ),
    allowedPrivateTerms: [
      ...normalizeTextAllowRules(
        valuesForKeys(containers, [
          'allowedPrivateReferences',
          'allowedPrivateTerms',
          'allowedRemainingPrivateLookingTerms',
        ]),
      ),
      ...normalizePathAllowRules(valuesForKeys(containers, ['allowedPrivateTermGlobs'])),
    ],
    allowedForbiddenPathReferences: [
      ...normalizeTextAllowRules(
        valuesForKeys(containers, ['allowedForbiddenPathReferences', 'allowedPathReferences']),
      ),
      ...normalizePathAllowRules(
        valuesForKeys(containers, [
          'allowedForbiddenPathReferenceGlobs',
          'allowedPrivateTermGlobs',
        ]),
      ),
    ],
    allowedAbsoluteLocalPaths: normalizeTextAllowRules(
      valuesForKeys(containers, [
        'allowedAbsoluteLocalPathReferences',
        'allowedAbsoluteLocalPaths',
      ]),
    ),
    buildOutputPatterns: stringValues(containers, [
      'buildOutputPatterns',
      'nestedBuildOutputPatterns',
    ]),
    privateTermPatterns: buildPrivateTermPatterns(stringValues(containers, ['privateTerms'])),
    forbiddenPathReferencePatterns: buildForbiddenPathReferencePatterns(
      stringValues(containers, ['forbiddenPathReferences']),
    ),
  };
}

function buildPrivateTermPatterns(extraTerms) {
  const patterns = [...PRIVATE_TERM_PATTERNS];
  const seen = new Set(patterns.map((entry) => entry.term));
  for (const term of extraTerms) {
    if (seen.has(term)) {
      continue;
    }
    patterns.push({
      term,
      pattern: new RegExp(escapeRegExp(term), 'gi'),
      message: 'Private term remains in public source',
    });
    seen.add(term);
  }
  return patterns;
}

function buildForbiddenPathReferencePatterns(extraReferences) {
  const patterns = [...FORBIDDEN_PATH_REFERENCE_PATTERNS];
  const seen = new Set(patterns.map((entry) => entry.term));
  for (const term of extraReferences) {
    if (seen.has(term)) {
      continue;
    }
    patterns.push({
      term,
      pattern: new RegExp(escapeRegExp(term), 'g'),
    });
    seen.add(term);
  }
  return patterns;
}

function walkDirectory(context) {
  const { dir, findings, root, rootRealPath, rules, stats } = context;
  stats.directoriesScanned += 1;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    addFinding(findings, {
      category: 'excluded-path',
      path: toPosix(relative(root, dir)),
      message: `Failed to read path while scanning projected source: ${error.message}`,
    });
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.name === '.git') {
      continue;
    }
    if (rules.ignoreInstalledDependencies && entry.name === 'node_modules') {
      continue;
    }

    const fullPath = resolve(dir, entry.name);
    const relPath = toPosix(relative(root, fullPath));
    let stat;
    try {
      stat = lstatSync(fullPath);
    } catch (error) {
      addFinding(findings, {
        category: 'excluded-path',
        path: relPath,
        message: `Failed to inspect path while scanning projected source: ${error.message}`,
      });
      continue;
    }

    if (stat.isSymbolicLink()) {
      stats.symlinksScanned += 1;
      checkSymlink({ fullPath, relPath, rootRealPath, findings, rules });
      continue;
    }

    const pathDisposition = checkPath({ relPath, name: entry.name, stat, rules, findings });
    if (pathDisposition.skipDescendants) {
      continue;
    }

    if (stat.isDirectory()) {
      walkDirectory({ ...context, dir: fullPath });
      continue;
    }

    if (!stat.isFile()) {
      continue;
    }

    stats.filesScanned += 1;
    checkSourceBinary({ fullPath, relPath, rules, findings });

    const text = readTextIfText(fullPath, entry.name);
    if (text === null) {
      continue;
    }

    stats.textFilesScanned += 1;
    checkText({ relPath, text, rules, findings });
  }
}

function checkPath({ relPath, name, stat, rules, findings }) {
  const disposition = { skipDescendants: false };
  let reportedBuildOutput = false;

  if (
    rules.excludedPaths.some((pattern) => pathMatchesPattern(relPath, pattern)) ||
    isForbiddenEnvFileName(name)
  ) {
    const finding = {
      category: 'excluded-path',
      path: relPath,
      message: `Excluded path is present in projected source: ${relPath}`,
    };
    if (!isAllowedFinding(finding, rules, rules.allowedExcludedPaths)) {
      addFinding(findings, finding);
      disposition.skipDescendants = stat.isDirectory();
    }
  }

  if (stat.isDirectory() && rules.buildOutputDirs.has(name)) {
    const finding = {
      category: 'nested-build-output',
      path: relPath,
      message: `Nested build output directory is present in projected source: ${relPath}`,
    };
    if (!isAllowedFinding(finding, rules, rules.allowedBuildOutputPaths)) {
      addFinding(findings, finding);
      disposition.skipDescendants = true;
      reportedBuildOutput = true;
    }
  }

  if (
    stat.isFile() &&
    rules.buildOutputFilePatterns.some((pattern) => pathMatchesPattern(name, pattern))
  ) {
    const finding = {
      category: 'nested-build-output',
      path: relPath,
      message: `Build output file is present in projected source: ${relPath}`,
    };
    if (!isAllowedFinding(finding, rules, rules.allowedBuildOutputPaths)) {
      addFinding(findings, finding);
      reportedBuildOutput = true;
    }
  }

  if (
    !reportedBuildOutput &&
    rules.buildOutputPatterns.some((pattern) => pathMatchesPattern(relPath, pattern))
  ) {
    const finding = {
      category: 'nested-build-output',
      path: relPath,
      message: `Build output path is present in projected source: ${relPath}`,
    };
    if (!isAllowedFinding(finding, rules, rules.allowedBuildOutputPaths)) {
      addFinding(findings, finding);
      disposition.skipDescendants = stat.isDirectory();
    }
  }

  return disposition;
}

function checkSymlink({ fullPath, relPath, rootRealPath, findings, rules }) {
  const target = readlinkSync(fullPath);
  const resolvedTarget = resolve(dirname(fullPath), target);
  let comparableTarget = resolvedTarget;
  try {
    comparableTarget = realpathSync.native(resolvedTarget);
  } catch {
    // Dangling symlinks are only escape findings when their literal target
    // resolves outside the projected root.
  }

  const finding = {
    category: 'symlink-escape',
    path: relPath,
    message: `Symlink points outside the projected source root: ${relPath}`,
    term: toPosix(target),
  };

  if (!isInsideOrEqual(rootRealPath, comparableTarget) && !isAllowedFinding(finding, rules)) {
    addFinding(findings, finding);
  }
}

function checkSourceBinary({ fullPath, relPath, rules, findings }) {
  const extension = extname(relPath).toLowerCase();
  const buffer = readFirstBytes(fullPath, 16);
  const binaryKind = rules.sourceBinaryExtensions.has(extension)
    ? extension
    : executableBinaryMagic(buffer);

  if (!binaryKind) {
    return;
  }

  const finding = {
    category: 'source-binary',
    path: relPath,
    message: `Forbidden source binary is present in projected source: ${relPath}`,
    term: binaryKind,
  };

  if (!isAllowedFinding(finding, rules, rules.allowedSourceBinaryPaths)) {
    addFinding(findings, finding);
  }
}

function checkText({ relPath, text, rules, findings }) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineNumber = index + 1;

    for (const { term, pattern, message } of rules.privateTermPatterns) {
      pattern.lastIndex = 0;
      if (!pattern.test(line)) {
        continue;
      }
      const finding = textFinding({
        category: 'private-term',
        path: relPath,
        line: lineNumber,
        term,
        message,
        lineText: line,
      });
      if (!isAllowedFinding(finding, rules, rules.allowedPrivateTerms)) {
        addFinding(findings, finding);
      }
    }

    for (const { term, pattern } of rules.forbiddenPathReferencePatterns) {
      pattern.lastIndex = 0;
      if (!pattern.test(line)) {
        continue;
      }
      const finding = textFinding({
        category: 'forbidden-path-reference',
        path: relPath,
        line: lineNumber,
        term,
        message: `Forbidden private path reference remains in public source: ${term}`,
        lineText: line,
      });
      if (!isAllowedFinding(finding, rules, rules.allowedForbiddenPathReferences)) {
        addFinding(findings, finding);
      }
    }

    for (const { term, pattern } of ABSOLUTE_LOCAL_PATH_PATTERNS) {
      pattern.lastIndex = 0;
      if (!pattern.test(line)) {
        continue;
      }
      const finding = textFinding({
        category: 'absolute-local-path',
        path: relPath,
        line: lineNumber,
        term,
        message: `Absolute local path remains in public source: ${term}`,
        lineText: line,
      });
      if (!isAllowedFinding(finding, rules, rules.allowedAbsoluteLocalPaths)) {
        addFinding(findings, finding);
      }
    }
  }
}

function textFinding({ category, path, line, term, message, lineText }) {
  return {
    category,
    path,
    line,
    term,
    message,
    excerpt: truncate(lineText.trim().replace(/\s+/g, ' ')),
  };
}

function addFinding(findings, finding) {
  findings.push({
    severity: 'blocking',
    ...finding,
  });
}

function isAllowedFinding(finding, rules, categoryRules = []) {
  return (
    pathRulesAllow(categoryRules, finding.path) ||
    textRulesAllow(categoryRules, finding) ||
    findingRulesAllow(rules.allowedFindings, finding)
  );
}

function pathRulesAllow(rules, relPath) {
  return rules.some((rule) => rule.path && pathMatchesPattern(relPath, rule.path));
}

function textRulesAllow(rules, finding) {
  return rules.some((rule) => {
    if (rule.category && rule.category !== finding.category) {
      return false;
    }
    if (rule.path && !pathMatchesPattern(finding.path, rule.path)) {
      return false;
    }
    if (rule.term && !textPatternMatches(rule.term, finding.term ?? finding.excerpt ?? '')) {
      return false;
    }
    if (rule.text && !textPatternMatches(rule.text, finding.excerpt ?? '')) {
      return false;
    }
    return Boolean(rule.term || rule.text);
  });
}

function findingRulesAllow(rules, finding) {
  return rules.some((rule) => {
    if (rule.category && rule.category !== finding.category) {
      return false;
    }
    if (rule.path && !pathMatchesPattern(finding.path, rule.path)) {
      return false;
    }
    if (rule.term && !textPatternMatches(rule.term, finding.term ?? finding.excerpt ?? '')) {
      return false;
    }
    if (rule.text && !textPatternMatches(rule.text, finding.excerpt ?? '')) {
      return false;
    }
    return true;
  });
}

function normalizePathAllowRules(values) {
  return values
    .flatMap((value) => normalizeAllowRule(value, { stringField: 'path' }))
    .filter(hasAllowPredicate);
}

function normalizeTextAllowRules(values) {
  return values
    .flatMap((value) => normalizeAllowRule(value, { stringField: 'term' }))
    .filter(hasAllowPredicate);
}

function normalizeFindingAllowRules(values) {
  return values
    .flatMap((value) => normalizeAllowRule(value, { stringField: 'path' }))
    .filter(hasAllowPredicate);
}

function normalizeAllowRule(value, { stringField }) {
  if (typeof value === 'string') {
    return [
      {
        [stringField]: stringField === 'path' ? normalizePatternValue(value) : value,
      },
    ];
  }

  if (!isObject(value)) {
    return [];
  }

  const expanded = [];
  if (Array.isArray(value.paths)) {
    for (const path of value.paths) {
      if (typeof path === 'string') {
        expanded.push({ ...value, path: normalizePatternValue(path) });
      }
    }
  }
  if (Array.isArray(value.terms)) {
    for (const term of value.terms) {
      if (typeof term === 'string') {
        expanded.push({ ...value, term });
      }
    }
  }
  if (expanded.length > 0) {
    return expanded.map(cleanAllowRule);
  }

  return [cleanAllowRule(value)];
}

function cleanAllowRule(rule) {
  const next = {};
  if (typeof rule.category === 'string') next.category = rule.category;
  if (typeof rule.path === 'string') next.path = normalizePatternValue(rule.path);
  if (typeof rule.pattern === 'string' && !next.path)
    next.path = normalizePatternValue(rule.pattern);
  if (typeof rule.term === 'string') next.term = rule.term;
  if (typeof rule.text === 'string') next.text = rule.text;
  return next;
}

function hasAllowPredicate(rule) {
  return Boolean(rule.category || rule.path || rule.term || rule.text);
}

function valuesForKeys(containers, keys) {
  const values = [];
  for (const container of containers) {
    if (!isObject(container)) {
      continue;
    }
    for (const key of keys) {
      const value = container[key];
      if (Array.isArray(value)) {
        values.push(...value);
      } else if (value !== undefined) {
        values.push(value);
      }
    }
  }
  return values;
}

function stringValues(containers, keys) {
  return valuesForKeys(containers, keys).filter((value) => typeof value === 'string');
}

function isForbiddenEnvFileName(name) {
  if (!name.startsWith('.env')) {
    return false;
  }
  return !['.env.example', '.env.sample', '.env.template'].includes(name);
}

function readTextIfText(filePath, name) {
  const extension = extname(name).toLowerCase();
  const sample = readFirstBytes(filePath, 8192);
  if (!TEXT_EXTENSIONS.has(extension) && !TEXT_BASENAMES.has(name) && !looksLikeText(sample)) {
    return null;
  }
  if (!looksLikeText(sample)) {
    return null;
  }
  const buffer = readFileSync(filePath);
  return buffer.toString('utf8');
}

function readFirstBytes(filePath, byteCount) {
  const fd = openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(byteCount);
    const bytesRead = readSync(fd, buffer, 0, byteCount, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

function looksLikeText(buffer) {
  if (buffer.length === 0) {
    return true;
  }

  let suspicious = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      return false;
    }
    if (byte < 7 || (byte > 13 && byte < 32)) {
      suspicious += 1;
    }
  }
  return suspicious / buffer.length < 0.05;
}

function executableBinaryMagic(buffer) {
  if (buffer.length >= 4) {
    if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
      return 'ELF';
    }
    if (buffer[0] === 0x00 && buffer[1] === 0x61 && buffer[2] === 0x73 && buffer[3] === 0x6d) {
      return 'wasm';
    }
    if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
      return 'PE';
    }
    const magic = buffer.readUInt32BE(0);
    if ([0xcafebabe, 0xcafed00d, 0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(magic)) {
      return 'Mach-O';
    }
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).toString('ascii') === '!<arch>\n') {
    return 'ar archive';
  }
  return null;
}

function pathMatchesPattern(relPath, pattern) {
  const normalizedPath = normalizeRelPath(relPath);
  const normalizedPattern = normalizePatternValue(pattern);
  if (normalizedPattern === '') {
    return normalizedPath === '';
  }

  if (!hasGlob(normalizedPattern)) {
    return (
      normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`)
    );
  }

  if (normalizedPattern.endsWith('/**')) {
    const base = normalizedPattern.slice(0, -3);
    return normalizedPath === base || normalizedPath.startsWith(`${base}/`);
  }

  return globToRegExp(normalizedPattern).test(normalizedPath);
}

function globToRegExp(pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === '*' && next === '*') {
      const after = pattern[index + 2];
      if (after === '/') {
        source += '(?:.*\\/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegExp(char);
  }
  source += '$';
  return new RegExp(source);
}

function textPatternMatches(pattern, value) {
  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    const lastSlash = pattern.lastIndexOf('/');
    const source = pattern.slice(1, lastSlash);
    const flags = pattern.slice(lastSlash + 1);
    if (/^[dgimsuvy]*$/u.test(flags)) {
      return new RegExp(source, flags).test(value);
    }
  }
  return value.toLowerCase().includes(pattern.toLowerCase());
}

function normalizePatternValue(pattern) {
  return normalizeRelPath(pattern).replace(/\/+$/u, '');
}

function normalizeRelPath(path) {
  return toPosix(String(path)).replace(/^\.\//u, '');
}

function pathReferenceTerm(path) {
  return `${path}/`;
}

function isInsideOrEqual(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function stripJsonComments(raw) {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < raw.length && raw[index] !== '\n') {
        index += 1;
      }
      output += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < raw.length && !(raw[index] === '*' && raw[index + 1] === '/')) {
        if (raw[index] === '\n') {
          output += '\n';
        }
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function removeTrailingJsonCommas(raw) {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === ',') {
      let probe = index + 1;
      while (/\s/u.test(raw[probe] ?? '')) {
        probe += 1;
      }
      if (raw[probe] === '}' || raw[probe] === ']') {
        continue;
      }
    }

    output += char;
  }

  return output;
}

function dedupeFindings(findings) {
  const byKey = new Map();
  for (const finding of findings) {
    const key = [
      finding.category,
      finding.path,
      finding.line ?? '',
      finding.term ?? '',
      finding.message,
    ].join('\0');
    byKey.set(key, finding);
  }
  return [...byKey.values()];
}

function sortFindings(findings) {
  return [...findings].sort(
    (a, b) =>
      categoryOrder(a.category) - categoryOrder(b.category) ||
      a.path.localeCompare(b.path) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      String(a.term ?? '').localeCompare(String(b.term ?? '')) ||
      a.message.localeCompare(b.message),
  );
}

function categoryOrder(category) {
  const index = FINDING_CATEGORY_ORDER.indexOf(category);
  return index === -1 ? FINDING_CATEGORY_ORDER.length : index;
}

function truncate(value) {
  return value.length <= 180 ? value : `${value.slice(0, 177)}...`;
}

function toPosix(path) {
  return path.replaceAll('\\', '/');
}

function hasGlob(value) {
  return /[*?[\]{}]/u.test(value);
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseCliArgs(argv) {
  const options = { format: 'text', root: null, manifestPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      options.format = 'json';
      continue;
    }
    if (arg === '--ignore-installed-dependencies') {
      options.ignoreInstalledDependencies = true;
      continue;
    }
    if (arg === '--format') {
      index += 1;
      options.format = argv[index];
      continue;
    }
    if (arg.startsWith('--format=')) {
      options.format = arg.slice('--format='.length);
      continue;
    }
    if (arg === '--manifest') {
      index += 1;
      options.manifestPath = resolve(argv[index]);
      continue;
    }
    if (arg.startsWith('--manifest=')) {
      options.manifestPath = resolve(arg.slice('--manifest='.length));
      continue;
    }
    if (arg === '--root') {
      index += 1;
      options.root = resolve(argv[index]);
      continue;
    }
    if (arg.startsWith('--root=')) {
      options.root = resolve(arg.slice('--root='.length));
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (options.root) {
      throw new Error(`Expected one projected repo root, got extra argument: ${arg}`);
    }
    options.root = resolve(arg);
  }

  if (!['json', 'text'].includes(options.format)) {
    throw new Error(`Unsupported output format: ${options.format}`);
  }

  options.root ??= process.cwd();
  return options;
}

function helpText() {
  return `Usage: node tools/public-source/check-public-source-hygiene.mjs [options] [projected-repo-root]

Checks a projected public source tree for blocking private-source hygiene issues.

Options:
  --json                 Emit deterministic JSON instead of text.
  --format text|json     Select output format.
  --root <path>          Projected repo root to inspect.
  --manifest <path>      Override tools/public-source/public-source-manifest.jsonc.
  --ignore-installed-dependencies
                          Ignore node_modules created by package installation.
  -h, --help             Show this help.

Manifest allowances may be placed at the top level or under "hygiene":
  allowedSourceBinaryPaths, allowedPrivateTerms, allowedForbiddenPathReferences,
  allowedAbsoluteLocalPaths, allowedBuildOutputPaths, allowedExcludedPaths,
  allowedFindings.
`;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  const result = scanPublicSourceHygiene(options);
  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(formatTextReport(result));
  }
  if (result.blockingFindings.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
