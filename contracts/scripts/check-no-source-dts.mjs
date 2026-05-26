#!/usr/bin/env node

import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const srcRoot = resolve(root, 'src');
const failures = [];

function walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (entry.endsWith('.d.ts')) {
      failures.push(relative(root, fullPath));
    }
  }
}

walk(srcRoot);

if (failures.length > 0) {
  console.error('contracts source contains generated declaration files:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error(
    'Delete generated contracts/src/**/*.d.ts files; declarations must be emitted to dist or a temp build directory.',
  );
  process.exit(1);
}
