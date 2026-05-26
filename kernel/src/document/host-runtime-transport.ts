/**
 * Host runtime-to-transport config mapping.
 *
 * Maps a validated `KernelRuntimeConfig` into an explicit transport/runtime
 * construction input. The host-compliant path NEVER calls a transport factory
 * in auto-detect mode — every runtime kind maps to a concrete, deterministic
 * transport configuration.
 *
 * @see 02b-kernel-host-integration.md "Runtime And Transport Binding"
 */

import type { ValidatedKernelRuntimeConfig } from '@mog-sdk/types-host/kernel';

// ---------------------------------------------------------------------------
// Explicit transport config — no ambient detection
// ---------------------------------------------------------------------------

export interface ExplicitTransportConfig {
  /** Lifecycle environment derived from the runtime kind. */
  readonly environment: 'browser' | 'headless';
  /** Concrete transport backend selected by the authoritative host binding. */
  readonly explicitRuntime: 'wasm' | 'napi' | 'tauri';
  /** WASM base URL for browser-wasm-worker runtime. */
  readonly wasmBaseUrl?: string;
  /** Worker URL for browser-wasm-worker runtime. */
  readonly workerUrl?: string;
  /** Pre-loaded N-API addon handle for node-napi runtime. */
  readonly napiAddon?: unknown;
  /** IPC namespace for tauri-native runtime. */
  readonly ipcNamespace?: string;
}

// ---------------------------------------------------------------------------
// Mapping function
// ---------------------------------------------------------------------------

/**
 * Map a validated host runtime config to an explicit transport config.
 *
 * This function derives `environment` and transport-specific fields from the
 * runtime kind without reading any browser, Node, Tauri, or process globals.
 * Unsupported runtime kinds fail with a descriptive error before engine
 * construction can begin.
 */
export function mapHostRuntimeToTransportConfig(
  runtime: ValidatedKernelRuntimeConfig,
): ExplicitTransportConfig {
  const kind = runtime.config.kind;
  switch (kind) {
    case 'browser-wasm-worker': {
      const config = runtime.config;
      return {
        environment: 'browser',
        explicitRuntime: 'wasm',
        wasmBaseUrl: config.wasmBaseUrl,
        workerUrl: config.workerUrl,
      };
    }

    case 'node-napi':
      return {
        environment: 'headless',
        explicitRuntime: 'napi',
        // N-API addon resolution is host-provided; the addon handle itself
        // will be supplied by the adapter bindings' transport binding, not
        // sniffed from require() or process globals.
      };

    case 'tauri-native': {
      const config = runtime.config;
      return {
        environment: 'browser',
        explicitRuntime: 'tauri',
        ipcNamespace: config.ipcNamespace,
      };
    }

    case 'test':
      return {
        environment: 'headless',
        explicitRuntime: 'napi',
      };

    default:
      throw new Error(
        `[host-runtime-transport] Unsupported runtime kind for host-backed construction: ${kind}`,
      );
  }
}
