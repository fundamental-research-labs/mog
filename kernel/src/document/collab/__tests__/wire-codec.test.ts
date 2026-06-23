/**
 * Wire codec unit tests.
 *
 * These fixtures pin the shared protocol bytes without importing a
 * host-specific runtime implementation.
 */

import * as browserCodec from '../wire-codec';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert Uint8Array to a plain number[] for deep-equal comparison. */
function toArray(buf: Uint8Array): number[] {
  return Array.from(buf);
}

const JOIN_REQUEST_BYTES = [
  0x01, 0x7b, 0x22, 0x70, 0x61, 0x72, 0x74, 0x69, 0x63, 0x69, 0x70, 0x61, 0x6e, 0x74, 0x49, 0x64,
  0x22, 0x3a, 0x22, 0x75, 0x73, 0x65, 0x72, 0x2d, 0x31, 0x22, 0x7d,
];

const PUSH_BYTES = [
  0x03, 0x00, 0x00, 0x00, 0x29, 0x7b, 0x22, 0x74, 0x6f, 0x75, 0x63, 0x68, 0x65, 0x64, 0x53, 0x68,
  0x65, 0x65, 0x74, 0x73, 0x22, 0x3a, 0x5b, 0x22, 0x73, 0x68, 0x65, 0x65, 0x74, 0x31, 0x22, 0x5d,
  0x2c, 0x22, 0x73, 0x76, 0x22, 0x3a, 0x5b, 0x31, 0x2c, 0x32, 0x2c, 0x33, 0x5d, 0x7d, 10, 20, 30,
  40,
];

const BROADCAST_NUDGE_BYTES = [
  0x0c, 0x00, 0x00, 0x00, 0x12, 0x7b, 0x22, 0x62, 0x72, 0x6f, 0x61, 0x64, 0x63, 0x61, 0x73, 0x74,
  0x22, 0x3a, 0x74, 0x72, 0x75, 0x65, 0x7d, 5, 6, 7,
];

// ---------------------------------------------------------------------------
// 1. Byte layout
// ---------------------------------------------------------------------------

describe('wire codec byte layout', () => {
  test('JOIN_REQUEST (pure JSON)', () => {
    const payload = { participantId: 'user-1' };

    expect(toArray(browserCodec.encodeJson(browserCodec.MSG.JOIN_REQUEST, payload))).toEqual(
      JOIN_REQUEST_BYTES,
    );
  });

  test('PUSH (binary+meta)', () => {
    const meta = { touchedSheets: ['sheet1'], sv: [1, 2, 3] };
    const binary = new Uint8Array([10, 20, 30, 40]);

    expect(toArray(browserCodec.encodeBinary(browserCodec.MSG.PUSH, meta, binary))).toEqual(
      PUSH_BYTES,
    );
  });

  test('BROADCAST_NUDGE (binary+meta)', () => {
    const meta = { broadcast: true };
    const binary = new Uint8Array([5, 6, 7]);

    expect(
      toArray(browserCodec.encodeBinary(browserCodec.MSG.BROADCAST_NUDGE, meta, binary)),
    ).toEqual(BROADCAST_NUDGE_BYTES);
  });

  test('LOCK_LIST_REQ (type byte only)', () => {
    const raw = new Uint8Array([0x0a]);
    expect(raw[0]).toBe(browserCodec.MSG.LOCK_LIST_REQ);
  });
});

// ---------------------------------------------------------------------------
// 2. Decode compatibility
// ---------------------------------------------------------------------------

