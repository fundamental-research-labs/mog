import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPrivateFriendExport,
  publicExportMapEntries,
} from '../../tools/package-export-dispositions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KERNEL_ROOT = resolve(__dirname, '..');
const FORBIDDEN_SOURCE_FACADE_FILES = [
  resolve(KERNEL_ROOT, 'src/public-contracts.ts'),
  resolve(KERNEL_ROOT, 'src/public-declarations/index.ts'),
  resolve(KERNEL_ROOT, 'src/public-declarations/security.ts'),
  resolve(KERNEL_ROOT, 'src/public-declarations/storage.ts'),
];

const INTERNAL_PATTERNS = [
  /from\s+['"]@mog-sdk\/spreadsheet-contracts(?:\/[^'"]*)?['"]/,
  /from\s+['"]@mog-sdk\/types-[^'"]*['"]/,
  /from\s+['"]@mog\/types-[^'"]*['"]/,
  /from\s+['"]@mog\/[^'"]*['"]/,
  /from\s+['"]@rust-bridge\/[^'"]*['"]/,
  /import\(\s*['"]@mog-sdk\/spreadsheet-contracts(?:\/[^'"]*)?['"]\s*\)/,
  /import\(\s*['"]@mog-sdk\/types-[^'"]*['"]\s*\)/,
  /import\(\s*['"]@mog\/types-[^'"]*['"]\s*\)/,
  /import\(\s*['"]@mog\/[^'"]*['"]\s*\)/,
  /import\(\s*['"]@rust-bridge\/[^'"]*['"]\s*\)/,
];

function assertPublicExportTargetsExist() {
  const pkg = JSON.parse(readFileSync(resolve(KERNEL_ROOT, 'package.json'), 'utf8'));
  const publicExportTargets = getPublicExportTargets(pkg);

  const missing = publicExportTargets.filter(({ file }) => !file || !existsSync(file));
  if (missing.length > 0) {
    const details = missing
      .map(
        ({ subpath, condition, file }) =>
          `  ${subpath} ${condition}: ${file ?? '(missing condition)'}`,
      )
      .join('\n');
    throw new Error(`Missing public export target(s):\n${details}`);
  }
}

function assertPublicDeclarationsAreSelfContained() {
  const pkg = JSON.parse(readFileSync(resolve(KERNEL_ROOT, 'package.json'), 'utf8'));

  for (const facadePath of FORBIDDEN_SOURCE_FACADE_FILES) {
    if (existsSync(facadePath)) {
      throw new Error(
        `Kernel public exports must be declared from source entrypoints, not ${relative(KERNEL_ROOT, facadePath)}.`,
      );
    }
  }

  if (existsSync(resolve(KERNEL_ROOT, 'scripts/build-types.mjs'))) {
    throw new Error(
      'Manual public declaration facade script must not exist: scripts/build-types.mjs',
    );
  }
  if (existsSync(resolve(KERNEL_ROOT, 'scripts/build-keyboard-types.mjs'))) {
    throw new Error(
      'Keyboard declaration rollup script must not exist: scripts/build-keyboard-types.mjs',
    );
  }
  if (existsSync(resolve(KERNEL_ROOT, 'api-extractor.keyboard.json'))) {
    throw new Error('Keyboard API Extractor config must not exist: api-extractor.keyboard.json');
  }

  const declarationFiles = getPublicDeclarationFiles(pkg);

  for (const declarationPath of declarationFiles) {
    if (!existsSync(declarationPath)) {
      throw new Error(`Missing public declaration: ${declarationPath}`);
    }

    const declaration = readFileSync(declarationPath, 'utf8');
    const codeOnly = stripCommentsAndStrings(declaration);
    if (/\bunknown\b/.test(codeOnly)) {
      throw new Error(`${relative(KERNEL_ROOT, declarationPath)} erased contracts to unknown.`);
    }
    if (/\bany\b/.test(codeOnly)) {
      throw new Error(`${relative(KERNEL_ROOT, declarationPath)} erased contracts to any.`);
    }

    for (const [index, line] of declaration.split('\n').entries()) {
      for (const pattern of INTERNAL_PATTERNS) {
        if (pattern.test(line)) {
          throw new Error(
            `${relative(KERNEL_ROOT, declarationPath)}:${index + 1} leaked workspace import: ${line.trim()}`,
          );
        }
      }
    }
  }
}

