import { createWorkbook, type CreateWorkbookOptions } from '@mog-sdk/sdk';
import { createWorkbook as createWorkerdWorkbook } from '@mog-sdk/sdk/workerd';

declare const computeWasmModule: WebAssembly.Module;

const options: CreateWorkbookOptions = {
  wasmModule: computeWasmModule,
  userTimezone: 'UTC',
};

export default {
  async fetch(): Promise<Response> {
    const wb = await createWorkbook(options);
    const wbFromSubpath = await createWorkerdWorkbook(options);
    try {
      const ws = wb.activeSheet;
      await ws.setCell('A1', 42);
      await ws.setCell('A2', '=A1*2');
      const value = await ws.getValue('A2');
      const subpathWs = wbFromSubpath.activeSheet;
      await subpathWs.setCell('A1', 42);
      await subpathWs.setCell('A2', '=A1*2');
      const subpathValue = await subpathWs.getValue('A2');
      return Response.json({ value, subpathValue });
    } finally {
      await wb.dispose();
      await wbFromSubpath.dispose();
    }
  },
};
