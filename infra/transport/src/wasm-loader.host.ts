import type { WasmInitFn, WasmModule } from './types';

export interface LoadWasmModuleOptions {
  readonly initFns?: WasmInitFn[];
  readonly wasmModule?: WebAssembly.Module | Promise<WebAssembly.Module>;
}

type WasmModuleSource =
  | { readonly kind: 'host-module'; readonly module: WebAssembly.Module }
  | { readonly kind: 'default' };

let wasmModule: WasmModule | null = null;
let wasmLoadPromise: Promise<void> | null = null;
let wasmModuleSource: WasmModuleSource | null = null;
let wasmLoadingModuleSource: WasmModuleSource | null = null;

export async function loadWasmModule(
  initFnsOrOptions?: WasmInitFn[] | LoadWasmModuleOptions,
): Promise<void> {
  const options = Array.isArray(initFnsOrOptions)
    ? { initFns: initFnsOrOptions }
    : (initFnsOrOptions ?? {});
  const hostModule = await resolveHostWasmModule(options.wasmModule);

  if (wasmModule) {
    assertCompatibleWasmModuleSource(hostModule);
    return;
  }
  if (wasmLoadPromise) {
    assertCompatibleWasmModuleSource(hostModule, wasmLoadingModuleSource);
    return wasmLoadPromise;
  }

  wasmLoadingModuleSource = hostModule
    ? { kind: 'host-module', module: hostModule }
    : { kind: 'default' };

  wasmLoadPromise = (async () => {
    try {
      const mod = await import('@mog-sdk/wasm');
      if (typeof mod.default !== 'function') {
        throw new Error('@mog-sdk/wasm default init function is missing');
      }

      if (hostModule) {
        await mod.default({ module_or_path: hostModule });
        wasmModuleSource = { kind: 'host-module', module: hostModule };
      } else {
        await mod.default();
        wasmModuleSource = { kind: 'default' };
      }
      wasmModule = mod;
      wasmLoadingModuleSource = null;

      if (options.initFns) {
        for (const fn of options.initFns) {
          fn(mod);
        }
      }
    } catch (error) {
      wasmModule = null;
      wasmModuleSource = null;
      wasmLoadPromise = null;
      wasmLoadingModuleSource = null;
      throw error;
    }
  })();

  return wasmLoadPromise;
}

export function getWasmModule(): WasmModule | null {
  return wasmModule;
}

async function resolveHostWasmModule(
  module: WebAssembly.Module | Promise<WebAssembly.Module> | undefined,
): Promise<WebAssembly.Module | undefined> {
  return module === undefined ? undefined : module;
}

function assertCompatibleWasmModuleSource(
  hostModule: WebAssembly.Module | undefined,
  source: WasmModuleSource | null = wasmModuleSource,
): void {
  if (!hostModule || !source) return;
  if (source.kind === 'host-module' && source.module === hostModule) return;
  throw new Error('WASM module singleton is already initialized with a different module source');
}

export function resetWasmModule(): void {
  if (wasmModule) {
    const mod = wasmModule as WasmModule & {
      reset_formula_context?: () => void;
      reset_compute_engine?: () => void;
    };
    try {
      mod.reset_formula_context?.();
      mod.reset_compute_engine?.();
    } catch {
      // Best-effort reset only; replacing the singleton is the important part.
    }
  }
  wasmModule = null;
  wasmLoadPromise = null;
  wasmModuleSource = null;
  wasmLoadingModuleSource = null;
}
