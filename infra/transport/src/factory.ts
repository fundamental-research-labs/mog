/**
 * Transport factory — auto-detects the runtime environment and creates
 * the appropriate BridgeTransport.
 *
 * This is the primary entry point for creating transports. Callers that
 * need a specific transport (e.g., headless NAPI) should use the
 * transport-specific create functions directly.
 *
 * Detection order: NAPI (Node.js) -> Tauri (desktop) -> WASM (web).
 *
 * All commands (compute + xlsx) are served by a single module per platform:
 * - NAPI: native compute addon (includes xlsx commands)
 * - Tauri: single IPC channel
 * - WASM: @mog-sdk/wasm module (includes xlsx commands)
 *
 * The separate xlsx-parser-napi and xlsx-api-wasm modules are no longer needed.
 */
import type { BridgeTransport } from '@rust-bridge/client';
import { createBytesTupleNormalizingTransport } from './bytes-tuple';
import { createCaseNormalizingTransport } from './case-normalize';
import { isNodeEnvironment, isTauri } from './detection';
import type { NapiAddonModule } from './napi-loader';
import { tryLoadNapiAddon } from './napi-loader';
import { createLazyNapiTransport, createNapiTimeInjectingTransport } from './napi-transport';
import { createTauriTransport } from './tauri-transport';
import { createTimeInjectingTransport } from './time-injection';
import type { TransportConfig, WasmModule } from './types';
import { getWasmModule, loadWasmModule } from './wasm-loader';
import { createWasmTransport } from './wasm-transport';

/**
 * Create a BridgeTransport with automatic backend detection.
 *
 * Detection order:
 * 1. **NAPI** (Node.js with native addon): fastest — direct FFI to Rust
 * 2. **Tauri** desktop: native Rust via IPC (all commands via single channel)
 * 3. **WASM** (Web fallback): single @mog-sdk/wasm module serves all commands
 *
 * @param config - Optional configuration.
 *   `wasmInitFns` are called after the WASM module is loaded (e.g.,
 *   initTableWasm, initChartWasm). Only relevant for WASM transport.
 *   `napiAddon` overrides automatic NAPI addon discovery (for testing).
 */
export async function createTransport(config?: TransportConfig): Promise<BridgeTransport> {
  // The TZ resolver fed into time-injection. Defaults to UTC for stateless
  // transports (e.g. schema-only) where no workbook session exists. Workbook
  // transports created via `createComputeBridge(ctx, …)` always supply this
  // from `ctx.userTimezone` so TODAY()/NOW() are calendar-correct.
  const getUserTimezone = config?.getUserTimezone ?? (() => 'UTC');

  if (config?.forbidAutoDetect && !config.explicitRuntime) {
    throw new Error('[transport] forbidAutoDetect requires an explicitRuntime transport binding');
  }

  if (config?.explicitRuntime) {
    switch (config.explicitRuntime) {
      case 'napi': {
        if (!config.napiAddon) {
          throw new Error('[transport] explicitRuntime "napi" requires a host-bound napiAddon');
        }
        const computeAddon = config.napiAddon as NapiAddonModule;
        const lazy = createLazyNapiTransport(computeAddon);
        const withTime = createNapiTimeInjectingTransport(lazy, computeAddon, getUserTimezone);
        return createBytesTupleNormalizingTransport(withTime);
      }
      case 'tauri':
        return createBytesTupleNormalizingTransport(createTauriTransport());
      case 'wasm': {
        await loadWasmModule({ initFns: config.wasmInitFns, wasmModule: config.wasmModule });
        const computeBase = createWasmTransport(() => getWasmModule()!);
        const computeTimed = createTimeInjectingTransport(
          computeBase,
          () => getWasmModule()!,
          getUserTimezone,
        );
        return createCaseNormalizingTransport(computeTimed);
      }
    }
  }

  // NAPI: checked first — Node.js environments with native addon available.
  // Falls through to Tauri/WASM if the addon isn't installed (e.g., Jest tests
  // that haven't built the native binary).
  if (isNodeEnvironment()) {
    const computeAddon = config?.napiAddon
      ? (config.napiAddon as NapiAddonModule)
      : tryLoadNapiAddon();
    if (computeAddon) {
      const lazy = createLazyNapiTransport(computeAddon);
      const withTime = createNapiTimeInjectingTransport(lazy, computeAddon, getUserTimezone);
      // NAPI returns bytes-tuples for 21 commands, same encoding as Tauri
      return createBytesTupleNormalizingTransport(withTime);
    }
    // NAPI addon not available — fall through to WASM (graceful for Jest/tests)
  }

  if (isTauri()) {
    return createBytesTupleNormalizingTransport(createTauriTransport());
  }

  // Web: load single @mog-sdk/wasm module (serves both compute and xlsx commands)
  await loadWasmModule({ initFns: config?.wasmInitFns, wasmModule: config?.wasmModule });

  const computeBase = createWasmTransport(() => getWasmModule()!);
  const computeTimed = createTimeInjectingTransport(
    computeBase,
    () => getWasmModule()!,
    getUserTimezone,
  );
  // Apply snake_case → camelCase at the boundary so WASM results match NAPI's
  // shape. Without this, every consumer had to add per-site `?? snake_case`
  // fallbacks for any Rust struct lacking #[serde(rename_all = "camelCase")].
  const computeTransport = createCaseNormalizingTransport(computeTimed);

  return computeTransport;
}
