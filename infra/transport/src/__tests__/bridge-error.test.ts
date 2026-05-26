/**
 * Track R3 — bridge tagged-error contract.
 *
 * Tests the TS-side parser against the wire shape produced by Rust
 * `bridge_types::WrapErr(...).bridge_format()`. The Rust side has its
 * own unit test (`compute_error_every_variant_has_kind_field`) that
 * locks in the byte-for-byte shape; this suite ensures the TS parser
 * round-trips it correctly and that the discriminated union is usable.
 */
import {
  BRIDGE_ERROR_SENTINEL,
  isBridgeErrorKind,
  parseBridgeError,
  type BridgeError,
  type PartialArrayWriteError,
} from '../bridge-error';

/** Synthesize the wire shape Rust produces for a tagged error. */
function envelope(payload: object): string {
  return BRIDGE_ERROR_SENTINEL + JSON.stringify(payload);
}

describe('parseBridgeError — happy paths', () => {
  it('parses a PartialArrayWrite envelope from a string', () => {
    const wire = envelope({
      kind: 'PartialArrayWrite',
      sheetId: 'sheet-uuid',
      row: 2,
      col: 3,
      anchorRow: 1,
      anchorCol: 1,
    });
    const tagged = parseBridgeError(wire);
    expect(tagged).not.toBeNull();
    expect(tagged?.kind).toBe('PartialArrayWrite');
    if (tagged?.kind === 'PartialArrayWrite') {
      expect(tagged.sheetId).toBe('sheet-uuid');
      expect(tagged.row).toBe(2);
      expect(tagged.col).toBe(3);
      expect(tagged.anchorRow).toBe(1);
      expect(tagged.anchorCol).toBe(1);
    }
  });

  it('parses an Error object thrown with the envelope as message', () => {
    const wire = envelope({ kind: 'Cycle', cellCount: 5 });
    const err = new Error(wire);
    const tagged = parseBridgeError(err);
    expect(tagged?.kind).toBe('Cycle');
    if (tagged?.kind === 'Cycle') {
      expect(tagged.cellCount).toBe(5);
    }
  });

  it('parses through a wrapping Error (cause chain) — kernel BridgeError pattern', () => {
    const wire = envelope({
      kind: 'PartialArrayWrite',
      sheetId: 's',
      row: 0,
      col: 0,
      anchorRow: 0,
      anchorCol: 0,
    });
    const inner = new Error(wire);
    // Mimic kernel/transport wrapping: outer message prefixes the
    // command name + does NOT necessarily contain the sentinel; the
    // inner cause does.
    const outer = new Error('[compute_set_cell] write failed', { cause: inner });
    const tagged = parseBridgeError(outer);
    expect(tagged?.kind).toBe('PartialArrayWrite');
  });

  it('parses unit variants like OperationLimit / DepthLimit', () => {
    expect(parseBridgeError(envelope({ kind: 'OperationLimit' }))?.kind).toBe('OperationLimit');
    expect(parseBridgeError(envelope({ kind: 'DepthLimit' }))?.kind).toBe('DepthLimit');
    expect(parseBridgeError(envelope({ kind: 'DeadlineExceeded' }))?.kind).toBe('DeadlineExceeded');
  });

  it('handles trailing content after the JSON object', () => {
    // Some transports may append diagnostic context after the envelope.
    // Parser must consume only the JSON object.
    const payload = JSON.stringify({ kind: 'Eval', message: 'boom' });
    const wire = `${BRIDGE_ERROR_SENTINEL}${payload}\n[trailing diagnostic]`;
    const tagged = parseBridgeError(wire);
    expect(tagged?.kind).toBe('Eval');
  });

  it('extracts the envelope when the message has a leading prefix', () => {
    // Transport layer may prepend `[<command>]` before the bridge string.
    const wire = `[compute_set_cell] ${envelope({ kind: 'OperationLimit' })}`;
    const tagged = parseBridgeError(wire);
    expect(tagged?.kind).toBe('OperationLimit');
  });
});

