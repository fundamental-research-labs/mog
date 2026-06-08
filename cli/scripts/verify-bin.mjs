import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(cliRoot, 'package.json'), 'utf8'));
const fix = process.argv.includes('--fix');
const failures = [];

for (const [name, target] of binEntries(manifest)) {
  if (!target.startsWith('./dist/')) {
    failures.push(`bin.${name} target ${target} must point at ./dist/*`);
    continue;
  }

  const path = resolve(cliRoot, target);
  if (!existsSync(path)) {
    failures.push(`bin.${name} target is missing: ${target}`);
    continue;
  }

  const source = readFileSync(path, 'utf8');
  if (!source.startsWith('#!/usr/bin/env node')) {
    failures.push(`bin.${name} target ${target} is missing the node shebang`);
  }

  const mode = statSync(path).mode;
  if ((mode & 0o111) === 0) {
    if (fix) {
      chmodSync(path, mode | 0o755);
    } else {
      failures.push(`bin.${name} target ${target} is not executable`);
    }
  }
}

if (failures.length > 0) {
  console.error(`verify-bin FAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`verify-bin PASSED -- ${manifest.name} exposes ${binEntries(manifest).length} bin`);

function binEntries(pkg) {
  if (!pkg.bin) return [];
  if (typeof pkg.bin === 'string') return [[pkg.name ?? '<unnamed>', pkg.bin]];
  if (typeof pkg.bin !== 'object' || Array.isArray(pkg.bin)) return [];
  return Object.entries(pkg.bin).filter(([, target]) => typeof target === 'string');
}
