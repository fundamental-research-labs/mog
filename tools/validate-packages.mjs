#!/usr/bin/env node

/**
 * Gate 1: pnpm validate:packages
 *
 * Package manifest validation, namespace policy, dependency closure,
 * private-field enforcement.
 *
 * Reads package-inventory.jsonc and every workspace package.json.
 * No build step required. Execution time: <2 seconds.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const VALID_DISPOSITIONS = new Set([
  'ship-public',
  'binary-wrapper',
  'bundle-only',
  'workspace-internal',
  'private',
  'dev-eval',
  'generated-asset',
  'reserved',
  'monorepo-root',
]);
const VALID_EXPORT_DISPOSITIONS = new Set([
  'public-experimental',
  'workspace-private-friend',
  'reserved',
]);
const VALID_PRIVATE_FRIEND_PUBLIC_ARTIFACTS = new Set(['strip']);
const RUNTIME_DEP_FIELDS = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
  'bundledDependencies',
  'bundleDependencies',
];
const ALL_DEP_FIELDS = [...RUNTIME_DEP_FIELDS, 'devDependencies'];
const PUBLIC_SDK_FORBIDDEN_AI_DEPS = [
  '@ai-sdk/*',
  '@anthropic-ai/*',
  '@langchain/*',
  '@openai/*',
  'ai',
  'anthropic',
  'langchain',
  'openai',
];

// ── Load JSONC inventory ────────────────────────────────────────────────

function loadJsonc(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  // Strip single-line // comments and block /* */ comments
  const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // Strip trailing commas before } or ]
  const noTrailingCommas = stripped.replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(noTrailingCommas);
}

// ── Discover workspace packages ─────────────────────────────────────────

function discoverWorkspacePackages() {
  const wsPath = join(ROOT, 'pnpm-workspace.yaml');
  const wsContent = readFileSync(wsPath, 'utf-8');

  // Parse the pnpm-workspace.yaml packages list (simple YAML parser for the list)
  const packages = [];
  const lines = wsContent.split('\n');
  let inPackages = false;
  for (const line of lines) {
    if (/^packages:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const match = line.match(/^\s+-\s+'([^']+)'$/);
      if (match) {
        packages.push(match[1]);
      } else if (/^\S/.test(line) && line.trim()) {
        // Hit next top-level key
        inPackages = false;
      }
    }
  }

  // Expand globs. Each entry is a glob pattern for directories containing package.json.
  const discovered = [];
  for (const pattern of packages) {
    if (pattern === '.') {
      // Root package
      const pkgPath = join(ROOT, 'package.json');
      if (existsSync(pkgPath)) {
        discovered.push({ path: ROOT, manifestPath: pkgPath });
      }
      continue;
    }

    // Expand glob: the pattern is a directory path (possibly with *)
    // We need to find all directories matching the pattern that contain a package.json
    const globPattern = join(ROOT, pattern, 'package.json');
    const matches = globSync(globPattern);
    for (const match of matches) {
      // Skip node_modules, target dirs, and .claude worktrees
      if (
        match.includes('node_modules') ||
        match.includes('/target') ||
        match.includes('.claude')
      ) {
        continue;
      }
      discovered.push({
        path: dirname(match),
        manifestPath: match,
      });
    }
  }

  return discovered;
}

// ── Glob matching for forbidden dep patterns ────────────────────────────

function matchesPattern(depName, pattern) {
  // Patterns can be:
  //   "exact-name" — exact match
  //   "@scope/prefix-*" — prefix glob
  //   "@scope/*" — scope-wide glob
  if (!pattern.includes('*')) {
    return depName === pattern;
  }

  // Convert glob to regex
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(depName);
}

// ── Main ────────────────────────────────────────────────────────────────

const inventoryPath = join(__dirname, 'package-inventory.jsonc');
const inventory = loadJsonc(inventoryPath);
const workspacePackages = discoverWorkspacePackages();

const errors = [];
const classified = new Set();
const workspaceByName = new Map();

for (const pkg of workspacePackages) {
  try {
    const manifest = JSON.parse(readFileSync(pkg.manifestPath, 'utf-8'));
    if (manifest.name) {
      workspaceByName.set(manifest.name, { ...pkg, manifest });
    }
  } catch {
    // Parse errors are reported in the main validation loop below.
  }
}

function dependencyNames(manifest, depField) {
  const raw = manifest[depField];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.keys(raw);
}

function dependencyEntries(manifest, depField) {
  const raw = manifest[depField];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((name) => [name, true]);
  return Object.entries(raw);
}

