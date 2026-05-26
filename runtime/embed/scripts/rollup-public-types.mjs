/**
 * Roll up source-emitted declarations for public @mog-sdk/embed entrypoints.
 *
 * This is declaration bundling, not a handwritten declaration facade. API
 * Extractor consumes tsup/tsc output and inlines internal workspace types so
 * public package declarations stay self-contained.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMBED_ROOT = resolve(__dirname, '..');
const DIST = resolve(EMBED_ROOT, 'dist');
const ROLLUP_DIR = resolve(DIST, '.rollup');

const ROLLUP_ENTRIES = [
  { config: 'api-extractor.json', stem: 'index' },
  { config: 'api-extractor-react.json', stem: 'react' },
];

mkdirSync(ROLLUP_DIR, { recursive: true });

for (const { config, stem } of ROLLUP_ENTRIES) {
  const configPath = resolve(EMBED_ROOT, config);
  execSync(`npx api-extractor run --config ${configPath} --local`, {
    cwd: EMBED_ROOT,
    stdio: 'inherit',
  });

  const rolledUp = resolve(ROLLUP_DIR, `${stem}.d.ts`);
  if (!existsSync(rolledUp)) {
    throw new Error(`API Extractor did not produce ${rolledUp}`);
  }
  copyFileSync(rolledUp, resolve(DIST, `${stem}.d.ts`));
  copyFileSync(rolledUp, resolve(DIST, `${stem}.d.cts`));
}

rmSync(ROLLUP_DIR, { recursive: true, force: true });
