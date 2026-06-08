/**
 * Gate 3: API surface snapshot checker.
 *
 * For each ship-public package, extracts exported symbols from built .d.ts
 * entry files and compares against committed snapshot files. This catches
 * unintentional public API surface changes.
 *
 * Usage:
 *   node tools/check-api-snapshots.mjs            # verifies and refreshes outside CI
 *   node tools/check-api-snapshots.mjs --update    # regenerate snapshots
 *
 * Exit 0 if snapshots match, snapshots refresh outside CI, or --update mode.
 * Exit 1 if snapshots differ or are missing in CI, or if declaration contracts fail.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { publicDeclarationEntriesFromExports } from './package-export-dispositions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SNAPSHOT_DIR = resolve(__dirname, 'api-snapshots');
const require = createRequire(import.meta.url);
const ts = loadTypeScript();

const updateMode = process.argv.includes('--update');
const ciMode = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const autoUpdateMode = !updateMode && !ciMode;

function loadTypeScript() {
  for (const candidate of [
    'typescript',
    resolve(ROOT, 'kernel/node_modules/typescript'),
    resolve(ROOT, 'runtime/sdk/node_modules/typescript'),
    resolve(ROOT, 'views/sheet-view/node_modules/typescript'),
  ]) {
    try {
      return require(candidate);
    } catch (error) {
      if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('Unable to load TypeScript from root or public-package node_modules.');
}

const REQUIRED_PUBLIC_DECLARATIONS = {
  '@mog-sdk/kernel': [
    {
      entry: 'dist/index.d.ts',
      kind: 'const',
      name: 'createWorkbook',
      forbidden: [/\bPromise<unknown>\b/, /\(\.\.\.args:\s*readonly unknown\[\]\)/],
    },
    {
      entry: 'dist/index.d.ts',
      kind: 'const',
      name: 'DocumentFactory',
      forbidden: [
        /\bRecord<string,\s*unknown>\b/,
        /\bsource:\s*unknown\b/,
        /\boptions:\s*unknown\b/,
      ],
    },
    {
      entry: 'dist/index.d.ts',
      kind: 'const',
      name: 'MogDocumentFactory',
      forbidden: [/\bunknown\b/],
    },
    {
      entry: 'dist/index.d.ts',
      kind: 'type',
      name: 'Workbook',
      forbidden: [/=\s*unknown\b/],
    },
    {
      entry: 'dist/index.d.ts',
      kind: 'type',
      name: 'Worksheet',
      forbidden: [/=\s*unknown\b/],
    },
    {
      entry: 'dist/index.d.ts',
      kind: 'type',
      name: 'DocumentHandle',
      forbidden: [/=\s*unknown\b/, /\bid\?:\s*string\b/],
    },
    {
      entry: 'dist/index.d.ts',
      kind: 'type',
      name: 'MogDocument',
      forbidden: [/=\s*unknown\b/],
    },
    {
      entry: 'dist/index.d.ts',
      kind: 'type',
      name: 'IMogDocumentFactory',
      forbidden: [/=\s*unknown\b/],
    },
    {
      entry: 'dist/index.d.ts',
      kind: 'type',
      name: 'MogDocumentCreateOptions',
      forbidden: [/=\s*unknown\b/, /\bRecord<string,\s*unknown>\b/],
    },
    {
      entry: 'dist/index.d.ts',
      kind: 'type',
      name: 'WorkbookSnapshot',
      forbidden: [/=\s*unknown\b/, /readonly unknown\[\]/],
    },
    {
      entry: 'dist/index.d.ts',
      kind: 'type',
      name: 'CellData',
      forbidden: [/=\s*unknown\b/],
    },
    {
      entry: 'dist/index.d.ts',
      kind: 'type',
      name: 'CellFormat',
      forbidden: [/=\s*unknown\b/],
    },
  ],
};

function parseJsonc(filePath) {
  const source = readFileSync(filePath, 'utf-8');
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(stripped);
}

function parseWorkspacePatterns() {
  const source = readFileSync(resolve(ROOT, 'pnpm-workspace.yaml'), 'utf-8');
  const patterns = [];
  let inPackages = false;

  for (const line of source.split('\n')) {
    if (/^\S/.test(line)) {
      inPackages = line.trim() === 'packages:';
      continue;
    }
    if (!inPackages) continue;

    const match = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
    if (match) patterns.push(match[1]);
  }

  return patterns;
}

function expandWorkspacePattern(pattern) {
  if (!pattern.includes('*')) return [resolve(ROOT, pattern)];

  const parts = pattern.split('/');
  let dirs = [ROOT];

  for (const part of parts) {
    if (part === '*') {
      dirs = dirs.flatMap((dir) => {
        if (!existsSync(dir)) return [];
        return readdirSync(dir)
          .map((entry) => join(dir, entry))
          .filter((entryPath) => statSync(entryPath).isDirectory());
      });
    } else {
      dirs = dirs.map((dir) => join(dir, part));
    }
  }

  return dirs;
}

function discoverWorkspacePackages() {
  const packages = new Map();

  for (const pattern of parseWorkspacePatterns()) {
    for (const packageDir of expandWorkspacePattern(pattern)) {
      const manifestPath = join(packageDir, 'package.json');
      if (!existsSync(manifestPath)) continue;

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (manifest.name) {
        packages.set(manifest.name, { dir: packageDir, manifest });
      }
    }
  }

  return packages;
}

const WORKSPACE_PACKAGES = discoverWorkspacePackages();

function declarationEntriesForPackage(inventory, manifest) {
  const entries = new Set();
  if (typeof manifest.types === 'string') {
    entries.add(manifest.types.replace(/^\.\//, ''));
  }
  for (const entry of publicDeclarationEntriesFromExports(inventory, manifest)) {
    entries.add(entry);
  }
  return [...entries].filter((entry) => /\.(?:d\.ts|d\.cts|d\.mts)$/.test(entry)).sort();
}

function hasBinEntries(manifest) {
  if (!manifest.bin) return false;
  if (typeof manifest.bin === 'string') return true;
  return (
    typeof manifest.bin === 'object' &&
    !Array.isArray(manifest.bin) &&
    Object.keys(manifest.bin).length > 0
  );
}

function loadRequiredPackages() {
  const inventory = parseJsonc(resolve(__dirname, 'package-inventory.jsonc'));
  const required = [];
  const skipped = [];

  for (const [inventoryName, entry] of Object.entries(inventory)) {
    if (entry.disposition !== 'ship-public') {
      if (entry.disposition === 'binary-wrapper') {
        skipped.push({
          name: inventoryName,
          reason: 'binary-wrapper package not covered by API snapshot checker',
        });
      }
      continue;
    }

    const packageName = entry.publicTarget ?? inventoryName;
    const workspacePackage = WORKSPACE_PACKAGES.get(packageName);
    if (!workspacePackage) {
      required.push({
        name: packageName,
        missingReason: 'no matching workspace package found from pnpm-workspace.yaml',
      });
      continue;
    }

    const entries = declarationEntriesForPackage(inventory, workspacePackage.manifest);
    if (entries.length === 0 && hasBinEntries(workspacePackage.manifest)) {
      skipped.push({
        name: packageName,
        reason: 'bin-only package not covered by API snapshot checker',
      });
      continue;
    }
    required.push({
      name: packageName,
      packageDir: workspacePackage.dir,
      distDir: join(workspacePackage.dir, 'dist'),
      distRelDir: join(relative(ROOT, workspacePackage.dir), 'dist'),
      entries,
    });
  }

  required.sort((a, b) => a.name.localeCompare(b.name));
  skipped.sort((a, b) => a.name.localeCompare(b.name));
  return { required, skipped };
}

const declarationExportCache = new Map();

function parseDeclarationFile(filePath) {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf-8'),
    ts.ScriptTarget.Latest,
    true,
  );
}

function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function declarationNames(node) {
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations
      .map((declaration) => (ts.isIdentifier(declaration.name) ? declaration.name.text : null))
      .filter(Boolean);
  }
  if (
    (ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node)) &&
    node.name
  ) {
    return [node.name.text];
  }
  return [];
}

function localDeclarations(sourceFile) {
  const declarations = new Map();
  for (const statement of sourceFile.statements) {
    for (const name of declarationNames(statement)) {
      declarations.set(name, statement);
    }
  }
  return declarations;
}

function textAsExportedDeclaration(text) {
  if (/^export\s+/.test(text)) return text;
  if (/^declare\s+/.test(text)) return text.replace(/^declare\s+/, 'export declare ');
  return `export ${text}`;
}

function exportRecordFromDeclaration(sourceFile, declaration, exportedName, options = {}) {
  let text = declaration.getText(sourceFile);
  if (options.forceExport) {
    text = textAsExportedDeclaration(text);
  }
  return {
    name: exportedName,
    text,
    line: normalizeExportLine(text),
  };
}

function addExport(records, seen, record) {
  if (!record?.line) return;
  const key = `${record.name}\0${record.line}`;
  if (seen.has(key)) return;
  seen.add(key);
  records.push(record);
}

function conditionTypesTarget(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.types === 'string') return value.types;
  for (const key of ['import', 'default', 'require']) {
    const target = conditionTypesTarget(value[key]);
    if (target) return target;
  }
  return null;
}

function packageNameAndSubpath(specifier) {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    return {
      packageName: parts.slice(0, 2).join('/'),
      exportKey: parts.length > 2 ? `./${parts.slice(2).join('/')}` : '.',
    };
  }
  return {
    packageName: parts[0],
    exportKey: parts.length > 1 ? `./${parts.slice(1).join('/')}` : '.',
  };
}

function declarationFileCandidates(basePath) {
  if (/\.(?:d\.ts|d\.cts|d\.mts)$/.test(basePath)) return [basePath];
  const withoutRuntimeExtension = basePath.replace(/\.(?:js|mjs|cjs|jsx|tsx|ts)$/, '');
  return [
    `${withoutRuntimeExtension}.d.ts`,
    `${withoutRuntimeExtension}.d.mts`,
    `${withoutRuntimeExtension}.d.cts`,
    join(withoutRuntimeExtension, 'index.d.ts'),
    join(withoutRuntimeExtension, 'index.d.mts'),
    join(withoutRuntimeExtension, 'index.d.cts'),
  ];
}

function resolveDeclarationModule(fromFile, specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const basePath = specifier.startsWith('.')
      ? resolve(dirname(fromFile), specifier)
      : resolve(ROOT, specifier.slice(1));
    return declarationFileCandidates(basePath).find((candidate) => existsSync(candidate)) ?? null;
  }

  const { packageName, exportKey } = packageNameAndSubpath(specifier);
  const workspacePackage = WORKSPACE_PACKAGES.get(packageName);
  if (!workspacePackage) return null;

  const exportTarget = workspacePackage.manifest.exports?.[exportKey];
  const typesTarget =
    conditionTypesTarget(exportTarget) ??
    (exportKey === '.' && typeof workspacePackage.manifest.types === 'string'
      ? workspacePackage.manifest.types
      : null);
  if (!typesTarget) return null;

  const resolved = resolve(workspacePackage.dir, typesTarget);
  return existsSync(resolved) ? resolved : null;
}

function collectDeclarationExports(filePath, visiting = new Set()) {
  const normalizedPath = resolve(filePath);
  if (declarationExportCache.has(normalizedPath)) {
    return declarationExportCache.get(normalizedPath);
  }
  if (visiting.has(normalizedPath) || !existsSync(normalizedPath)) {
    return [];
  }

  visiting.add(normalizedPath);
  const sourceFile = parseDeclarationFile(normalizedPath);
  const localByName = localDeclarations(sourceFile);
  const records = [];
  const seen = new Set();

  for (const statement of sourceFile.statements) {
    if (hasExportModifier(statement) && !ts.isExportDeclaration(statement)) {
      for (const name of declarationNames(statement)) {
        addExport(records, seen, exportRecordFromDeclaration(sourceFile, statement, name));
      }
      continue;
    }

    if (!ts.isExportDeclaration(statement)) continue;

    const moduleSpecifier =
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : null;
    const targetFile = moduleSpecifier
      ? resolveDeclarationModule(normalizedPath, moduleSpecifier)
      : null;
    const targetExports = targetFile ? collectDeclarationExports(targetFile, visiting) : [];

    if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
      addExport(records, seen, {
        name: statement.exportClause.name.text,
        text: statement.getText(sourceFile),
        line: normalizeExportLine(statement.getText(sourceFile)),
      });
      continue;
    }

    if (!statement.exportClause) {
      if (targetExports.length > 0) {
        for (const record of targetExports) addExport(records, seen, record);
      } else {
        addExport(records, seen, {
          name: '*',
          text: statement.getText(sourceFile),
          line: normalizeExportLine(statement.getText(sourceFile)),
        });
      }
      continue;
    }

    if (!ts.isNamedExports(statement.exportClause)) continue;

    for (const specifier of statement.exportClause.elements) {
      const sourceName = specifier.propertyName?.text ?? specifier.name.text;
      const exportedName = specifier.name.text;

      if (targetExports.length > 0) {
        const targetRecord = targetExports.find((record) => record.name === sourceName);
        if (targetRecord) {
          addExport(records, seen, { ...targetRecord, name: exportedName });
          continue;
        }
      }

      const localDeclaration = localByName.get(sourceName);
      if (localDeclaration) {
        addExport(
          records,
          seen,
          exportRecordFromDeclaration(sourceFile, localDeclaration, exportedName, {
            forceExport: true,
          }),
        );
        continue;
      }

      addExport(records, seen, {
        name: exportedName,
        text: statement.getText(sourceFile),
        line: normalizeExportLine(statement.getText(sourceFile)),
      });
    }
  }

  visiting.delete(normalizedPath);
  declarationExportCache.set(normalizedPath, records);
  return records;
}

function extractExports(_content, entryName, packageName, dtsPath) {
  const exports = collectDeclarationExports(dtsPath);
  if (exports.length === 0) {
    console.error(`WARN: ${packageName} — no resolved declaration exports found for ${entryName}`);
  }
  return exports.map((record) => record.line).filter(Boolean);
}

function resolvedDeclarationSurface(dtsPath) {
  return collectDeclarationExports(dtsPath)
    .map((record) => record.text)
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Normalize an export line for snapshot comparison.
 *
 * Strips trailing `{`, collapses whitespace, and truncates very long
 * signatures to keep snapshots readable.
 */