function exportMapEntries(manifest) {
  const exportsField = manifest.exports;
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) {
    return [];
  }
  return Object.entries(exportsField);
}

function binEntries(manifest) {
  if (!manifest.bin) return [];
  if (typeof manifest.bin === 'string') return [[manifest.name ?? '<unnamed>', manifest.bin]];
  if (typeof manifest.bin !== 'object' || Array.isArray(manifest.bin)) return [];
  return Object.entries(manifest.bin).filter(([, target]) => typeof target === 'string');
}

function validateExportDisposition(name, manifest, entry, inventory, errors) {
  const exportDispositions = entry.exports ?? {};
  if (
    exportDispositions &&
    (typeof exportDispositions !== 'object' || Array.isArray(exportDispositions))
  ) {
    errors.push(`${name}: exports metadata must be an object when present`);
    return;
  }

  for (const [subpath, disposition] of Object.entries(exportDispositions)) {
    if (!subpath.startsWith('.')) {
      errors.push(`${name}: export metadata key "${subpath}" must be a package export subpath`);
    }
    if (!disposition || typeof disposition !== 'object' || Array.isArray(disposition)) {
      errors.push(`${name} ${subpath}: export disposition must be an object`);
      continue;
    }
    if (!VALID_EXPORT_DISPOSITIONS.has(disposition.disposition)) {
      errors.push(
        `${name} ${subpath}: invalid export disposition "${disposition.disposition}". Expected one of: ${[...VALID_EXPORT_DISPOSITIONS].join(', ')}`,
      );
      continue;
    }
    if (disposition.disposition === 'workspace-private-friend') {
      const allowedProductionConsumers = disposition.allowedProductionConsumers ?? [];
      const allowedDevConsumers = disposition.allowedDevConsumers ?? [];
      const allowedExternalDevConsumers = disposition.allowedExternalDevConsumers ?? [];
      if (
        !Array.isArray(allowedProductionConsumers) ||
        !Array.isArray(allowedDevConsumers) ||
        !Array.isArray(allowedExternalDevConsumers)
      ) {
        errors.push(`${name} ${subpath}: workspace-private-friend consumers must be arrays`);
      } else if (
        allowedProductionConsumers.length +
          allowedDevConsumers.length +
          allowedExternalDevConsumers.length ===
        0
      ) {
        errors.push(
          `${name} ${subpath}: workspace-private-friend must name allowedProductionConsumers, allowedDevConsumers, or allowedExternalDevConsumers`,
        );
      }
      for (const consumer of allowedDevConsumers) {
        if (inventory[consumer]?.disposition !== 'dev-eval') {
          errors.push(
            `${name} ${subpath}: allowedDevConsumers entry "${consumer}" must be classified dev-eval`,
          );
        }
      }
      if (!VALID_PRIVATE_FRIEND_PUBLIC_ARTIFACTS.has(disposition.publicArtifact)) {
        errors.push(`${name} ${subpath}: workspace-private-friend publicArtifact must be "strip"`);
      }
    }
  }

  if (['ship-public', 'binary-wrapper'].includes(entry.disposition)) {
    for (const [subpath, target] of exportMapEntries(manifest)) {
      const disposition = exportDispositions[subpath];
      if (subpath === '.') {
        if (disposition && disposition.disposition !== 'public-experimental') {
          errors.push(
            `${name} ${subpath}: root export may only be public-experimental when classified`,
          );
        }
      } else if (!disposition) {
        errors.push(
          `${name} ${subpath}: public package export subpath must be classified in package-inventory.jsonc`,
        );
      }

      if (disposition?.disposition === 'workspace-private-friend') {
        if (!target || typeof target !== 'object' || Array.isArray(target)) {
          errors.push(
            `${name} ${subpath}: workspace-private-friend export target must be an object`,
          );
        } else if ('development' in target) {
          errors.push(
            `${name} ${subpath}: workspace-private-friend export must not include a development condition`,
          );
        }
      }
    }
  }

  for (const subpath of Object.keys(exportDispositions)) {
    if (!Object.prototype.hasOwnProperty.call(manifest.exports ?? {}, subpath)) {
      errors.push(
        `${name} ${subpath}: export disposition exists but package.json has no matching export`,
      );
    }
  }
}

function setDifference(a, b) {
  return [...a].filter((value) => !b.has(value)).sort();
}

function formatSet(set) {
  return [...set].sort().join(', ') || '(none)';
}

function packageNameForPath(packagePath) {
  const manifestPath = join(ROOT, packagePath, 'package.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')).name ?? null;
  } catch {
    return null;
  }
}

