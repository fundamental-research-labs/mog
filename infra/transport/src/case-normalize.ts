/**
 * Snake-case → camelCase result normalization at the transport boundary.
 *
 * Rust serde produces snake_case field names by default. The TS contracts
 * layer uses camelCase. The codebase tries to bridge this in two ways:
 *
 * 1. Add `#[serde(rename_all = "camelCase")]` to every Rust struct that
 *    crosses the bridge.
 * 2. Apply `deepSnakeToCamel` at the transport boundary as a safety net.
 *
 * (1) is fragile: any Rust struct missing the attribute (e.g. inner enum
 * variant payloads, newly added types) silently leaks snake_case to JS,
 * where call sites either accept `undefined` (corrupting nested fields) or
 * sprout `?? snake_case` fallback bandaids.
 *
 * (2) is the principled fix and is already what the NAPI transport does
 * (see `napi-transport.ts:deepSnakeToCamel`). This module hoists that
 * normalization into a shared util and a generic transport middleware so
 * the same guarantee applies across NAPI, WASM, and any future transport.
 *
 * The middleware is intentionally conservative about what it normalizes:
 * - `Uint8Array`, `ArrayBuffer`, typed arrays — pass through (binary payloads)
 * - Plain objects and arrays — recursively converted
 * - Tuple returns `[Uint8Array, T]` — second element converted, first preserved
 * - Primitives (string/number/boolean/null/undefined) — pass through
 *
 * @see kernel/src/.. — call sites that consume bridge results expect camelCase
 * @see ~/.claude/projects/.../feedback_wasm_napi_case_conversion.md
 */
import type { BridgeTransport } from '@rust-bridge/client';

/**
 * Convert a single snake_case identifier to camelCase.
 *
 * `start_id`     → `startId`
 * `start_row_id` → `startRowId`
 * `id`           → `id`
 *
 * Mirrors the convention used by `serde_wasm_bindgen` /
 * `#[serde(rename_all = "camelCase")]` so post-hoc normalization produces
 * the same field names as Rust would when the attribute is present.
 *
 * Bridge result keys never start with `_` (Rust serde wouldn't produce that),
 * so a leading underscore is treated like any other and folded into the next
 * letter (`_internal` → `Internal`). This matches NAPI's pre-existing
 * normalizer exactly so the two transports produce byte-identical shapes.
 */
export function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Recursively rename every object key from snake_case to camelCase.
 *
 * Skips binary payloads (Uint8Array / ArrayBuffer / typed arrays) so a
 * `[Uint8Array, MutationResult]` tuple keeps its bytes intact while the
 * metadata struct is normalized.
 *
 * Non-plain objects (Date, Map, Set, class instances) are passed through
 * unchanged — Rust never produces these via serde, so we don't need to
 * handle them, and rewriting their keys would corrupt their internal state.
 */
export function deepSnakeToCamel<T = unknown>(value: unknown): T {
  return _deepSnakeToCamel(value) as T;
}

function _deepSnakeToCamel(value: unknown): unknown {
  // Primitives — pass through
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t !== 'object') return value;

  // Binary payloads — pass through (preserve bytes, do not key-rewrite)
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return value;

  // Arrays — recurse element-wise
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      out[i] = _deepSnakeToCamel(value[i]);
    }
    return out;
  }

  // Plain objects — convert keys
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    // Class instance / Map / Set / etc. — pass through (Rust serde never
    // produces these, and renaming keys on a class would corrupt it).
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    result[snakeToCamel(key)] = _deepSnakeToCamel(v);
  }
  return result;
}

/**
 * Wrap a transport so every result is `deepSnakeToCamel`-normalized.
 *
 * This is the WASM equivalent of NAPI's inline normalization (which sits
 * inside `createNapiTransport` because NAPI also has to JSON.parse string
 * returns). For WASM, where `serde_wasm_bindgen` already produces JS
 * objects, we just need the key-rewrite step.
 *
 * Apply this AFTER `createBytesTupleNormalizingTransport` so binary tuples
 * arrive as `[Uint8Array, T]` (not packed bytes). The deep walker preserves
 * `Uint8Array` and recurses into the metadata `T` only.
 */
export function createCaseNormalizingTransport(inner: BridgeTransport): BridgeTransport {
  return {
    async call<T = unknown>(command: string, args: Record<string, unknown>): Promise<T> {
      const result = await inner.call<unknown>(command, args);
      return deepSnakeToCamel<T>(result);
    },
  };
}