describe('wire codec decode compatibility', () => {
  test('JOIN_REQUEST decoded from protocol bytes', () => {
    const decoded = browserCodec.decode(new Uint8Array(JOIN_REQUEST_BYTES));

    expect(decoded.type).toBe(browserCodec.MSG.JOIN_REQUEST);
    expect(decoded.json).toEqual({ participantId: 'user-1' });
    expect(decoded.binary).toBeUndefined();
  });

  test('PUSH decoded from protocol bytes', () => {
    const decoded = browserCodec.decode(new Uint8Array(PUSH_BYTES));

    expect(decoded.type).toBe(browserCodec.MSG.PUSH);
    expect(decoded.json).toEqual({ touchedSheets: ['sheet1'], sv: [1, 2, 3] });
    expect(toArray(decoded.binary!)).toEqual([10, 20, 30, 40]);
  });

  test('BROADCAST_NUDGE decoded from protocol bytes', () => {
    const decoded = browserCodec.decode(new Uint8Array(BROADCAST_NUDGE_BYTES));

    expect(decoded.type).toBe(browserCodec.MSG.BROADCAST_NUDGE);
    expect(decoded.json).toEqual({ broadcast: true });
    expect(toArray(decoded.binary!)).toEqual([5, 6, 7]);
  });

  test('LOCK_LIST_REQ (type-only) decoded', () => {
    const decoded = browserCodec.decode(new Uint8Array([0x0a]));

    expect(decoded.type).toBe(browserCodec.MSG.LOCK_LIST_REQ);
    expect(decoded.json).toBeNull();
    expect(decoded.binary).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Sync update provenance classification
// ---------------------------------------------------------------------------

describe('sync update wire source classification', () => {
  test.each([
    [
      browserCodec.MSG.JOIN_RESPONSE,
      'JOIN_RESPONSE',
      'joinResponseHydration',
      'collaborationHydration',
    ],
    [
      browserCodec.MSG.RESUME_RESPONSE,
      'RESUME_RESPONSE',
      'resumeResponseHydration',
      'collaborationHydration',
    ],
    [
      browserCodec.MSG.PULL_RESPONSE,
      'PULL_RESPONSE',
      'pullResponseMixedRemote',
      'collaborationMixedRemote',
    ],
    [
      browserCodec.MSG.PUSH_RESPONSE,
      'PUSH_RESPONSE',
      'pushResponseMixedRemote',
      'collaborationMixedRemote',
    ],
  ])('classifies %s update bytes', (messageType, messageName, kind, sourceKind) => {
    expect(browserCodec.classifySyncUpdateWireSource(messageType)).toEqual({
      kind,
      messageType,
      messageName,
      sourceKind,
      legacyRawFallback: false,
    });
  });

  test('falls back to legacy raw unknown for unclassified sync byte frames', () => {
    expect(browserCodec.classifySyncUpdateWireSource(0x7f)).toEqual({
      kind: 'legacyRawFallback',
      messageType: 0x7f,
      messageName: 'UNKNOWN_0x7f',
      sourceKind: 'legacyRawUnknown',
      legacyRawFallback: true,
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  test('empty binary payload in encodeBinary', () => {
    const meta = { empty: true };
    const bytes = browserCodec.encodeBinary(browserCodec.MSG.PUSH, meta, new Uint8Array(0));

    const decoded = browserCodec.decode(bytes);
    expect(decoded.type).toBe(browserCodec.MSG.PUSH);
    expect(decoded.json).toEqual(meta);
    expect(toArray(decoded.binary!)).toEqual([]);
  });

  test('large JSON metadata (1000+ chars)', () => {
    const largeMeta = {
      description: 'x'.repeat(1000),
      nested: { a: 'y'.repeat(200), b: Array.from({ length: 50 }, (_, i) => i) },
    };
    const binary = new Uint8Array([0xff, 0x00, 0x42]);
    const bytes = browserCodec.encodeBinary(browserCodec.MSG.PUSH, largeMeta, binary);

    const decoded = browserCodec.decode(bytes);
    expect(decoded.json).toEqual(largeMeta);
    expect(toArray(decoded.binary!)).toEqual([0xff, 0x00, 0x42]);
  });

  test('empty message throws', () => {
    expect(() => browserCodec.decode(new Uint8Array(0))).toThrow('Empty message');
  });
});