describe('parseBridgeError — null / fallback', () => {
  it('returns null for plain Display errors (no sentinel)', () => {
    expect(parseBridgeError('division by zero')).toBeNull();
    expect(parseBridgeError(new Error('plain error'))).toBeNull();
  });

  it('returns null for non-error inputs', () => {
    expect(parseBridgeError(null)).toBeNull();
    expect(parseBridgeError(undefined)).toBeNull();
    expect(parseBridgeError(42)).toBeNull();
    expect(parseBridgeError({})).toBeNull();
  });

  it('returns null when the sentinel is followed by non-JSON', () => {
    expect(parseBridgeError(`${BRIDGE_ERROR_SENTINEL}not json at all`)).toBeNull();
  });
});

describe('isBridgeErrorKind — type-narrowed helper', () => {
  it('narrows the type when the kind matches', () => {
    const wire = envelope({
      kind: 'PartialArrayWrite',
      sheetId: 's',
      row: 4,
      col: 5,
      anchorRow: 1,
      anchorCol: 1,
    });
    const err = new Error(wire);
    if (isBridgeErrorKind(err, 'PartialArrayWrite')) {
      // TS narrowing in action: tagged is typed PartialArrayWriteError here.
      const tagged: PartialArrayWriteError = err as never; // unused, just for shape
      void tagged;
      // Functional check via parse:
      const t = parseBridgeError(err) as PartialArrayWriteError;
      expect(t.row).toBe(4);
      expect(t.col).toBe(5);
    } else {
      throw new Error('expected PartialArrayWrite');
    }
  });

  it('returns false when the kind does not match', () => {
    const wire = envelope({ kind: 'OperationLimit' });
    expect(isBridgeErrorKind(wire, 'PartialArrayWrite')).toBe(false);
    expect(isBridgeErrorKind(wire, 'OperationLimit')).toBe(true);
  });

  it('returns false for plain (non-tagged) errors', () => {
    expect(isBridgeErrorKind(new Error('plain'), 'PartialArrayWrite')).toBe(false);
  });
});

describe('wire-shape uniformity — NAPI and WASM produce the same envelope', () => {
  // The transport layer should NOT alter the bridge envelope (which is
  // identical across NAPI and WASM by construction; both call the same
  // Rust `bridge_format_err!` macro). This test pins the round-trip
  // expectation: a payload constructed at the TS layer and put through
  // the parser produces the original payload.
  it.each<BridgeError['kind']>([
    'Parse',
    'Eval',
    'Cycle',
    'PartialArrayWrite',
    'OperationLimit',
    'DepthLimit',
    'DeadlineExceeded',
    'SecurityDenied',
    'InvalidAddress',
    'InvalidInput',
  ])('round-trips kind=%s', (kind) => {
    const sample: Record<string, unknown> = { kind };
    // Variant-specific fields (just enough to make payload realistic):
    if (kind === 'Parse') Object.assign(sample, { message: 'm', position: 1 });
    if (kind === 'Eval') Object.assign(sample, { message: 'm' });
    if (kind === 'Cycle') Object.assign(sample, { cellCount: 2 });
    if (kind === 'PartialArrayWrite')
      Object.assign(sample, {
        sheetId: 's',
        row: 0,
        col: 0,
        anchorRow: 0,
        anchorCol: 0,
      });
    if (kind === 'SecurityDenied')
      Object.assign(sample, {
        principalTags: 'p',
        target: 't',
        required: 'read',
        actual: 'none',
        operation: 'op',
      });
    if (kind === 'InvalidAddress')
      Object.assign(sample, { message: 'm', address: 'A1', reason: 'r' });
    if (kind === 'InvalidInput') Object.assign(sample, { message: 'm' });

    const wire = envelope(sample);
    const tagged = parseBridgeError(wire);
    expect(tagged).toEqual(sample);
  });
});
