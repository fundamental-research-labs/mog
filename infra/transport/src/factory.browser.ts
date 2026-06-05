/**
 * Transport factory (browser build) — creates Tauri or WASM transports.
 *
 * This is the browser-specific entry point. The NAPI transport path is
 * excluded entirely so that bundlers (Vite, Webpack) never encounter
 * Node.js-only native addon imports in the browser module graph.
 *
 * Detection order: Tauri (desktop) -> WASM (web).
 *
 * All commands (compute + xlsx) are served by a single WASM module
 * (@mog-sdk/wasm). The separate xlsx-wasm module is no longer needed.
 *
 * For Tauri, all commands go through a single IPC channel.
 */
import type { BridgeTransport } from '@rust-bridge/client';
import { createBytesTupleNormalizingTransport } from './bytes-tuple';
import { createCaseNormalizingTransport } from './case-normalize';
import { isTauri } from './detection';
import { createTauriTransport } from './tauri-transport';
import { createTimeInjectingTransport } from './time-injection';
import type { TransportConfig } from './types';
import { getWasmModule, loadWasmModule } from './wasm-loader';
import { createWasmTransport } from './wasm-transport';

/**
 * Create a BridgeTransport with automatic backend detection (browser build).
 *
 * Detection order:
 * 1. **Tauri** desktop: native Rust via IPC (all commands via single channel)
 * 2. **WASM** (Web fallback): single @mog-sdk/wasm module serves all commands
 *
 * @param config - Optional configuration.
 *   `wasmInitFns` are called after the WASM module is loaded (e.g.,
 *   initTableWasm, initChartWasm). Only relevant for WASM transport.
 */
export async function createTransport(config?: TransportConfig): Promise<BridgeTransport> {
  const getUserTimezone = config?.getUserTimezone ?? (() => 'UTC');

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
  return createCaseNormalizingTransport(computeTimed);
}
