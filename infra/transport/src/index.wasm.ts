export { createTransport } from './factory.wasm';
export { createWasmTransport } from './wasm-transport';
export { getWasmModule, loadWasmModule, resetWasmModule } from './wasm-loader.host';

export {
  BYTES_TUPLE_COMMANDS,
  createBytesTupleNormalizingTransport,
  normalizeBytesTuple,
  unpackBytesTuple,
} from './bytes-tuple';
export { createCaseNormalizingTransport, deepSnakeToCamel, snakeToCamel } from './case-normalize';
export { RECALC_COMMANDS, createTimeInjectingTransport } from './time-injection';

export type { BridgeTransport, TransportConfig, WasmInitFn, WasmModule } from './types';

export { TransportError, TrapError } from './errors';
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
  OperationLimitError,
  ParseError,
  PartialArrayWriteError,
  SecurityDeniedError,
  SheetNotFoundEngineError,
  ThreadSpawnError,
  UuidParseError,
} from './bridge-error';
