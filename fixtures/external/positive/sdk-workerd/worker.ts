import { createWorkbook, type CreateWorkbookOptions } from '@mog-sdk/sdk';

declare const computeWasmModule: WebAssembly.Module;

const options: CreateWorkbookOptions = {
  wasmModule: computeWasmModule,
  userTimezone: 'UTC',
};

export default {
  async fetch(): Promise<Response> {
    const wb = await createWorkbook(options);
    try {
      const ws = wb.activeSheet;
      await ws.setCell('A1', 42);
      await ws.setCell('A2', '=A1*2');
      const value = await ws.getValue('A2');
      return Response.json({ value });
    } finally {
      await wb.dispose();
    }
  },
};
