import {
  cpSync,
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadPackageInventory,
  packageManifestHasPrivateFriendExports,
  stripPrivateFriendExportsFromManifest,
} from './package-export-dispositions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..');

export function loadJsonc(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(
    raw
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*([\]}])/g, '$1'),
  );
}

export function discoverWorkspacePackages(root = REPO_ROOT) {
  const workspace = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf-8');
  const patterns = [];
  let inPackages = false;

  for (const line of workspace.split('\n')) {
    if (/^packages:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const match = line.match(/^\s+-\s+['"]([^'"]+)['"]$/);
    if (match) {
      patterns.push(match[1]);
    } else if (/^\S/.test(line) && line.trim()) {
      break;
    }
  }

  const packages = new Map();
  for (const pattern of patterns) {
    const matches =
      pattern === '.'
        ? [resolve(root, 'package.json')]
        : globSync(resolve(root, pattern, 'package.json'));

    for (const manifestPath of matches) {
      if (
        manifestPath.includes('/node_modules/') ||
        manifestPath.includes('/target') ||
        manifestPath.includes('/.claude/')
      ) {
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (manifest.name) {
        packages.set(manifest.name, {
          dir: dirname(manifestPath),
          manifest,
          manifestPath,
        });
      }
    }
  }

  return packages;
}

export function publicPackageNames(inventory = loadPackageInventory(REPO_ROOT)) {
  return Object.entries(inventory)
    .filter(([, entry]) => ['ship-public', 'binary-wrapper'].includes(entry.disposition))
    .map(([name, entry]) => entry.publicTarget ?? name)
    .sort();
}

export function buildPublicPackageManifest(manifest, options = {}) {
  const inventory = options.inventory ?? loadPackageInventory(REPO_ROOT);
  const workspacePackages = options.workspacePackages ?? new Map();
  const packageName = manifest.name;
  const inventoryEntry = inventory[packageName];
  if (!inventoryEntry || !['ship-public', 'binary-wrapper'].includes(inventoryEntry.disposition)) {
    throw new Error(`${packageName ?? '<unnamed>'}: package is not a public pack target`);
  }

  let next = structuredClone(manifest);
  if (packageManifestHasPrivateFriendExports(inventory, next)) {
    next = stripPrivateFriendExportsFromManifest(inventory, next);
  }

  next = applyPublishConfigOverrides(next);
  next.exports = stripDevelopmentConditions(next.exports);

  rewriteDependencyField(next, 'dependencies', workspacePackages, inventory);
  rewriteDependencyField(next, 'peerDependencies', workspacePackages, inventory);
  rewriteDependencyField(next, 'optionalDependencies', workspacePackages, inventory);
  delete next.devDependencies;

  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    if (next[field] && Object.keys(next[field]).length === 0) {
      delete next[field];
    }
  }

  rejectForbiddenProtocols(next);
  return next;
}

function applyPublishConfigOverrides(manifest) {
  const next = structuredClone(manifest);
  if (next.publishConfig?.exports) {
    next.exports = next.publishConfig.exports;
  }
  if (next.publishConfig?.main) {
    next.main = next.publishConfig.main;
  }
  if (next.publishConfig?.types) {
    next.types = next.publishConfig.types;
  }
  return next;
}

function stripDevelopmentConditions(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripDevelopmentConditions(item));
  }
  const next = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'development') continue;
    next[key] = stripDevelopmentConditions(nested);
  }
  return next;
}

function rewriteDependencyField(manifest, field, workspacePackages, inventory) {
  const deps = manifest[field];
  if (!deps || Array.isArray(deps)) return;

  for (const [depName, spec] of Object.entries(deps)) {
    if (!isForbiddenProtocol(spec)) continue;
    const depInventory = inventory[depName];
    const depManifest = workspacePackages.get(depName)?.manifest;
    if (
      depInventory &&
      ['ship-public', 'binary-wrapper'].includes(depInventory.disposition) &&
      depManifest?.version
    ) {
      deps[depName] = depManifest.version;
      continue;
    }
    throw new Error(
      `${manifest.name}: ${field}.${depName} uses unpublished workspace spec ${spec}`,
    );
  }
}

function rejectForbiddenProtocols(manifest) {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [depName, spec] of Object.entries(manifest[field] ?? {})) {
      if (isForbiddenProtocol(spec)) {
        throw new Error(`${manifest.name}: ${field}.${depName} still uses forbidden spec ${spec}`);
      }
    }
  }
}

function isForbiddenProtocol(spec) {
  return (
    typeof spec === 'string' &&
    (spec.startsWith('workspace:') || spec.startsWith('file:') || spec.startsWith('link:'))
  );
}

export function createPublicPackageDirectory(packageDir, options = {}) {
  const root = options.root ?? REPO_ROOT;
  const inventory = options.inventory ?? loadPackageInventory(root);
  const workspacePackages = options.workspacePackages ?? discoverWorkspacePackages(root);
  const manifestPath = resolve(packageDir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const publicManifest = buildPublicPackageManifest(manifest, { inventory, workspacePackages });
  const outDir = options.outDir ?? mkdtempSync(resolve(tmpdir(), 'mog-public-package-'));

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  copyDeclaredPackageFiles(packageDir, outDir, publicManifest);
  writeFileSync(resolve(outDir, 'package.json'), `${JSON.stringify(publicManifest, null, 2)}\n`);
  return outDir;
}

function copyDeclaredPackageFiles(packageDir, outDir, manifest) {
  for (const entry of manifest.files ?? []) {
    if (typeof entry !== 'string') continue;
    const normalized = entry.replace(/^\.\//, '').replace(/\/+$/, '');
    if (!normalized || normalized.includes('..')) continue;

    const source = resolve(packageDir, normalized);
    if (!existsSync(source)) continue;

    const destination = resolve(outDir, normalized);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true });
  }
}