function normalizeExportLine(line) {
  // Remove declaration-only noise that depends on whether a symbol came from a
  // direct .d.ts entry or a resolved rollup declaration.
  let normalized = line.replace(/^declare\s+/, '');
  normalized = normalized.replace(/^export\s+declare\s+/, 'export ');

  // Collapse multiple whitespace into single space
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Remove trailing opening brace (for interface/class bodies)
  normalized = normalized.replace(/\s*\{$/, '');

  // Remove trailing semicolons
  normalized = normalized.replace(/;$/, '');

  // Skip re-export-all statements (export * from '...')
  // These are implementation details, not the public API surface
  if (/^export \* from /.test(normalized)) {
    return null;
  }

  // Truncate very long lines for readability (keep first 200 chars).
  // Required kernel declarations are protected by explicit erasure gates above.
  if (normalized.length > 200) {
    normalized = normalized.substring(0, 200) + ' ...';
  }

  return normalized;
}

function exportedDeclarationBlock(content, kind, name) {
  const prefix =
    kind === 'const'
      ? new RegExp(
          `^export\\s+(?:declare\\s+)?(?:const\\s+${escapeRegExp(name)}\\s*:|function\\s+${escapeRegExp(name)}\\b|class\\s+${escapeRegExp(name)}\\b)`,
        )
      : new RegExp(
          `^export\\s+(?:declare\\s+)?(?:type\\s+${escapeRegExp(name)}\\s*=|interface\\s+${escapeRegExp(name)}\\b|class\\s+${escapeRegExp(name)}\\b|enum\\s+${escapeRegExp(name)}\\b)`,
        );
  const lines = content.split('\n');
  const start = lines.findIndex((line) => {
    const trimmed = line.trim();
    return prefix.test(trimmed);
  });
  if (start === -1) {
    const reExport = lines.find((line) => {
      const trimmed = line.trim();
      if (kind === 'const' && !trimmed.startsWith('export {')) return false;
      if (kind === 'type' && !trimmed.startsWith('export type {')) return false;
      if (!/\}\s+from\s+['"]/.test(trimmed)) return false;
      return new RegExp(
        String.raw`(?:^|[\s,{])${escapeRegExp(name)}(?:\s+as\s+\w+)?(?:[\s,}]|$)`,
      ).test(trimmed);
    });
    return reExport ?? null;
  }

  const collected = [];
  for (let i = start; i < lines.length; i++) {
    if (i !== start && lines[i].trim().startsWith('export ')) {
      break;
    }
    collected.push(lines[i]);
  }
  return collected.join('\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

function requiredDeclarationFailures(packageName, entry, content) {
  const requirements = (REQUIRED_PUBLIC_DECLARATIONS[packageName] || []).filter(
    (requirement) => requirement.entry === entry,
  );
  const failures = [];

  for (const requirement of requirements) {
    const block = exportedDeclarationBlock(content, requirement.kind, requirement.name);
    if (!block) {
      failures.push(`${entry}: missing required ${requirement.kind} ${requirement.name}`);
      continue;
    }
    const codeOnlyBlock = stripCommentsAndStrings(block);
    for (const forbidden of requirement.forbidden) {
      if (forbidden.test(codeOnlyBlock)) {
        failures.push(
          `${entry}: ${requirement.name} declaration contains forbidden erasure ${forbidden}`,
        );
      }
    }
  }

  return failures;
}

/**
 * Normalize whitespace for comparison: trim each line, remove blank lines,
 * collapse to a single canonical form.
 */
function normalizeForComparison(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .join('\n');
}

// --- Main ---

mkdirSync(SNAPSHOT_DIR, { recursive: true });

let hasErrors = false;
let snapshotsUpdated = 0;
let packagesChecked = 0;
const checked = [];
const missing = [];
const { required: requiredPackages, skipped } = loadRequiredPackages();

for (const pkg of requiredPackages) {
  if (pkg.missingReason) {
    console.error(`MISSING: ${pkg.name} — ${pkg.missingReason}`);
    missing.push({ name: pkg.name, reason: pkg.missingReason });
    hasErrors = true;
    continue;
  }

  if (pkg.entries.length === 0) {
    console.error(`MISSING: ${pkg.name} — package manifest declares no dist declaration entries`);
    missing.push({
      name: pkg.name,
      reason: 'no dist declaration entries declared in package.json',
    });
    hasErrors = true;
    continue;
  }

  if (!existsSync(pkg.distDir)) {
    console.error(`MISSING: ${pkg.name} — required dist directory ${pkg.distRelDir} not found`);
    missing.push({ name: pkg.name, reason: `${pkg.distRelDir} not found` });
    hasErrors = true;
    continue;
  }

  const snapshotFilename = pkg.name.replace(/\//g, '__') + '.api.txt';
  const snapshotPath = resolve(SNAPSHOT_DIR, snapshotFilename);

  const allExports = [];
  let packageMissingEntry = false;

  for (const entry of pkg.entries) {
    const dtsPath = resolve(pkg.packageDir, entry);
    const relDtsPath = relative(ROOT, dtsPath);

    if (!existsSync(dtsPath)) {
      console.error(`MISSING: ${pkg.name} — required declaration entry ${relDtsPath} not found`);
      missing.push({ name: pkg.name, reason: `${relDtsPath} not found` });
      packageMissingEntry = true;
      hasErrors = true;
      continue;
    }

    const content = readFileSync(dtsPath, 'utf-8');
    const publicSurface = resolvedDeclarationSurface(dtsPath);
    const declarationFailures = requiredDeclarationFailures(
      pkg.name,
      entry,
      publicSurface || content,
    );
    if (declarationFailures.length > 0) {
      for (const failure of declarationFailures) {
        console.error(`ERASURE: ${pkg.name} — ${failure}`);
      }
      hasErrors = true;
    }
    const exports = [...new Set(extractExports(content, entry, pkg.name, dtsPath))].sort();

    if (exports.length > 0) {
      allExports.push(`## ${entry}`);
      for (const exp of exports) {
        allExports.push(exp);
      }
      allExports.push('');
    }
  }

  if (packageMissingEntry) {
    continue;
  }

  packagesChecked++;
  checked.push(pkg.name);
  const currentSnapshot = [
    `# ${pkg.name} public API snapshot`,
    `# Auto-generated. Run \`pnpm check:api-snapshots --update\` to regenerate.`,
    '',
    ...allExports,
  ].join('\n');

  if (updateMode) {
    writeFileSync(snapshotPath, currentSnapshot);
    console.log(`Updated: ${snapshotFilename}`);
  } else {
    if (!existsSync(snapshotPath)) {
      if (autoUpdateMode) {
        mkdirSync(SNAPSHOT_DIR, { recursive: true });
        writeFileSync(snapshotPath, currentSnapshot);
        console.log(`FIXED: ${snapshotFilename} — generated missing snapshot`);
        snapshotsUpdated++;
      } else {
        console.error(`MISSING: ${snapshotFilename}`);
        console.error(`  Run \`pnpm check:api-snapshots --update\` to generate initial snapshot.`);
        missing.push({ name: pkg.name, reason: `${snapshotFilename} not found` });
        hasErrors = true;
      }
      continue;
    }

    const committed = readFileSync(snapshotPath, 'utf-8');
    const committedNorm = normalizeForComparison(committed);
    const currentNorm = normalizeForComparison(currentSnapshot);

    if (committedNorm !== currentNorm) {
      const status = autoUpdateMode ? 'FIXED' : 'API CHANGED';
      console.error(`${status}: ${pkg.name}`);
      console.error(
        autoUpdateMode
          ? `  Regenerated ${snapshotFilename}. Review and commit the diff.`
          : `  Run \`pnpm check:api-snapshots --update\` and review the diff.`,
      );

      // Show a brief diff summary
      const committedLines = new Set(committedNorm.split('\n'));
      const currentLines = new Set(currentNorm.split('\n'));

      const added = [...currentLines].filter((l) => !committedLines.has(l));
      const removed = [...committedLines].filter((l) => !currentLines.has(l));

      if (added.length > 0) {
        console.error(`  Added (${added.length}):`);
        for (const line of added.slice(0, 10)) {
          console.error(`    + ${line}`);
        }
        if (added.length > 10) {
          console.error(`    ... and ${added.length - 10} more`);
        }
      }
      if (removed.length > 0) {
        console.error(`  Removed (${removed.length}):`);
        for (const line of removed.slice(0, 10)) {
          console.error(`    - ${line}`);
        }
        if (removed.length > 10) {
          console.error(`    ... and ${removed.length - 10} more`);
        }
      }

      if (autoUpdateMode) {
        writeFileSync(snapshotPath, currentSnapshot);
        snapshotsUpdated++;
      } else {
        hasErrors = true;
      }
    } else {
      console.log(`OK: ${pkg.name} — API matches snapshot`);
    }
  }
}

console.log('\nCoverage:');
console.log(
  `  Required (${requiredPackages.length}): ${requiredPackages.map((pkg) => pkg.name).join(', ') || '(none)'}`,
);
console.log(`  Checked (${checked.length}): ${checked.join(', ') || '(none)'}`);
console.log(
  `  Missing (${missing.length}): ${missing.map((pkg) => `${pkg.name} (${pkg.reason})`).join(', ') || '(none)'}`,
);
console.log(
  `  Skipped (${skipped.length}): ${skipped.map((pkg) => `${pkg.name} (${pkg.reason})`).join(', ') || '(none)'}`,
);

if (packagesChecked === 0) {
  console.error('\ncheck:api-snapshots FAILED — zero packages checked.');
  process.exit(1);
}

if (updateMode) {
  console.log(`\ncheck:api-snapshots — ${packagesChecked} snapshot(s) updated.`);
} else if (hasErrors) {
  console.error(`\ncheck:api-snapshots FAILED — snapshot mismatch detected.`);
  console.error('Run `pnpm check:api-snapshots --update` to regenerate, then review the diff.');
  process.exit(1);
} else if (snapshotsUpdated > 0) {
  console.log(
    `\ncheck:api-snapshots FIXED — ${snapshotsUpdated} snapshot(s) regenerated; review and commit the diff.`,
  );
} else {
  console.log(`\ncheck:api-snapshots PASSED — ${packagesChecked} package(s) match snapshots.`);
}
