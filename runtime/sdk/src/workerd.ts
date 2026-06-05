import computeWasmModule from '@mog-sdk/wasm/wasm';
import { createWorkbook as createWasmWorkbook } from './wasm';
import type { CreateWorkbookOptions } from './wasm';

export * from './wasm';
export type * from './wasm';

type CreateWasmWorkbook = typeof createWasmWorkbook;

function withDefaultWasmModule(options: CreateWorkbookOptions): CreateWorkbookOptions {
  return {
    ...options,
    wasmModule: options.wasmModule ?? computeWasmModule,
  };
}

export const createWorkbook = ((arg?: unknown, importOptions?: unknown) => {
  if (arg instanceof Uint8Array) {
    return createWasmWorkbook(
      withDefaultWasmModule({
        xlsx: arg,
        importOptions: importOptions as CreateWorkbookOptions['importOptions'],
      }),
    );
  }
  if (arg && typeof arg === 'object') {
    return createWasmWorkbook(withDefaultWasmModule(arg as CreateWorkbookOptions));
  }
  if (arg === undefined) {
    return createWasmWorkbook(withDefaultWasmModule({}));
  }
  return createWasmWorkbook(arg as never, importOptions as never);
}) as CreateWasmWorkbook;
