/**
 * Bridge tagged-error contract — TS side.
 *
 * Mirrors Rust `value_types::ComputeError` and `compute_api::ComputeApiError`.
 * Every transport (WASM, NAPI, Tauri) wraps a structured error with the
 * sentinel envelope `[BRIDGE_ERROR]{json}` (see
 * `infra/rust-bridge/bridge-types/src/lib.rs`); the
 * [`parseBridgeError`] helper here parses that envelope into the
 * discriminated union below so callers can do
 * `if (err.kind === 'PartialArrayWrite')` instead of substring-matching
 * the Display message.
 *
 * Adding a new variant
 * --------------------
 * 1. Add the `#[serde(rename_all = "camelCase")]` variant to
 *    `ComputeError` (or `ComputeApiError`) on the Rust side.
 * 2. Mirror it as a new arm of [`BridgeError`] below — matching the
 *    `kind` field byte-for-byte and field names exactly (camelCase).
 * 3. Run `cargo test -p value-types --lib errors` and the
 *    transport-boundary integration test in
 *    `infra/transport/src/__tests__/bridge-error-shape.test.ts`.
 *
 * The two sides MUST stay in sync. The Rust unit test
 * `compute_error_every_variant_has_kind_field` asserts every Rust
 * variant has a `kind` field; the TS-side coverage test below pins the
 * complete list so a Rust-only addition fails the TS build.
 */

/** Sentinel prefix marking a tagged-JSON bridge error. Mirrors
 * `bridge_types::BRIDGE_ERROR_SENTINEL` in Rust. */
export const BRIDGE_ERROR_SENTINEL = '[BRIDGE_ERROR]';

// -----------------------------------------------------------------------
// Discriminated union — ComputeError variants
// -----------------------------------------------------------------------

/** Formula parse error at a specific position. */
export interface ParseError {
  kind: 'Parse';
  message: string;
  position: number;
}

/** Formula evaluation error. */
export interface EvalError {
  kind: 'Eval';
  message: string;
}

/** Circular dependency detected. */
export interface CycleError {
  kind: 'Cycle';
  cellCount: number;
}

/** Requested document was not found. */
export interface DocNotFoundError {
  kind: 'DocNotFound';
  docId: string;
}

/** Requested sheet was not found (engine-level). */
export interface SheetNotFoundEngineError {
  kind: 'SheetNotFound';
  // The engine-level variant carries `sheetId`. The api-level variant
  // (`ComputeApiError::SheetNotFound { id }`) carries `id` directly;
  // both are surfaced under the same `kind` because the wire shape from
  // Rust passes through `ComputeApiError`'s tagged JSON. The optional
  // fields here capture both forms; consumers should read whichever is
  // present.
  sheetId?: string;
  id?: string;
  message?: string;
}

/** Requested cell was not found. */
export interface CellNotFoundError {
  kind: 'CellNotFound';
  cellId: string;
}

/** UUID string could not be parsed. */
export interface UuidParseError {
  kind: 'UuidParse';
  message: string;
}

/** Deserialization of input data failed. */
export interface DeserializeError {
  kind: 'Deserialize';
  message: string;
}

/** Internal panic caught during computation. */
export interface InternalPanicError {
  kind: 'InternalPanic';
  message: string;
}

/** Maximum number of operations exceeded. */
export interface OperationLimitError {
  kind: 'OperationLimit';
}

/** Maximum recursion depth exceeded. */
export interface DepthLimitError {
  kind: 'DepthLimit';
}

/** Computation deadline exceeded. */
export interface DeadlineExceededError {
  kind: 'DeadlineExceeded';
}

/** XLSX export failed. */
export interface ExportError {
  kind: 'ExportError';
  message: string;
}

/** Input validation failed (invalid arguments, out-of-range values, etc.). */
export interface InvalidInputError {
  kind: 'InvalidInput';
  message: string;
}

/**
 * Caller attempted to edit a single cell that belongs to a CSE
 * (Ctrl+Shift+Enter) array formula. Excel parity: the user must select
 * the entire array extent and reapply the array formula — partial
 * overwrites of CSE arrays are rejected.
 *
 * This is the canonical replacement for the legacy substring check
 * (`msg.includes('PartialArrayWrite')`) — callers should test
 * `kind === 'PartialArrayWrite'` exclusively.
 */
export interface PartialArrayWriteError {
  kind: 'PartialArrayWrite';
  /** Sheet UUID where the rejected write was attempted. */
  sheetId: string;
  /** Row of the rejected write. */
  row: number;
  /** Column of the rejected write. */
  col: number;
  /** Row of the CSE anchor whose extent the write fell inside. */
  anchorRow: number;
  /** Column of the CSE anchor whose extent the write fell inside. */
  anchorCol: number;
}

/** Access denied by the privacy policy engine. */
export interface SecurityDeniedError {
  kind: 'SecurityDenied';
  message?: string;
  // Engine-level shape uses `principalTags` as a comma-joined string;
  // the api-level shape (after `ComputeApiError::promote_security_denied`)
  // uses the same key but a `string` (still flat). Consumers should
  // treat it as opaque.
  principalTags: string;
  target: string;
  required: string;
  actual: string;
  operation: string;
}

// -----------------------------------------------------------------------
// Discriminated union — ComputeApiError-only variants
// -----------------------------------------------------------------------

/** Invalid A1 address string (malformed column letters, row out of range, etc.). */
export interface InvalidAddressError {
  kind: 'InvalidAddress';
  message: string;
  address: string;
  reason: string;
}

