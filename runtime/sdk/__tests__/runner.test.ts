/**
 * Script runner — executes a user-provided script with a ready Workbook.
 *
 * Invoked via: HEADLESS_SCRIPT=path/to/script.ts npx jest __tests__/runner.test.ts
 *        or:   node run.cjs path/to/script.ts
 *
 * The script is imported as a module that exports a default async function:
 *
 *   export default async function (wb: Workbook) { ... }
 *
 * The workbook is fully booted before your function runs and disposed after.
 * All console.log output appears in the terminal.
 */

import type { Workbook } from '../src/index';

describe('Script Runner', () => {
  let wb: Workbook;

  afterEach(async () => {
    if (wb) await wb.dispose();
  });

  test('run', async () => {
    const scriptPath = process.env.HEADLESS_SCRIPT;
    if (!scriptPath) {
      console.log('No HEADLESS_SCRIPT set — skipping.');
      return;
    }

    const { createWorkbook } = await import('../src/index');
    wb = await createWorkbook();

    // Import the user script and call its default export
    const mod = await import(scriptPath);
    const fn = mod.default ?? mod.run;
    if (typeof fn !== 'function') {
      throw new Error(
        `Script must export a default function or a named "run" function.\n` +
          `  export default async function(wb) { ... }\n` +
          `  // or\n` +
          `  export async function run(wb) { ... }`,
      );
    }
    await fn(wb);
  });
});
