/**
 * Platform Transport Module
 *
 * Provides transport implementations for the Rust bridge across three platforms:
 * - Tauri IPC (desktop)
 * - WASM (web)
 * - NAPI (Node.js / headless)
 *
 * The kernel receives a pre-configured BridgeTransport via dependency injection.
 * Use `createTransport()` for automatic environment detection, or the
 * transport-specific create functions for explicit control.
 */

// Factory — primary entry point
export { createTransport } from './factory';

// Transport implementations
export {
  createHeadlessNapiTransport,
  createNapiTimeInjectingTransport,
  createNapiTransport,
} from './napi-transport';
export { createTauriTransport } from './tauri-transport';
export { createWasmTransport } from './wasm-transport';

// NAPI loader
export { AddonNotFoundError, loadNapiAddon, tryLoadNapiAddon } from './napi-loader';

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

// Types
export type { NapiAddonModule } from './napi-loader';
export type {
  BridgeTransport,
  NapiAddon,
  NapiComputeEngine,
  NapiSerdeParamMap,
  TransportConfig,
  WasmInitFn,
  WasmModule,
} from './types';

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