/** Invalid range specification. */
export interface InvalidRangeError {
  kind: 'InvalidRange';
  message: string;
  range: string;
  reason: string;
}

/** Operation not valid in current state (e.g., writing to a protected sheet). */
export interface InvalidOperationError {
  kind: 'InvalidOperation';
  message: string;
}

/** Engine returned a cell-level error. */
export interface CellErrorError {
  kind: 'CellError';
  message: string;
  /** Excel-style `#DIV/0!` / `#REF!` / etc. */
  error: string;
}

/** The engine thread has shut down (channel disconnected). */
export interface EngineShutdownError {
  kind: 'EngineShutdown';
  message: string;
}

/** Failed to spawn the engine thread (resource exhaustion). */
export interface ThreadSpawnError {
  kind: 'ThreadSpawn';
  message: string;
}

// -----------------------------------------------------------------------
// Top-level discriminated union
// -----------------------------------------------------------------------

/**
 * Tagged-JSON bridge error envelope. The `kind` field discriminates the
 * variant; field names match the Rust `#[serde(rename_all = "camelCase")]`
 * derived shape.
 *
 * Use [`parseBridgeError`] to materialize from a transport-thrown
 * `Error`/string. Use the `kind` field for typed checks; never do
 * substring matching on `message`.
 */
export type BridgeError =
  | ParseError
  | EvalError
  | CycleError
  | DocNotFoundError
  | SheetNotFoundEngineError
  | CellNotFoundError
  | UuidParseError
  | DeserializeError
  | InternalPanicError
  | OperationLimitError
  | DepthLimitError
  | DeadlineExceededError
  | ExportError
  | InvalidInputError
  | PartialArrayWriteError
  | SecurityDeniedError
  | InvalidAddressError
  | InvalidRangeError
  | InvalidOperationError
  | CellErrorError
  | EngineShutdownError
  | ThreadSpawnError;

/** All `kind` values, useful for exhaustiveness checks. */
export type BridgeErrorKind = BridgeError['kind'];

/**
 * Extract the underlying error message string from any of the shapes a
 * transport can throw: an `Error` object, a `TransportError` (wraps the
 * thrown value as `cause`), a bare string, or `{message: string}`.
 *
 * Walks the `cause` chain (ES2022 chained errors) to find the original
 * thrown value — the bridge envelope is on the original, not on the
 * wrapper that the kernel layer adds.
 */
function extractErrorMessage(err: unknown): string | null {
  if (err == null) return null;
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    // Walk cause chain — the structured envelope is on the originally
    // thrown error (innermost), not on the kernel/transport wrappers.
    let cur: unknown = err;
    while (cur != null) {
      if (typeof cur === 'string') return cur;
      if (cur instanceof Error) {
        if (cur.message) {
          // Prefer the inner-most message that actually carries the
          // sentinel; if no cause has the sentinel, fall back to the
          // outer message.
          const inner = (cur as Error & { cause?: unknown }).cause;
          if (inner != null) {
            cur = inner;
            continue;
          }
          return cur.message;
        }
      }
      const maybe = (cur as { message?: unknown })?.message;
      if (typeof maybe === 'string') return maybe;
      break;
    }
    return err.message ?? null;
  }
  const m = (err as { message?: unknown })?.message;
  return typeof m === 'string' ? m : null;
}

/**
 * Parse a transport-thrown error into a typed [`BridgeError`].
 *
 * Returns `null` when the error is not a structured bridge error — e.g.
 * a transport-layer `TransportError`, a kernel `BridgeError` wrapper,
 * or an unrelated runtime exception.
 *
 * Looks for the `[BRIDGE_ERROR]{...}` sentinel anywhere in the message
 * string (the transport layer may prefix the command name) and parses
 * the JSON payload. The sentinel is byte-for-byte identical between
 * NAPI and WASM because both transports go through
 * `bridge_types::WrapErr(...).bridge_format()`.
 *
 * @example
 * ```ts
 * try { await ws.setCell(...); }
 * catch (err) {
 *   const tagged = parseBridgeError(err);
 *   if (tagged?.kind === 'PartialArrayWrite') {
 *     showToast('You cannot change part of an array formula.');
 *   } else { throw err; }
 * }
 * ```
 */
export function parseBridgeError(err: unknown): BridgeError | null {
  const msg = extractErrorMessage(err);
  if (!msg) return null;
  const idx = msg.indexOf(BRIDGE_ERROR_SENTINEL);
  if (idx < 0) return null;
  const payload = msg.slice(idx + BRIDGE_ERROR_SENTINEL.length);
  // The payload may be followed by trailing data; greedily consume the
  // single JSON object the Rust side emits. Try whole-tail parse first.
  try {
    return JSON.parse(payload) as BridgeError;
  } catch {
    // Fall back to consuming up to the last balanced `}` — robust against
    // appended diagnostic text from outer wrappers.
    let depth = 0;
    let end = -1;
    for (let i = 0; i < payload.length; i++) {
      const c = payload[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) return null;
    try {
      return JSON.parse(payload.slice(0, end)) as BridgeError;
    } catch {
      return null;
    }
  }
}

/**
 * Type guard: returns `true` when `err` is a tagged bridge error of the
 * given `kind`. Convenience for catch-site checks.
 *
 * @example
 * ```ts
 * if (isBridgeErrorKind(err, 'PartialArrayWrite')) { ... }
 * ```
 */
export function isBridgeErrorKind<K extends BridgeErrorKind>(
  err: unknown,
  kind: K,
): err is Extract<BridgeError, { kind: K }> {
  const tagged = parseBridgeError(err);
  return tagged != null && tagged.kind === kind;
}
