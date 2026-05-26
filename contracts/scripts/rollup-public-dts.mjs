#!/usr/bin/env node

/**
 * Project private type-shard declarations into @mog-sdk/contracts/dist.
 *
 * @mog-sdk/contracts is the public identity owner for the SDK. Its source can
 * be authored as facades over private @mog/types-* shards, but published
 * declarations must not import those private packages and must not inline their
 * branded unique-symbol identities independently per public subpath.
 *
 * The correct shape is:
 *   - copy each bundled private shard's exported declaration graph once into dist/_types
 *   - rewrite all private shard import/export specifiers to that projected graph
 *   - leave public contracts declarations as facades plus runtime value surfaces
 *
 * This makes declarations self-contained while preserving a single physical
 * owner for nominal brands such as SheetId, CellId, ColId, and coordinate types.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..');
const DIST_DIR = resolve(PACKAGE_ROOT, 'dist');
const PROJECTED_TYPES_DIR = resolve(DIST_DIR, '_types');

const BUNDLED_PACKAGES = [
  '@mog/types-api',
  '@mog/types-bridges',
  '@mog/types-commands',
  '@mog/types-connections',
  '@mog/types-core',
  '@mog/types-culture',
  '@mog/types-data',
  '@mog-sdk/types-document',
  '@mog/types-editor',
  '@mog/types-events',
  '@mog/types-formatting',
  '@mog/types-machines',
  '@mog/types-objects',
  '@mog/types-rendering',
  '@mog/types-viewport',
];

function parseWorkspacePatterns() {
  const source = readFileSync(resolve(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
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
  if (!pattern.includes('*')) return [resolve(REPO_ROOT, pattern)];

  const parts = pattern.split('/');
  let dirs = [REPO_ROOT];
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
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.name) packages.set(manifest.name, { packageDir, manifest });
    }
  }
  return packages;
}

function splitPackageSpecifier(specifier) {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    return {
      packageName: parts.slice(0, 2).join('/'),
      subpath: parts.length > 2 ? `./${parts.slice(2).join('/')}` : '.',
    };
  }
  return {
    packageName: parts[0],
    subpath: parts.length > 1 ? `./${parts.slice(1).join('/')}` : '.',
  };
}

function getExportTarget(exportsField, subpath) {
  if (!exportsField) return null;
  if (subpath === '.' && typeof exportsField === 'string') return exportsField;
  const target =
    typeof exportsField === 'object' && !Array.isArray(exportsField) ? exportsField[subpath] : null;
  if (typeof target === 'string') return target;
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    return typeof target.types === 'string' ? target.types : null;
  }
  return null;
}

function projectedPackageDir(packageName) {
  return resolve(PROJECTED_TYPES_DIR, packageName.replace(/^@/, '').replace(/\//g, '__'));
}

function findFiles(dir, predicate) {
  if (!existsSync(dir)) return [];

  const results = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findFiles(fullPath, predicate));
    } else if (predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function packageDistDir(workspacePackage) {
  const typesEntry =
    typeof workspacePackage.manifest.types === 'string'
      ? workspacePackage.manifest.types
      : getExportTarget(workspacePackage.manifest.exports, '.');
  if (!typesEntry) {
    throw new Error(`Unable to find declaration entry for ${workspacePackage.manifest.name}`);
  }

  const distIndex = typesEntry.replace(/^\.\//, '').indexOf('/dist/');
  if (typesEntry.startsWith('./dist/') || typesEntry.startsWith('dist/')) {
    return resolve(workspacePackage.packageDir, 'dist');
  }
  if (distIndex >= 0) {
    return resolve(workspacePackage.packageDir, typesEntry.slice(0, distIndex + '/dist'.length));
  }
  return resolve(workspacePackage.packageDir, 'dist');
}

function exportDeclarationTargets(workspacePackage) {
  const targets = new Set();
  const { exports: exportsField, types } = workspacePackage.manifest;

  if (typeof types === 'string') targets.add(types);

  if (typeof exportsField === 'string') {
    targets.add(exportsField);
  } else if (exportsField && typeof exportsField === 'object' && !Array.isArray(exportsField)) {
    for (const subpath of Object.keys(exportsField)) {
      if (!subpath.startsWith('.')) continue;
      const target = getExportTarget(exportsField, subpath);
      if (target) targets.add(target);
    }
  }

  return [...targets];
}

function sourceDeclarationForTarget(workspacePackage, target) {
  const sourceDeclaration = resolve(workspacePackage.packageDir, target);
  if (!existsSync(sourceDeclaration)) {
    throw new Error(
      `Resolved declaration target for ${workspacePackage.manifest.name} does not exist: ${relative(
        REPO_ROOT,
        sourceDeclaration,
      )}`,
    );
  }
  return sourceDeclaration;
}

function isWithinDir(filePath, dir) {
  const relativePath = relative(dir, filePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function declarationSpecifiers(source) {
  const declarationsOnly = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const specifiers = [];
  const specifierRe = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = specifierRe.exec(declarationsOnly)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function resolveRelativeDeclaration(specifier, fromFile) {
  if (!specifier.startsWith('.')) return null;

  const base = resolve(dirname(fromFile), specifier);
  const candidates = [];

  if (base.endsWith('.d.ts')) candidates.push(base);
  if (base.endsWith('.js')) candidates.push(base.slice(0, -'.js'.length) + '.d.ts');
  if (base.endsWith('.ts')) candidates.push(base.slice(0, -'.ts'.length) + '.d.ts');

  candidates.push(`${base}.d.ts`, resolve(base, 'index.d.ts'));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `Unable to resolve relative declaration ${specifier} from ${relative(REPO_ROOT, fromFile)}`,
  );
}

function copyDeclarationFile(sourceFile, sourceDistDir, targetDir) {
  if (!isWithinDir(sourceFile, sourceDistDir)) {
    throw new Error(
      `Declaration ${relative(REPO_ROOT, sourceFile)} is outside ${relative(REPO_ROOT, sourceDistDir)}`,
    );
  }

  const targetFile = resolve(targetDir, relative(sourceDistDir, sourceFile));
  mkdirSync(dirname(targetFile), { recursive: true });
  writeFileSync(targetFile, readFileSync(sourceFile, 'utf8'));
}

function copyExportedDeclarationGraph(workspacePackage, targetDir) {
  const sourceDistDir = packageDistDir(workspacePackage);
  if (!existsSync(sourceDistDir)) {
    throw new Error(`Missing declaration source directory: ${relative(REPO_ROOT, sourceDistDir)}`);
  }

  const entrypoints = exportDeclarationTargets(workspacePackage).map((target) =>
    sourceDeclarationForTarget(workspacePackage, target),
  );
  if (entrypoints.length === 0) {
    throw new Error(`Unable to find exported declarations for ${workspacePackage.manifest.name}`);
  }

  const visited = new Set();
  const stack = [...entrypoints];

  while (stack.length > 0) {
    const sourceFile = stack.pop();
    if (visited.has(sourceFile)) continue;
    visited.add(sourceFile);

    const source = readFileSync(sourceFile, 'utf8');
    copyDeclarationFile(sourceFile, sourceDistDir, targetDir);

    for (const specifier of declarationSpecifiers(source)) {
      const relativeDeclaration = resolveRelativeDeclaration(specifier, sourceFile);
      if (relativeDeclaration) stack.push(relativeDeclaration);
    }
  }

  return visited.size;
}

function projectedSpecifierFor(specifier, fromFile, workspacePackages) {
  const { packageName, subpath } = splitPackageSpecifier(specifier);
  if (!BUNDLED_PACKAGES.includes(packageName)) return null;

  const workspacePackage = workspacePackages.get(packageName);
  if (!workspacePackage) {
    throw new Error(`Unable to resolve workspace package for ${specifier}`);
  }

  const target = getExportTarget(workspacePackage.manifest.exports, subpath);
  if (!target) {
    throw new Error(`Unable to resolve exported declaration target for ${specifier}`);
  }

  const sourceDistDir = packageDistDir(workspacePackage);
  const sourceDeclaration = sourceDeclarationForTarget(workspacePackage, target);

  const projectedDeclaration = resolve(
    projectedPackageDir(packageName),
    relative(sourceDistDir, sourceDeclaration),
  );
  const withoutExtension = projectedDeclaration.replace(/\.d\.ts$/, '');
  let relativeSpecifier = relative(dirname(fromFile), withoutExtension).replaceAll('\\', '/');
  if (!relativeSpecifier.startsWith('.')) relativeSpecifier = `./${relativeSpecifier}`;
  return relativeSpecifier;
}

function rewritePrivateSpecifiers(source, filePath, workspacePackages) {
  const specifierRe = /((?:from\s+|import\s*\()\s*['"])([^'"]+)(['"])/g;
  return source.replace(specifierRe, (match, prefix, specifier, suffix) => {
    const projected = projectedSpecifierFor(specifier, filePath, workspacePackages);
    return projected ? `${prefix}${projected}${suffix}` : match;
  });
}

const workspacePackages = discoverWorkspacePackages();
rmSync(PROJECTED_TYPES_DIR, {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 100,
});
mkdirSync(PROJECTED_TYPES_DIR, { recursive: true });

let copiedPackages = 0;
let copiedDeclarations = 0;
for (const packageName of BUNDLED_PACKAGES) {
  const workspacePackage = workspacePackages.get(packageName);
  if (!workspacePackage) throw new Error(`Workspace package not found: ${packageName}`);
  copiedDeclarations += copyExportedDeclarationGraph(
    workspacePackage,
    projectedPackageDir(packageName),
  );
  copiedPackages += 1;
}

let rewritten = 0;
for (const declarationFile of findFiles(DIST_DIR, (file) => file.endsWith('.d.ts'))) {
  const original = readFileSync(declarationFile, 'utf8');
  const next = rewritePrivateSpecifiers(original, declarationFile, workspacePackages);
  if (next !== original) {
    writeFileSync(declarationFile, next);
    rewritten += 1;
  }
}

console.log(
  `rollup-public-dts: projected ${copiedDeclarations} declaration file(s) from ${copiedPackages} private type shard(s), rewrote ${rewritten} declaration file(s)`,
);
