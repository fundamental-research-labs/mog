/**
 * Singleton WASM module loader.
 *
 * Loads the @mog-sdk/wasm module once and caches it. Accepts
 * WasmInitFn callbacks to wire up WASM backends (table-engine,
 * chart-bridge, etc.) without hardcoding dependencies.
 */
/// <reference path="./mog-sdk-wasm.d.ts" />
import { TransportError } from './errors';
import { isNodeEnvironment } from './detection';
import type { WasmInitFn, WasmModule } from './types';

let wasmModule: WasmModule | null = null;
let wasmLoadPromise: Promise<void> | null = null;
let wasmModuleSource: WasmModuleSource | null = null;
let wasmLoadingModuleSource: WasmModuleSource | null = null;

type NodeFsPromises = typeof import('node:fs/promises');
type NodeUrl = typeof import('node:url');
type ImportMetaWithResolve = ImportMeta & {
  resolve?: (specifier: string) => string;
};
export interface LoadWasmModuleOptions {
  readonly initFns?: WasmInitFn[];
  readonly wasmModule?: WebAssembly.Module | Promise<WebAssembly.Module>;
}

type WasmModuleSource =
  | { readonly kind: 'host-module'; readonly module: WebAssembly.Module }
  | { readonly kind: 'node-resolved-bytes' }
  | { readonly kind: 'default' };

async function importNodeModule<T>(specifier: string): Promise<T> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<T>;
  return dynamicImport(specifier);
}

async function resolveNodeWasmInitInput(): Promise<ArrayBuffer | undefined> {
  if (!isNodeEnvironment()) return undefined;

  const resolve = (import.meta as ImportMetaWithResolve).resolve;
  if (!resolve) return undefined;

  const wasmUrl = resolve('@mog-sdk/wasm/wasm');
  if (!wasmUrl.startsWith('file:')) return undefined;

  const [{ readFile }, { fileURLToPath }] = await Promise.all([
    importNodeModule<NodeFsPromises>('node:fs/promises'),
    importNodeModule<NodeUrl>('node:url'),
  ]);
  const bytes = await readFile(fileURLToPath(wasmUrl));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Load the WASM module. Idempotent — multiple calls return the same promise.
 *
 * The WASM binary is expected at the path resolved by the bundler for the
 * @mog-sdk/wasm package. wasm-pack --target web produces an ES module
 * with a default export that initializes the WASM binary.
 *
 * @param initFns - Optional callbacks to run after the module is loaded.
 *   Used to wire up WASM backends (e.g., initTableWasm, initChartWasm).
 *   Only called on the first load — subsequent calls are no-ops.
 */
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
      // Dynamic import of the wasm-pack output.
      // The bundler (vite/webpack) resolves this to the built pkg/ directory.
      // The package should be linked/installed as a workspace dependency.
      const mod = (await import(
        /* webpackChunkName: "mog-sdk-wasm" */
        '@mog-sdk/wasm'
      )) as WasmModule;

      // Initialize the WASM binary. In Node, wasm-bindgen's default file URL
      // path goes through fetch(file://...), which undici does not implement.
      // Passing the local bytes keeps Node tests on the intended WASM fallback.
      let moduleInput: ArrayBuffer | WebAssembly.Module | undefined;
      let moduleSource: WasmModuleSource;
      if (hostModule) {
        moduleInput = hostModule;
        moduleSource = { kind: 'host-module', module: hostModule };
      } else {
        const nodeWasmInput = await resolveNodeWasmInitInput();
        moduleInput = nodeWasmInput;
        moduleSource =
          nodeWasmInput === undefined ? { kind: 'default' } : { kind: 'node-resolved-bytes' };
      }

      await mod.default(moduleInput === undefined ? undefined : { module_or_path: moduleInput });
      wasmModule = mod;
      wasmModuleSource = moduleSource;
      wasmLoadingModuleSource = null;

      // Run init callbacks to wire up WASM backends.
      if (options.initFns) {
        for (const fn of options.initFns) {
          fn(mod);
        }
      }
    } catch (err) {
      wasmLoadPromise = null;
      wasmLoadingModuleSource = null;
      throw TransportError.fromCommand(err, 'loadWasmModule');
    }
  })();

  return wasmLoadPromise;
}

/**
 * Get the loaded WASM module. Returns null if not yet loaded.
 */
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

/**
 * Reset the singleton WASM module references so the next
 * {@link loadWasmModule} call instantiates a fresh `WebAssembly.Instance`
 * with fresh linear memory.
 *
 * Used by the trap-recovery coordinator
 * (`shell/src/services/trap-recovery/...`) after a wasm32 trap dead-ends
 * the current instance.
 *
 * Safe to call from any module — if no module is loaded, this is a
 * no-op. Idempotent across recovery attempts.
 *
 * **Two caches must be cleared** for a fresh instance to actually appear:
 *
 *   1. *This module's* `wasmModule` reference (cleared inline below).
 *   2. *wasm-bindgen's* module-private `wasm` / `wasmModule` /
 *      `cachedDataViewMemory0` / `cachedUint8ArrayMemory0` slots inside
 *      `compute_core_wasm.js`. Those are private to the wasm-pack-generated
 *      module and we have no scope into them; without resetting (2), the
 *      next `__wbg_init()` call short-circuits with
 *      `if (wasm !== undefined) return wasm;` and hands us back the *dead*
 *      instance from before the trap. `compute/wasm/build.sh` appends a
 *      `__wbindgen_reset()` export specifically for this purpose; the call
 *      below invokes it when the export is present (the `?.()` guards
 *      against environments where the build hasn't been re-run since the
 *      patch was added).
 *
 * **Caller responsibility:** drop your own references to anything pointing
 * into the old WASM linear memory (cached typed arrays from
 * `wasm.memory.buffer`, ComputeCore instances bound to the old transport,
 * any `__REGISTRY_COMPUTE_SERVICE` views into the dead instance). The GC
 * reclaims the old `WebAssembly.Instance` only when no JS object retains
 * it. The recovery coordinator pairs this call with full ComputeBridge
 * destroy + lifecycle teardown for every doc on the dead instance.
 */
export function resetWasmModule(): void {
  // Clear wasm-bindgen's module-private cache FIRST. Once we drop our
  // own `wasmModule` reference there's no handle left to invoke the
  // exported reset through.
  const reset = wasmModule?.__wbindgen_reset;
  if (typeof reset === 'function') {
    reset();
  }
  wasmModule = null;
  wasmLoadPromise = null;
  wasmModuleSource = null;
  wasmLoadingModuleSource = null;
}
