#!/usr/bin/env node
/**
 * Interactive script runner for @mog/sdk.
 *
 * Usage:
 *   node run.cjs <script.ts>     — run a TypeScript script with full module resolution
 *   node run.cjs                 — run the default example (examples/hello.ts)
 *
 * The script file receives a ready-to-use Workbook as its argument.
 * Module resolution matches the jest config so all @mog/* imports work.
 *
 * Under the hood this spawns jest with a thin test wrapper that:
 * 1. Boots the engine
 * 2. Runs your script
 * 3. Prints output
 * 4. Disposes the engine
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const scriptArg = process.argv[2] || 'examples/hello.ts';
const scriptPath = path.resolve(__dirname, scriptArg);

if (!fs.existsSync(scriptPath)) {
  console.error(`Script not found: ${scriptPath}`);
  console.error(`\nUsage: node run.cjs <script.ts>`);
  console.error(`       node run.cjs                 (runs examples/hello.ts)`);
  process.exit(1);
}

// Set env var so the runner wrapper knows which script to load
process.env.HEADLESS_SCRIPT = scriptPath;

try {
  execSync(`npx jest --config jest.config.cjs --verbose __tests__/runner.test.ts`, {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, HEADLESS_SCRIPT: scriptPath },
  });
} catch {
  // jest exit code propagates
  process.exit(1);
}
