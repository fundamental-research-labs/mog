import { jest } from '@jest/globals';

const wasmInit = jest.fn(async () => undefined);
const wasmReset = jest.fn();
const wasmExports = {
  default: wasmInit,
  __wbindgen_reset: wasmReset,
  compute_set_current_time: jest.fn(),
};

jest.unstable_mockModule('@mog-sdk/wasm', () => wasmExports);

const { getWasmModule, loadWasmModule, resetWasmModule } = await import('../wasm-loader');

describe('wasm-loader host-provided module', () => {
  afterEach(() => {
    resetWasmModule();
    wasmInit.mockClear();
    wasmReset.mockClear();
  });

  it('initializes @mog-sdk/wasm with a host-provided WebAssembly.Module', async () => {
    const hostModule = emptyWasmModule();
    const initFn = jest.fn();

    await loadWasmModule({ wasmModule: hostModule, initFns: [initFn] });

    expect(wasmInit).toHaveBeenCalledWith({ module_or_path: hostModule });
    expect(initFn).toHaveBeenCalledWith(expect.objectContaining({ default: wasmInit }));
    expect(getWasmModule()).toMatchObject({ default: wasmInit });
  });

  it('rejects a later different host module for the singleton', async () => {
    const firstModule = emptyWasmModule();
    const secondModule = emptyWasmModule();

    await loadWasmModule({ wasmModule: firstModule });

    await expect(loadWasmModule({ wasmModule: secondModule })).rejects.toThrow(
      'WASM module singleton is already initialized with a different module source',
    );
  });

  it('accepts a later call with the same host module', async () => {
    const hostModule = emptyWasmModule();

    await loadWasmModule({ wasmModule: hostModule });
    await expect(loadWasmModule({ wasmModule: hostModule })).resolves.toBeUndefined();

    expect(wasmInit).toHaveBeenCalledTimes(1);
  });

  it('rejects a different host module while initialization is in flight', async () => {
    const firstModule = emptyWasmModule();
    const secondModule = emptyWasmModule();
    let releaseInit!: () => void;
    wasmInit.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseInit = resolve;
        }),
    );

    const firstLoad = loadWasmModule({ wasmModule: firstModule });
    await expect(loadWasmModule({ wasmModule: secondModule })).rejects.toThrow(
      'WASM module singleton is already initialized with a different module source',
    );
    while (!releaseInit) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    releaseInit();
    await firstLoad;
  });
});

function emptyWasmModule(): WebAssembly.Module {
  return new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
}
