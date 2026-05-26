import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..');

export const VALID_EXPORT_DISPOSITIONS = new Set([
  'public-experimental',
  'workspace-private-friend',
  'reserved',
]);

export function loadJsonc(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(
    raw
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*([\]}])/g, '$1'),
  );
}

export function loadPackageInventory(root = REPO_ROOT) {
  return loadJsonc(resolve(root, 'tools/package-inventory.jsonc'));
}

export function exportDispositionFor(inventory, packageName, subpath) {
  const packageEntry = inventory[packageName];
  return packageEntry?.exports?.[subpath] ?? null;
}

export function isPrivateFriendExport(inventory, packageName, subpath) {
  return (
    exportDispositionFor(inventory, packageName, subpath)?.disposition ===
    'workspace-private-friend'
  );
}

export function isPublicExportSubpath(inventory, packageName, subpath) {
  return !isPrivateFriendExport(inventory, packageName, subpath);
}

export function exportMapEntries(manifest) {
  const exportsField = manifest.exports;
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) {
    return [];
  }
  return Object.entries(exportsField);
}

export function publicExportMapEntries(inventory, manifest) {
  return exportMapEntries(manifest).filter(([subpath]) =>
    isPublicExportSubpath(inventory, manifest.name, subpath),
  );
}

export function publicExportsMap(inventory, manifest) {
  const entries = publicExportMapEntries(inventory, manifest);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

export function stripPrivateFriendExportsFromManifest(inventory, manifest) {
  const next = structuredClone(manifest);
  const publicExports = publicExportsMap(inventory, manifest);
  if (publicExports) {
    next.exports = publicExports;
  } else {
    delete next.exports;
  }
  return next;
}

export function packageManifestHasPrivateFriendExports(inventory, manifest) {
  return exportMapEntries(manifest).some(([subpath]) =>
    isPrivateFriendExport(inventory, manifest.name, subpath),
  );
}

export function assertPublicPackedManifestHasNoPrivateFriendExports(inventory, manifest) {
  const privateSubpaths = exportMapEntries(manifest)
    .filter(([subpath]) => isPrivateFriendExport(inventory, manifest.name, subpath))
    .map(([subpath]) => subpath);

  if (privateSubpaths.length > 0) {
    throw new Error(
      `${manifest.name}: packed public manifest still contains private friend export(s): ${privateSubpaths.join(', ')}`,
    );
  }
}

export function publicDeclarationEntriesFromExports(inventory, manifest) {
  const entries = new Set();

  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.types === 'string') {
      entries.add(value.types.replace(/^\.\//, ''));
    }
    for (const child of Object.values(value)) {
      visit(child);
    }
  }

  for (const [, target] of publicExportMapEntries(inventory, manifest)) {
    visit(target);
  }

  return entries;
}

export function ensurePrivateFriendArtifactsExist(inventory, manifest, packageDir) {
  const errors = [];
  for (const [subpath, target] of exportMapEntries(manifest)) {
    const disposition = exportDispositionFor(inventory, manifest.name, subpath);
    if (disposition?.disposition !== 'workspace-private-friend') continue;
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      errors.push(`${manifest.name} ${subpath}: private friend export target must be an object`);
      continue;
    }
    if ('development' in target) {
      errors.push(
        `${manifest.name} ${subpath}: private friend export must not include a development condition`,
      );
    }
    for (const condition of ['types', 'import']) {
      const value = target[condition];
      if (typeof value !== 'string') {
        errors.push(`${manifest.name} ${subpath}: missing ${condition} target`);
        continue;
      }
      const abs = resolve(packageDir, value);
      if (!existsSync(abs)) {
        errors.push(`${manifest.name} ${subpath}: missing ${condition} artifact ${value}`);
      }
    }
  }
  return errors;
}
