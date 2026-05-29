/**
 * Cross-codec unit tests: verify the browser codec (wire-codec.ts) produces
 * byte-identical output to the server's Node.js codec (wire-format.ts).
 */

import { jest } from '@jest/globals';
import { createRequire } from 'node:module';

import * as browserCodec from '../wire-codec';

type ServerCodec = typeof browserCodec;

const require = createRequire(import.meta.url);
let serverCodec: ServerCodec | null = null;
try {
  const serverCodecPath = require.resolve('@mog/collaboration-server/wire-format');
  serverCodec = (await import(serverCodecPath)) as ServerCodec;
} catch {
  // The collaboration server package is private/internal and is not present in
  // the public repository checkout.
}

const describeWithServerCodec = serverCodec ? describe : describe.skip;

function getServerCodec(): ServerCodec {
  if (!serverCodec) {
    throw new Error('collaboration server codec is not available in this checkout');
  }
  return serverCodec;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert Buffer or Uint8Array to a plain number[] for deep-equal comparison. */
function toArray(buf: Buffer | Uint8Array): number[] {
  return Array.from(buf);
}

// ---------------------------------------------------------------------------
// 1. Byte-identical encoding
// ---------------------------------------------------------------------------

describeWithServerCodec('byte-identical encoding across codecs', () => {
  test('JOIN_REQUEST (pure JSON)', () => {
    const payload = { participantId: 'user-1' };
    const serverCodec = getServerCodec();
    const browserBytes = browserCodec.encodeJson(browserCodec.MSG.JOIN_REQUEST, payload);
    const serverBytes = serverCodec.encodeJson(serverCodec.MSG.JOIN_REQUEST, payload);

    expect(toArray(browserBytes)).toEqual(toArray(serverBytes));
  });

  test('PUSH (binary+meta)', () => {
    const meta = { touchedSheets: ['sheet1'], sv: [1, 2, 3] };
    const binary = new Uint8Array([10, 20, 30, 40]);
    const serverCodec = getServerCodec();

    const browserBytes = browserCodec.encodeBinary(browserCodec.MSG.PUSH, meta, binary);
    const serverBytes = serverCodec.encodeBinary(serverCodec.MSG.PUSH, meta, Buffer.from(binary));

    expect(toArray(browserBytes)).toEqual(toArray(serverBytes));
  });

  test('BROADCAST_NUDGE (binary+meta)', () => {
    const meta = { broadcast: true };
    const binary = new Uint8Array([5, 6, 7]);
    const serverCodec = getServerCodec();

    const browserBytes = browserCodec.encodeBinary(browserCodec.MSG.BROADCAST_NUDGE, meta, binary);
    const serverBytes = serverCodec.encodeBinary(
      serverCodec.MSG.BROADCAST_NUDGE,
      meta,
      Buffer.from(binary),
    );

    expect(toArray(browserBytes)).toEqual(toArray(serverBytes));
  });

  test('LOCK_LIST_REQ (type byte only)', () => {
    const raw = new Uint8Array([0x0a]);
    const serverCodec = getServerCodec();
    // Both codecs should decode a bare type byte as LOCK_LIST_REQ
    expect(raw[0]).toBe(browserCodec.MSG.LOCK_LIST_REQ);
    expect(raw[0]).toBe(serverCodec.MSG.LOCK_LIST_REQ);
  });
});

// ---------------------------------------------------------------------------
// 2. Cross-codec decode compatibility
// ---------------------------------------------------------------------------

describeWithServerCodec('cross-codec decode compatibility', () => {
  test('server-encoded JOIN_REQUEST decoded by browser', () => {
    const payload = { participantId: 'user-1' };
    const serverCodec = getServerCodec();
    const encoded = serverCodec.encodeJson(serverCodec.MSG.JOIN_REQUEST, payload);
    const decoded = browserCodec.decode(encoded);

    expect(decoded.type).toBe(browserCodec.MSG.JOIN_REQUEST);
    expect(decoded.json).toEqual(payload);
    expect(decoded.binary).toBeUndefined();
  });

  test('browser-encoded JOIN_REQUEST decoded by server', () => {
    const payload = { participantId: 'user-1' };
    const serverCodec = getServerCodec();
    const encoded = browserCodec.encodeJson(browserCodec.MSG.JOIN_REQUEST, payload);
    const decoded = serverCodec.decode(Buffer.from(encoded));

    expect(decoded.type).toBe(serverCodec.MSG.JOIN_REQUEST);
    expect(decoded.json).toEqual(payload);
    expect(decoded.binary).toBeUndefined();
  });

  test('server-encoded PUSH decoded by browser', () => {
    const meta = { touchedSheets: ['sheet1'], sv: [1, 2, 3] };
    const binary = Buffer.from([10, 20, 30, 40]);
    const serverCodec = getServerCodec();
    const encoded = serverCodec.encodeBinary(serverCodec.MSG.PUSH, meta, binary);
    const decoded = browserCodec.decode(encoded);

    expect(decoded.type).toBe(browserCodec.MSG.PUSH);
    expect(decoded.json).toEqual(meta);
    expect(toArray(decoded.binary!)).toEqual([10, 20, 30, 40]);
  });

  test('browser-encoded PUSH decoded by server', () => {
    const meta = { touchedSheets: ['sheet1'], sv: [1, 2, 3] };
    const binary = new Uint8Array([10, 20, 30, 40]);
    const serverCodec = getServerCodec();
    const encoded = browserCodec.encodeBinary(browserCodec.MSG.PUSH, meta, binary);
    const decoded = serverCodec.decode(Buffer.from(encoded));

    expect(decoded.type).toBe(serverCodec.MSG.PUSH);
    expect(decoded.json).toEqual(meta);
    expect(toArray(decoded.binary!)).toEqual([10, 20, 30, 40]);
  });

  test('server-encoded BROADCAST_NUDGE decoded by browser', () => {
    const meta = { broadcast: true };
    const binary = Buffer.from([5, 6, 7]);
    const serverCodec = getServerCodec();
    const encoded = serverCodec.encodeBinary(serverCodec.MSG.BROADCAST_NUDGE, meta, binary);
    const decoded = browserCodec.decode(encoded);

    expect(decoded.type).toBe(browserCodec.MSG.BROADCAST_NUDGE);
    expect(decoded.json).toEqual(meta);
    expect(toArray(decoded.binary!)).toEqual([5, 6, 7]);
  });

  test('browser-encoded BROADCAST_NUDGE decoded by server', () => {
    const meta = { broadcast: true };
    const binary = new Uint8Array([5, 6, 7]);
    const serverCodec = getServerCodec();
    const encoded = browserCodec.encodeBinary(browserCodec.MSG.BROADCAST_NUDGE, meta, binary);
    const decoded = serverCodec.decode(Buffer.from(encoded));

    expect(decoded.type).toBe(serverCodec.MSG.BROADCAST_NUDGE);
    expect(decoded.json).toEqual(meta);
    expect(toArray(decoded.binary!)).toEqual([5, 6, 7]);
  });

  test('LOCK_LIST_REQ (type-only) decoded by both codecs', () => {
    const raw = new Uint8Array([0x0a]);
    const serverCodec = getServerCodec();

    const browserDecoded = browserCodec.decode(raw);
    expect(browserDecoded.type).toBe(browserCodec.MSG.LOCK_LIST_REQ);
    expect(browserDecoded.json).toBeNull();
    expect(browserDecoded.binary).toBeUndefined();

    const serverDecoded = serverCodec.decode(Buffer.from(raw));
    expect(serverDecoded.type).toBe(serverCodec.MSG.LOCK_LIST_REQ);
    expect(serverDecoded.json).toBeNull();
    expect(serverDecoded.binary).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Edge cases
// ---------------------------------------------------------------------------

describeWithServerCodec('edge cases', () => {
  test('empty binary payload in encodeBinary', () => {
    const meta = { empty: true };
    const emptyBinary = new Uint8Array(0);
    const serverCodec = getServerCodec();

    const browserBytes = browserCodec.encodeBinary(browserCodec.MSG.PUSH, meta, emptyBinary);
    const serverBytes = serverCodec.encodeBinary(serverCodec.MSG.PUSH, meta, Buffer.alloc(0));

    // Byte-identical
    expect(toArray(browserBytes)).toEqual(toArray(serverBytes));

    // Round-trip: decode with both codecs
    const browserDecoded = browserCodec.decode(browserBytes);
    expect(browserDecoded.type).toBe(browserCodec.MSG.PUSH);
    expect(browserDecoded.json).toEqual(meta);
    expect(toArray(browserDecoded.binary!)).toEqual([]);

    const serverDecoded = serverCodec.decode(Buffer.from(browserBytes));
    expect(serverDecoded.type).toBe(serverCodec.MSG.PUSH);
    expect(serverDecoded.json).toEqual(meta);
    expect(toArray(serverDecoded.binary!)).toEqual([]);
  });

  test('large JSON metadata (1000+ chars)', () => {
    const largeMeta = {
      description: 'x'.repeat(1000),
      nested: { a: 'y'.repeat(200), b: Array.from({ length: 50 }, (_, i) => i) },
    };
    const binary = new Uint8Array([0xff, 0x00, 0x42]);
    const serverCodec = getServerCodec();

    const browserBytes = browserCodec.encodeBinary(browserCodec.MSG.PUSH, largeMeta, binary);
    const serverBytes = serverCodec.encodeBinary(
      serverCodec.MSG.PUSH,
      largeMeta,
      Buffer.from(binary),
    );

    // Byte-identical
    expect(toArray(browserBytes)).toEqual(toArray(serverBytes));

    // Cross-decode
    const decoded = browserCodec.decode(serverBytes);
    expect(decoded.json).toEqual(largeMeta);
    expect(toArray(decoded.binary!)).toEqual([0xff, 0x00, 0x42]);
  });

  test('empty message throws in both codecs', () => {
    const empty = new Uint8Array(0);
    const serverCodec = getServerCodec();

    expect(() => browserCodec.decode(empty)).toThrow('Empty message');
    expect(() => serverCodec.decode(Buffer.alloc(0))).toThrow('Empty message');
  });
});
