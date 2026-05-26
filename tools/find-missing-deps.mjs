#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');

// Get all workspace packages
const pkgList = JSON.parse(
  execSync('pnpm ls -r --json --depth 0', { cwd: ROOT, encoding: 'utf8' }),
);

const BUILTINS = new Set([
  'fs',
  'path',
  'os',
  'crypto',
  'http',
  'https',
  'url',
  'util',
  'stream',
  'buffer',
  'events',
  'child_process',
  'net',
  'tls',
  'dns',
  'readline',
  'assert',
  'querystring',
  'zlib',
  'worker_threads',
  'perf_hooks',
  'v8',
  'module',
  'process',
  'console',
  'cluster',
  'dgram',
  'domain',
  'inspector',
  'string_decoder',
  'timers',
  'tty',
  'vm',
  'wasi',
]);

// Collect all workspace package paths (to skip nested packages when walking)
const workspacePaths = new Set(pkgList.map((p) => p.path).filter(Boolean));
const workspaceNames = new Set(pkgList.map((p) => p.name).filter(Boolean));

function walkDir(dir, extensions, ownPkgPath, results = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo' || entry === '.next')
      continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      // Skip nested workspace packages
      if (full !== ownPkgPath && workspacePaths.has(full)) continue;
      walkDir(full, extensions, ownPkgPath, results);
    } else if (extensions.some((ext) => entry.endsWith(ext)) && !entry.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

function extractImports(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const imports = new Set();

  // Strip comments first to avoid false positives
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/.*$/gm, ''); // line comments

  // import ... from 'pkg'
  // import 'pkg'
  // require('pkg')
  // export ... from 'pkg'
  const regex =
    /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = regex.exec(stripped)) !== null) {
    const mod = match[1] || match[2];
    if (!mod || mod.startsWith('.') || mod.startsWith('/')) continue;

    // Skip obvious non-packages
    if (mod.includes(' ') || mod.includes('$') || mod.startsWith('virtual:')) continue;
    // Skip .node file imports
    if (mod.endsWith('.node')) continue;

    if (mod.startsWith('node:')) {
      imports.add('@types/node');
      continue;
    }

    // Get package name
    let pkgName;
    if (mod.startsWith('@')) {
      const parts = mod.split('/');
      pkgName = parts.slice(0, 2).join('/');
    } else {
      pkgName = mod.split('/')[0];
    }

    // Validate package name (must look like an npm package)
    if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(pkgName)) continue;

    if (BUILTINS.has(pkgName)) {
      imports.add('@types/node');
      continue;
    }

    imports.add(pkgName);
  }
  return imports;
}

const allMissing = {};

for (const pkg of pkgList) {
  if (!pkg.path || !pkg.name) continue;
  // Skip root workspace package
  if (pkg.path === ROOT) continue;

  const pkgJsonPath = join(pkg.path, 'package.json');
  if (!existsSync(pkgJsonPath)) continue;

  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const declared = new Set([
    ...Object.keys(pkgJson.dependencies || {}),
    ...Object.keys(pkgJson.devDependencies || {}),
    ...Object.keys(pkgJson.peerDependencies || {}),
  ]);

  const files = walkDir(pkg.path, ['.ts', '.tsx'], pkg.path);
  const allImports = new Set();

  for (const file of files) {
    try {
      for (const imp of extractImports(file)) {
        allImports.add(imp);
      }
    } catch {}
  }

  const missing = [...allImports]
    .filter((dep) => {
      if (declared.has(dep)) return false;
      if (workspaceNames.has(dep)) return false;
      if (dep === pkg.name) return false;
      return true;
    })
    .sort();

  if (missing.length > 0) {
    const relPath = relative(ROOT, pkg.path);
    allMissing[pkg.name] = { relPath, missing };
  }
}

// Print results grouped by package
console.log('=== MISSING DEPENDENCIES BY PACKAGE ===\n');
for (const [name, { relPath, missing }] of Object.entries(allMissing).sort((a, b) =>
  a[0].localeCompare(b[0]),
)) {
  console.log(`${name} (${relPath}):`);
  for (const m of missing) {
    console.log(`  ${m}`);
  }
  console.log();
}

// Print pnpm add commands
console.log('\n=== COMMANDS TO FIX ===\n');
for (const [name, { relPath, missing }] of Object.entries(allMissing).sort((a, b) =>
  a[0].localeCompare(b[0]),
)) {
  const devDeps = missing.filter(
    (d) =>
      d.startsWith('@types/') ||
      [
        'vitest',
        'playwright-core',
        '@vitejs/plugin-react',
        'vite',
        'vite-plugin-svgr',
        '@testing-library/react',
        '@testing-library/user-event',
      ].includes(d),
  );
  const runtimeDeps = missing.filter((d) => !devDeps.includes(d));

  if (runtimeDeps.length > 0) {
    console.log(`pnpm --filter ${name} add ${runtimeDeps.join(' ')}`);
  }
  if (devDeps.length > 0) {
    console.log(`pnpm --filter ${name} add -D ${devDeps.join(' ')}`);
  }
}

// Summary
console.log('\n=== SUMMARY ===');
const allDeps = new Set();
for (const { missing } of Object.values(allMissing)) {
  for (const m of missing) allDeps.add(m);
}
console.log(`\nTotal unique missing deps: ${allDeps.size}`);
console.log(`Packages affected: ${Object.keys(allMissing).length}`);
