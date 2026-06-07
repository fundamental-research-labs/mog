/**
 * Transport type definitions for the platform transport layer.
 *
 * Re-exports BridgeTransport from @rust-bridge/client and defines
 * transport-specific interfaces used by the various transport implementations.
 */

// The canonical transport interface — all transports implement this.
export type { BridgeTransport } from '@rust-bridge/client';

/**
 * Interface matching the wasm-bindgen exports from @mog-sdk/wasm.
 * Every exported function is accessed by name and called with positional args.
 */
export interface WasmModule {
  [fn_name: string]: (...args: unknown[]) => unknown;
}

/**
 * Callback invoked after the WASM module is loaded and initialized.
 * Used to wire up WASM backends (table-engine, chart-bridge, etc.)
 * without hardcoding dependencies in the loader.
 *
 * Uses `any` because different consumers (initTableWasm, initChartWasm)
 * type the same WASM module object with different specific interfaces.
 * The runtime object is the same — type safety is at each consumer, not here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WasmInitFn = (mod: any) => void;

/**
 * Interface for the napi addon module (static free functions).
 *
 * Used for accessing static functions like `compute_set_current_time` that
 * are NOT methods on the ComputeEngine class. Also used for loading the
 * addon module from a .node binary path.
 */
export interface NapiAddon {
  [fn_name: string]: (...args: unknown[]) => unknown;
}

/**
 * Interface for a ComputeEngine class instance from the native compute addon.
 *
 * Methods are accessed by their snake_case command name (matching the TS
 * client's command strings). This is ensured by `#[napi(js_name = "...")]`
 * on the Rust side.
 */
export interface NapiComputeEngine {
  [method_name: string]: (...args: unknown[]) => unknown;
}

/**
 * Map from command name to a Set of positional param indices that are
 * `[serde]`-tagged in the napi binding. These indices need their values
 * `JSON.stringify()`'d before passing to the napi function.
 *
 * When provided to `createNapiTransport()`, this map overrides the default
 * heuristic for arg serialization. Without it, the transport uses a
 * type-based heuristic (stringify objects/arrays/null, pass through
 * strings/numbers/booleans) which works correctly for most commands but
 * fails for `[serde]` params that are primitive TS types (e.g.,
 * `Option<&str>` which is `string | null` in TS, or `Option<u32>` which
 * is `number | null`).
 */
export type NapiSerdeParamMap = Record<string, Set<number>>;

/**
 * Configuration for creating a transport via the factory.
 */
export interface TransportConfig {
  /**
   * Host-authoritative runtime binding. When set, the factory uses only the
   * named backend and never performs ambient runtime detection.
   */
  explicitRuntime?: 'wasm' | 'napi' | 'tauri';

  /**
   * Fail closed if `explicitRuntime` is absent or cannot be honored.
   * Host-backed construction sets this so global auto-detect cannot silently
   * choose a transport with authority the host did not bind.
   */
  forbidAutoDetect?: boolean;

  /**
   * Functions to call after the WASM module is loaded and initialized.
   * Used to wire up WASM backends (e.g., initTableWasm, initChartWasm).
   * Only relevant for WASM transport — ignored for Tauri/NAPI.
   */
  wasmInitFns?: WasmInitFn[];

  /**
   * Host-provided WASM module for runtimes that must precompile/bundle the
   * module outside request-time code. When provided, the loader initializes
   * @mog-sdk/wasm with this module and does not read Node file bytes.
   */
  wasmModule?: WebAssembly.Module | Promise<WebAssembly.Module>;

  /**
   * Override NAPI addon module (optional — auto-loaded if not provided).
   * Only relevant for Node.js environments. When provided, skips the
   * automatic native platform package discovery.
   */
  napiAddon?: NapiAddon;

  /**
   * Resolves the active session's IANA timezone name (e.g.
   * `'America/Los_Angeles'`, `'UTC'`). Called before each recalc-triggering
   * command so the injected NOW()/TODAY() serial is computed in the user's
   * calendar frame, not the host process's. Required when the transport
   * handles workbooks bound to a session userTimezone (i.e. anything routed
   * through `createComputeBridge(ctx, ...)`); optional for stateless or
   * host-only transports.
   *
   */
  getUserTimezone?: () => string;
}