for (const pkg of workspacePackages) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(pkg.manifestPath, 'utf-8'));
  } catch (e) {
    errors.push(`${pkg.manifestPath}: failed to parse package.json: ${e.message}`);
    continue;
  }

  const name = manifest.name;
  if (!name) {
    errors.push(`${pkg.manifestPath}: package.json has no "name" field`);
    continue;
  }

  const entry = inventory[name];
  if (!entry) {
    errors.push(
      `${name}: not in package-inventory.jsonc -- every workspace package must be classified`,
    );
    continue;
  }

  classified.add(name);
  const relPath = pkg.path.replace(ROOT + '/', '');

  // 0. Inventory schema sanity for the current package.
  if (!VALID_DISPOSITIONS.has(entry.disposition)) {
    errors.push(
      `${name}: invalid disposition "${entry.disposition}". Expected one of: ${[...VALID_DISPOSITIONS].join(', ')}`,
    );
  }
  if (entry.publicTarget !== null && typeof entry.publicTarget !== 'string') {
    errors.push(`${name}: publicTarget must be a string or null`);
  }
  if (typeof entry.requirePrivate !== 'boolean') {
    errors.push(`${name}: requirePrivate must be a boolean`);
  }
  if (!Array.isArray(entry.forbiddenRuntimeDeps)) {
    errors.push(`${name}: forbiddenRuntimeDeps must be an array`);
  }
  validateExportDisposition(name, manifest, entry, inventory, errors);

  // 1. Private field enforcement
  if (entry.requirePrivate && manifest.private !== true) {
    errors.push(
      `${name} (${relPath}): must have "private": true (disposition: ${entry.disposition})`,
    );
  }

  // 1b. Publishable public artifacts must not remain private/source-only.
  if (
    ['ship-public', 'binary-wrapper'].includes(entry.disposition) &&
    entry.publicTarget &&
    manifest.private === true
  ) {
    errors.push(
      `${name} (${relPath}): disposition "${entry.disposition}" with publicTarget "${entry.publicTarget}" ` +
        `must not have "private": true. Reclassify until promotion or make it publishable.`,
    );
  }

  // 2. Namespace policy: ship-public publicTarget must be in @mog-sdk/*
  if (['ship-public', 'binary-wrapper'].includes(entry.disposition) && entry.publicTarget) {
    if (!entry.publicTarget.startsWith('@mog-sdk/')) {
      errors.push(`${name}: publicTarget "${entry.publicTarget}" must be in @mog-sdk/* namespace`);
    }
  }

  // 3. Forbidden runtime dependency check
  //    Applies to runtime dependency fields (NOT devDependencies).
  if (entry.forbiddenRuntimeDeps && entry.forbiddenRuntimeDeps.length > 0) {
    for (const depField of RUNTIME_DEP_FIELDS) {
      for (const depName of dependencyNames(manifest, depField)) {
        for (const pattern of entry.forbiddenRuntimeDeps) {
          if (matchesPattern(depName, pattern)) {
            errors.push(
              `${name}: forbidden ${depField} "${depName}" (matches "${pattern}"). ` +
                `Public @mog-sdk/* packages must not declare runtime deps on internal packages.`,
            );
          }
        }
      }
    }
  }

  // 3b. Contracts are the bottom of the public TypeScript DAG. They must not
  // depend on implementation packages in any manifest section, including
  // devDependencies, because public artifact ordering treats workspace dev
  // links as build edges.
  if (name === '@mog-sdk/contracts') {
    for (const depField of ALL_DEP_FIELDS) {
      if (dependencyNames(manifest, depField).includes('@mog-sdk/kernel')) {
        errors.push(
          `${name}: forbidden ${depField} "@mog-sdk/kernel". ` +
            `Contracts must remain below kernel in the public package DAG.`,
        );
      }
    }
  }

  // 3c. Public SDK packages must not grow agent/provider SDK dependencies.
  // AI orchestration belongs in private eval/server packages, not shipped SDKs.
  if (['ship-public', 'binary-wrapper'].includes(entry.disposition)) {
    for (const depField of ALL_DEP_FIELDS) {
      for (const depName of dependencyNames(manifest, depField)) {
        for (const pattern of PUBLIC_SDK_FORBIDDEN_AI_DEPS) {
          if (matchesPattern(depName, pattern)) {
            errors.push(
              `${name}: forbidden ${depField} "${depName}" (matches "${pattern}"). ` +
                `Public SDK packages must not declare LangChain, Anthropic, OpenAI, or agent-framework dependencies.`,
            );
          }
        }
      }
    }
  }

  // 4. Publishability check: non-private packages without ship-public or binary-wrapper
  //    disposition should not be publishable
  if (manifest.private !== true && !['ship-public', 'binary-wrapper'].includes(entry.disposition)) {
    if (!entry.publicTarget) {
      errors.push(
        `${name} (${relPath}): missing "private": true for disposition "${entry.disposition}". ` +
          `Only ship-public and binary-wrapper packages may be publishable.`,
      );
    }
  }

  // 5. publishConfig.access check: only ship-public and binary-wrapper should have "public"
  if (
    manifest.publishConfig?.access === 'public' &&
    entry.disposition !== 'ship-public' &&
    entry.disposition !== 'binary-wrapper'
  ) {
    errors.push(
      `${name} (${relPath}): publishConfig.access is "public" but disposition is "${entry.disposition}". ` +
        `Remove publishConfig.access or change disposition.`,
    );
  }

  // 6. Public package name must match publicTarget
  if (entry.publicTarget && ['ship-public', 'binary-wrapper'].includes(entry.disposition)) {
    if (manifest.name !== entry.publicTarget) {
      errors.push(
        `${name} (${relPath}): manifest.name "${manifest.name}" does not match publicTarget "${entry.publicTarget}". ` +
          `The workspace name and npm package name must be identical.`,
      );
    }
  }

  // 7. No publishConfig.name hack (the workspace name IS the npm name)
  if (manifest.publishConfig?.name) {
    errors.push(
      `${name} (${relPath}): publishConfig.name is set ("${manifest.publishConfig.name}"). ` +
        `Remove it — the workspace name must be the npm name directly.`,
    );
  }

  // 8. Public packages must have "files" limited to built artifacts
  if (['ship-public', 'binary-wrapper'].includes(entry.disposition) && !entry.requirePrivate) {
    const files = manifest.files;
    if (!files || !Array.isArray(files)) {
      errors.push(
        `${name} (${relPath}): missing "files" field. Public packages must restrict packed files to built artifacts.`,
      );
    } else if (files.includes('src')) {
      errors.push(
        `${name} (${relPath}): "files" includes "src". Public packages must ship only built artifacts (e.g. ["dist"]).`,
      );
    }
  }

  // 8b. Ship-public packages are either libraries with public exports or bin
  // packages with executable dist targets. Binary-wrapper packages may publish
  // raw runtime artifacts through main/files instead.
  if (entry.disposition === 'ship-public' && !entry.requirePrivate) {
    const exports = exportMapEntries(manifest);
    const bins = binEntries(manifest);
    if (exports.length === 0 && bins.length === 0) {
      errors.push(
        `${name} (${relPath}): public packages must declare either exports or bin entries.`,
      );
    }
    for (const [binName, target] of bins) {
      if (!String(target).startsWith('./dist/')) {
        errors.push(
          `${name} (${relPath}): bin.${binName} target "${target}" must point at ./dist/*`,
        );
      }
      const files = Array.isArray(manifest.files) ? manifest.files : [];
      const normalized = String(target).replace(/^\.\//, '');
      const covered = files.some((file) => {
        if (typeof file !== 'string') return false;
        const entryPath = file.replace(/^\.\//, '').replace(/\/+$/, '');
        return normalized === entryPath || normalized.startsWith(`${entryPath}/`);
      });
      if (!covered) {
        errors.push(
          `${name} (${relPath}): bin.${binName} target "${target}" is not covered by files.`,
        );
      }
    }
  }

  // 9. Public package source manifests may use workspace: specs for local
  // development. Packed-manifest validation in check:external-fixtures is the
  // release gate that proves pnpm rewrote them to registry-safe semver.
  if (['ship-public', 'binary-wrapper'].includes(entry.disposition) && !entry.requirePrivate) {
    for (const depField of RUNTIME_DEP_FIELDS) {
      for (const [depName, depVersion] of dependencyEntries(manifest, depField)) {
        if (
          typeof depVersion === 'string' &&
          depVersion.startsWith('workspace:') &&
          !workspaceByName.has(depName)
        ) {
          errors.push(
            `${name} (${relPath}): ${depField}["${depName}"] uses "${depVersion}" but ${depName} is not a workspace package.`,
          );
        }
      }
    }
  }
}

// 10. Native binary wrapper consistency.
// The SDK optional dependencies, compute/napi package mappings, native
// package inventory, and publish matrix must describe the same public set.
const nativeInventory = new Set(
  Object.entries(inventory)
    .filter(
      ([name, entry]) =>
        entry.disposition === 'binary-wrapper' &&
        name !== '@mog-sdk/wasm' &&
        name !== '@mog-sdk/chart-raster-wasm',
    )
    .map(([name]) => name),
);
const nodeSdk = workspaceByName.get('@mog-sdk/sdk')?.manifest;
const nodeOptional = new Set(
  nodeSdk
    ? dependencyNames(nodeSdk, 'optionalDependencies').filter((name) =>
        name.startsWith('@mog-sdk/'),
      )
    : [],
);
const napiManifestPath = join(ROOT, 'compute/napi/package.json');
let napiPackageMap = new Set();
let napiOptional = new Set();
if (existsSync(napiManifestPath)) {
  const napiManifest = JSON.parse(readFileSync(napiManifestPath, 'utf-8'));
  napiPackageMap = new Set(Object.values(napiManifest.napi?.package ?? {}));
  napiOptional = new Set(
    dependencyNames(napiManifest, 'optionalDependencies').filter((name) =>
      name.startsWith('@mog-sdk/'),
    ),
  );
}
const publishWorkflowPath = join(ROOT, '.github/workflows/publish-sdk.yml');
const publishNativePackages = new Set();
if (existsSync(publishWorkflowPath)) {
  const publishWorkflow = readFileSync(publishWorkflowPath, 'utf-8');
  const re = /compute\/napi\/npm\/([A-Za-z0-9_-]+)/g;
  for (const match of publishWorkflow.matchAll(re)) {
    const packageName = packageNameForPath(`compute/napi/npm/${match[1]}`);
    if (packageName) publishNativePackages.add(packageName);
  }
}

const nativeSets = [
  ['inventory binary-wrapper entries', nativeInventory],
  ['@mog-sdk/sdk optionalDependencies', nodeOptional],
  ['compute/napi napi.package mappings', napiPackageMap],
  ['compute/napi optionalDependencies', napiOptional],
  ['publish-sdk native package paths', publishNativePackages],
];
for (let i = 0; i < nativeSets.length; i++) {
  for (let j = i + 1; j < nativeSets.length; j++) {
    const [leftName, leftSet] = nativeSets[i];
    const [rightName, rightSet] = nativeSets[j];
    const onlyLeft = setDifference(leftSet, rightSet);
    const onlyRight = setDifference(rightSet, leftSet);
    if (onlyLeft.length > 0 || onlyRight.length > 0) {
      errors.push(
        `native binary-wrapper mismatch between ${leftName} and ${rightName}: ` +
          `only in ${leftName}: ${onlyLeft.join(', ') || '(none)'}; ` +
          `only in ${rightName}: ${onlyRight.join(', ') || '(none)'}`,
      );
    }
  }
}

console.log('validate:packages coverage:');
console.log(`  workspace packages discovered: ${workspacePackages.length}`);
console.log(`  inventory entries: ${Object.keys(inventory).length}`);
console.log(`  classified workspace packages: ${classified.size}`);
console.log(`  native inventory: ${formatSet(nativeInventory)}`);
console.log(`  node optional deps: ${formatSet(nodeOptional)}`);
console.log(`  napi mappings: ${formatSet(napiPackageMap)}`);
console.log(`  publish matrix packages: ${formatSet(publishNativePackages)}`);

// 6. Verify every inventory entry was seen in the workspace
//    (catches stale inventory entries for removed packages)
for (const inventoryName of Object.keys(inventory)) {
  if (!classified.has(inventoryName)) {
    errors.push(`${inventoryName}: listed in package-inventory.jsonc but not found in workspace`);
  }
}

// 7. Verify public/semi-public packages do not export host-adapters/* subpaths.
//    Host adapters are product-internal composition roots and must never leak
//    into the public API surface of shell, @mog-sdk/sdk, or @mog-sdk/embed.
const HOST_ADAPTER_EXPORT_BAN = ['@mog/shell', '@mog-sdk/sdk', '@mog-sdk/embed'];
for (const pkgName of HOST_ADAPTER_EXPORT_BAN) {
  const entry = workspaceByName.get(pkgName);
  if (!entry) continue;
  const exportsMap = entry.manifest.exports || {};
  for (const key of Object.keys(exportsMap)) {
    if (key.includes('host-adapter')) {
      errors.push(
        `${pkgName}: exports map contains "${key}" — host-adapters must not be publicly exported`,
      );
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────

if (errors.length > 0) {
  console.error(
    `validate:packages FAILED (${errors.length} error${errors.length === 1 ? '' : 's'}):\n`,
  );
  for (const e of errors) {
    console.error(`  ERROR: ${e}`);
  }
  process.exit(1);
}

console.log(`validate:packages PASSED -- ${workspacePackages.length} packages verified.`);