function getPublicExportTargets(pkg) {
  return [...getPublicOnlyExportTargets(pkg), ...getPrivateFriendExportTargets(pkg)];
}

function getPackageInventory() {
  return JSON.parse(
    readFileSync(resolve(KERNEL_ROOT, '../tools/package-inventory.jsonc'), 'utf8')
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*([\]}])/g, '$1'),
  );
}

function getPublicOnlyExportTargets(pkg) {
  const inventory = getPackageInventory();
  return publicExportMapEntries(inventory, pkg).flatMap(([subpath, target]) => {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      return [];
    }

    return ['development', 'import', 'types'].map((condition) => {
      const value = target[condition];
      return {
        subpath,
        condition,
        file: typeof value === 'string' ? resolve(KERNEL_ROOT, value) : null,
      };
    });
  });
}

function getPrivateFriendExportTargets(pkg) {
  const inventory = JSON.parse(
    readFileSync(resolve(KERNEL_ROOT, '../tools/package-inventory.jsonc'), 'utf8')
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*([\]}])/g, '$1'),
  );
  return Object.entries(pkg.exports ?? {}).flatMap(([subpath, target]) => {
    if (!isPrivateFriendExport(inventory, pkg.name, subpath)) return [];
    if (!target || typeof target !== 'object' || Array.isArray(target)) return [];
    if ('development' in target) {
      return [{ subpath, condition: 'development', file: null }];
    }
    return ['import', 'types'].map((condition) => {
      const value = target[condition];
      return {
        subpath,
        condition,
        file: typeof value === 'string' ? resolve(KERNEL_ROOT, value) : null,
      };
    });
  });
}

function getPublicDeclarationFiles(pkg) {
  const privateFriendDeclarationDirs = getPrivateFriendDeclarationDirs(pkg);
  const declarationTargets = getPublicOnlyExportTargets(pkg)
    .filter(({ condition, file }) => condition === 'types' && file)
    .map(({ file }) => file);

  const declarationFiles = new Set();
  for (const declarationPath of declarationTargets) {
    declarationFiles.add(declarationPath);
    if (
      declarationPath.endsWith('/index.d.ts') &&
      dirname(declarationPath) !== resolve(KERNEL_ROOT, 'dist')
    ) {
      for (const nestedDeclaration of findDeclarationFiles(
        dirname(declarationPath),
        privateFriendDeclarationDirs,
      )) {
        declarationFiles.add(nestedDeclaration);
      }
    }
  }

  return [...declarationFiles].sort();
}

function getPrivateFriendDeclarationDirs(pkg) {
  const inventory = getPackageInventory();
  return new Set(
    getPrivateFriendExportTargets(pkg)
      .filter(({ condition, file }) => condition === 'types' && file)
      .map(({ file }) => dirname(file)),
  );
}

function isWithinDir(filepath, dir) {
  const rel = relative(dir, filepath);
  return rel === '' || (!!rel && !rel.startsWith('..') && !rel.startsWith('/'));
}

function findDeclarationFiles(dir, excludedDirs = new Set()) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    const filepath = join(dir, entry);
    const stat = statSync(filepath);
    if (stat.isDirectory()) {
      if ([...excludedDirs].some((excludedDir) => isWithinDir(filepath, excludedDir))) {
        continue;
      }
      files.push(...findDeclarationFiles(filepath, excludedDirs));
    } else if (entry.endsWith('.d.ts') || entry.endsWith('.d.cts') || entry.endsWith('.d.mts')) {
      files.push(filepath);
    }
  }
  return files;
}

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

assertPublicExportTargetsExist();
assertPublicDeclarationsAreSelfContained();

console.log('✓ @mog-sdk/kernel public export declarations validated.');
