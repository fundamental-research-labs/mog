/**
 * Browser-native wire codec for the collaboration WebSocket protocol.
 *
 * Produces byte-identical output to the server's Node.js implementation
 * at `runtime/server/src/wire-format.ts`, using only `DataView`/`Uint8Array`
 * (no Node.js `Buffer` dependency).
 *
 * Binary layout:
 *   byte 0:    message type
 *   bytes 1+:  payload
 *
 * For pure-JSON messages (JOIN_REQUEST, LOCK_*, etc.):
 *   [type: 1 byte] [JSON payload as UTF-8]
 *
 * For binary+metadata messages (PUSH, PULL, JOIN_RESPONSE, BROADCAST_NUDGE):
 *   [type: 1 byte] [jsonLen: 4 bytes big-endian] [JSON metadata as UTF-8] [raw binary]
 */

// ---------------------------------------------------------------------------
// Message types (must match runtime/server/src/wire-format.ts)
// ---------------------------------------------------------------------------

export const MSG = {
  JOIN_REQUEST: 0x01,
  JOIN_RESPONSE: 0x02,
  PUSH: 0x03,
  PUSH_RESPONSE: 0x04,
  PULL_REQUEST: 0x05,
  PULL_RESPONSE: 0x06,
  LOCK_ACQUIRE: 0x07,
  LOCK_RELEASE: 0x08,
  LOCK_RESPONSE: 0x09,
  LOCK_LIST_REQ: 0x0a,
  LOCK_LIST_RES: 0x0b,
  BROADCAST_NUDGE: 0x0c,
  AWARENESS_UPDATE: 0x0d,
  ROOM_SNAPSHOT: 0x0e,
  ROOM_SNAPSHOT_RESPONSE: 0x0f,
  RESUME_REQUEST: 0x10,
  RESUME_RESPONSE: 0x11,
} as const;

export type MsgType = (typeof MSG)[keyof typeof MSG];

// ---------------------------------------------------------------------------
// Decoded message shape
// ---------------------------------------------------------------------------

export interface DecodedMessage {
  type: MsgType;
  json: unknown;
  binary?: Uint8Array;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Message types that use the binary+metadata wire format. */
const BINARY_TYPES: ReadonlySet<number> = new Set([
  MSG.PUSH,
  MSG.PUSH_RESPONSE,
  MSG.PULL_REQUEST,
  MSG.PULL_RESPONSE,
  MSG.JOIN_RESPONSE,
  MSG.RESUME_RESPONSE,
  MSG.BROADCAST_NUDGE,
  MSG.AWARENESS_UPDATE,
  MSG.ROOM_SNAPSHOT_RESPONSE,
]);

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** Encode a pure-JSON message: [type: 1 byte] [JSON payload as UTF-8]. */
export function encodeJson(type: number, payload: unknown): Uint8Array {
  const jsonBytes = textEncoder.encode(JSON.stringify(payload));
  const buf = new Uint8Array(1 + jsonBytes.length);
  buf[0] = type;
  buf.set(jsonBytes, 1);
  return buf;
}

/**
 * Encode a binary+metadata message:
 *   [type: 1 byte] [jsonLen: 4 bytes big-endian] [JSON metadata as UTF-8] [raw binary]
 */
export function encodeBinary(type: number, meta: unknown, binary: Uint8Array): Uint8Array {
  const jsonBytes = textEncoder.encode(JSON.stringify(meta));
  const buf = new Uint8Array(1 + 4 + jsonBytes.length + binary.length);
  buf[0] = type;

  // Write jsonLen as 4-byte big-endian uint32
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(1, jsonBytes.length, false); // false = big-endian

  buf.set(jsonBytes, 5);
  buf.set(binary, 5 + jsonBytes.length);
  return buf;
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/** Decode a raw WebSocket frame into type + json + optional binary. */
export function decode(data: ArrayBuffer | Uint8Array): DecodedMessage {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (bytes.length < 1) {
    throw new Error('Empty message');
  }

  const type = bytes[0] as MsgType;

  if (BINARY_TYPES.has(type)) {
    if (bytes.length < 5) {
      throw new Error(`Binary message too short: ${bytes.length} bytes`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const jsonLen = view.getUint32(1, false); // big-endian
    const jsonEnd = 5 + jsonLen;
    if (bytes.length < jsonEnd) {
      throw new Error(`Message truncated: need ${jsonEnd}, got ${bytes.length}`);
    }
    const json: unknown = JSON.parse(textDecoder.decode(bytes.subarray(5, jsonEnd)));
    const binary = bytes.subarray(jsonEnd);
    return { type, json, binary };
  }

  // LOCK_LIST_REQ with no payload
  if (type === MSG.LOCK_LIST_REQ && bytes.length === 1) {
    return { type, json: null };
  }

  // Pure-JSON messages
  const json: unknown = JSON.parse(textDecoder.decode(bytes.subarray(1)));
  return { type, json };
}
