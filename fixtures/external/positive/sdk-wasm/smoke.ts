import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import {
  createWorkbook,
  type Workbook,
  type Worksheet,
  type CreateWorkbookOptions,
} from '@mog-sdk/sdk/wasm';

const require = createRequire(import.meta.url);

async function computeWasmModule(): Promise<WebAssembly.Module> {
  const wasmPath = require.resolve('@mog-sdk/wasm/wasm');
  const bytes = await readFile(wasmPath);
  const exact = new Uint8Array(bytes.byteLength);
  exact.set(bytes);
  return WebAssembly.compile(exact.buffer);
}

async function main(): Promise<void> {
  const opts: CreateWorkbookOptions = {
    wasmModule: await computeWasmModule(),
    userTimezone: 'UTC',
  };
  const wb: Workbook = await createWorkbook(opts);

  try {
    const ws: Worksheet = wb.activeSheet;
    await ws.setCell('A1', 42);
    await ws.setCell('A2', '=A1*2');

    const a2 = await ws.getValue('A2');
    if (a2 !== 84) throw new Error(`Expected 84, got ${a2}`);
  } finally {
    await wb.dispose();
  }

  console.log('PASS: sdk-wasm fixture');
}

main().catch((e) => {
  console.error('FAIL: sdk-wasm fixture');
  console.error(e);
  process.exit(1);
});
