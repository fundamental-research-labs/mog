/**
 * Platform Transport Module (browser build)
 *
 * Browser-specific entry point that excludes NAPI transport code.
 * NAPI transports depend on native Node.js addons that cannot be resolved by
 * browser bundlers.
 *
 * The full entry point (index.ts) is used in Node.js environments via
 * conditional exports in package.json.
 *
 * Provides transport implementations for:
 * - Tauri IPC (desktop)
 * - WASM (web)
 */

// Factory — primary entry point (browser variant: Tauri + WASM only)
export { createTransport } from './factory.browser';

// Transport implementations (browser-compatible only)
export { createTauriTransport } from './tauri-transport';
export { createWasmTransport } from './wasm-transport';

// WASM loader
export { getWasmModule, loadWasmModule, resetWasmModule } from './wasm-loader';

// Middleware
export {
  BYTES_TUPLE_COMMANDS,
  createBytesTupleNormalizingTransport,
  normalizeBytesTuple,
  unpackBytesTuple,
} from './bytes-tuple';
export { createCaseNormalizingTransport, deepSnakeToCamel, snakeToCamel } from './case-normalize';
export { RECALC_COMMANDS, createTimeInjectingTransport } from './time-injection';

// Environment detection
export { isNodeEnvironment, isTauri } from './detection';

// Types (no runtime napi dependencies — safe for browser)
export type { BridgeTransport, TransportConfig, WasmInitFn, WasmModule } from './types';

// Errors
export { TransportError, TrapError } from './errors';

// Tagged-error contract (Track R3) — typed discriminated union mirroring
// Rust ComputeError / ComputeApiError. Replaces substring-matching on
// error messages with `kind === '...'` checks.
export { BRIDGE_ERROR_SENTINEL, isBridgeErrorKind, parseBridgeError } from './bridge-error';
export type {
  BridgeError,
  BridgeErrorKind,
  CellErrorError,
  CellNotFoundError,
  CycleError,
  DeadlineExceededError,
  DepthLimitError,
  DeserializeError,
  DocNotFoundError,
  EngineShutdownError,
  EvalError,
  ExportError,
  InternalPanicError,
  InvalidAddressError,
  InvalidInputError,
  InvalidOperationError,
  InvalidRangeError,
  OperationLimitError,
  ParseError,
  PartialArrayWriteError,
  SecurityDeniedError,
  SheetNotFoundEngineError,
  SlicerIdConflictError,
  SlicerNotFoundError,
  SlicerSheetMismatchError,
  ThreadSpawnError,
  UuidParseError,
} from './bridge-error';
