/**
 * Byte tuple normalization for Tauri transport.
 *
 * Rust commands that return `(Vec<u8>, T)` byte tuples are encoded differently
 * across transports:
 * - WASM: returns proper JS Array [Uint8Array, T] — no normalization needed
 * - Tauri: packs into a single Uint8Array [4-byte LE length][bytes][JSON meta]
 * - NAPI: packs into a single Buffer [4-byte LE length][bytes][JSON meta] (same as Tauri)
 *
 * This module normalizes the Tauri encoding so consumers always receive
 * clean [Uint8Array, T] tuples regardless of transport.
 */
import type { BridgeTransport } from '@rust-bridge/client';

/**
 * Unpack a bytes-tuple response from Tauri's packed binary format.
 * Format: [4-byte LE bytes length][raw bytes][JSON metadata]
 */
export function unpackBytesTuple<T>(packed: Uint8Array): [Uint8Array, T] {
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  const bytesLen = view.getUint32(0, true); // little-endian
  const bytes = packed.subarray(4, 4 + bytesLen);
  const metaBytes = packed.subarray(4 + bytesLen);
  const meta = JSON.parse(new TextDecoder().decode(metaBytes)) as T;
  return [bytes, meta];
}

/**
 * Normalize a bytes-tuple response across transport targets.
 *
 * WASM returns a proper JS Array [Uint8Array, T] — pass-through.
 * Tauri returns a single packed Uint8Array — needs unpackBytesTuple().
 */
export function normalizeBytesTuple<T>(raw: [Uint8Array, T] | Uint8Array): [Uint8Array, T] {
  if (raw instanceof Uint8Array) {
    return unpackBytesTuple<T>(raw);
  }
  return raw;
}

// BYTES_TUPLE_COMMANDS — auto-generated from bridge annotations.
// Regenerate: cargo test -p bridge-ts --test generate_handler_registry -- generate --nocapture
import { BYTES_TUPLE_COMMANDS } from './command-metadata.gen';
export { BYTES_TUPLE_COMMANDS };

/**
 * Wrap a transport to automatically normalize byte-tuple returns.
 *
 * For commands in BYTES_TUPLE_COMMANDS, if the raw result is a single
 * Uint8Array (Tauri's packed format), it is unpacked into [Uint8Array, T].
 * All other commands pass through unchanged.
 *
 * WASM already returns clean tuples so this is a no-op for WASM.
 * This wrapper is primarily needed for the Tauri transport.
 */
export function createBytesTupleNormalizingTransport(inner: BridgeTransport): BridgeTransport {
  return {
    async call<T = unknown>(command: string, args: Record<string, unknown>): Promise<T> {
      const result = await inner.call<T>(command, args);
      if (BYTES_TUPLE_COMMANDS.has(command) && result instanceof Uint8Array) {
        return normalizeBytesTuple(result) as T;
      }
      return result;
    },
  };
}
