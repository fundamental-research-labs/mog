import {
  PROTOCOL_VERSION,
  SUPPORTED_VERSIONS,
  createMessage,
  isValidMessage,
  validateMessagePayload,
  validateMessageEvent,
  negotiateVersion,
  validateOrigin,
} from '../iframe/protocol';

// ---------------------------------------------------------------------------
// createMessage
// ---------------------------------------------------------------------------

describe('createMessage', () => {
  it('sets protocol to "mog.embed"', () => {
    const msg = createMessage('ready');
    expect(msg.protocol).toBe('mog.embed');
  });

  it('sets version to PROTOCOL_VERSION (1)', () => {
    const msg = createMessage('ready');
    expect(msg.version).toBe(1);
    expect(msg.version).toBe(PROTOCOL_VERSION);
  });

  it('generates a non-empty id string', () => {
    const msg = createMessage('ready');
    expect(typeof msg.id).toBe('string');
    expect(msg.id.length).toBeGreaterThan(0);
  });

  it('sets the given type', () => {
    const msg = createMessage('sheetChange');
    expect(msg.type).toBe('sheetChange');
  });

  it('includes payload when provided', () => {
    const msg = createMessage('sheetChange', { index: 0, name: 'Sheet1' });
    expect(msg.payload).toEqual({ index: 0, name: 'Sheet1' });
  });

  it('omits payload key when not provided', () => {
    const msg = createMessage('ready');
    expect('payload' in msg).toBe(false);
  });

  it('includes correlationId when provided', () => {
    const msg = createMessage('ready', undefined, 'corr-123');
    expect(msg.correlationId).toBe('corr-123');
  });

  it('omits correlationId key when not provided', () => {
    const msg = createMessage('ready');
    expect('correlationId' in msg).toBe(false);
  });

  it('generates a unique id on each call', () => {
    const a = createMessage('ready');
    const b = createMessage('ready');
    const c = createMessage('ready');
    expect(a.id).not.toBe(b.id);
    expect(b.id).not.toBe(c.id);
    expect(a.id).not.toBe(c.id);
  });
});

// ---------------------------------------------------------------------------
// isValidMessage
// ---------------------------------------------------------------------------

describe('isValidMessage', () => {
  it('returns true for a valid message from createMessage', () => {
    const msg = createMessage('ready');
    expect(isValidMessage(msg)).toBe(true);
  });

  it('returns true for valid message with payload', () => {
    const msg = createMessage('sheetChange', { index: 0, name: 'Sheet1' });
    expect(isValidMessage(msg)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isValidMessage(null)).toBe(false);
  });

  it('returns false for non-object (number)', () => {
    expect(isValidMessage(42)).toBe(false);
  });

  it('returns false for non-object (string)', () => {
    expect(isValidMessage('hello')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidMessage(undefined)).toBe(false);
  });

  it('returns false for missing protocol field', () => {
    expect(isValidMessage({ version: 1, id: 'abc', type: 'ready' })).toBe(false);
  });

  it('returns false for wrong protocol field', () => {
    expect(isValidMessage({ protocol: 'wrong', version: 1, id: 'abc', type: 'ready' })).toBe(false);
  });

  it('returns false for wrong version', () => {
    expect(isValidMessage({ protocol: 'mog.embed', version: 99, id: 'abc', type: 'ready' })).toBe(
      false,
    );
  });

  it('returns false for missing id', () => {
    expect(isValidMessage({ protocol: 'mog.embed', version: 1, type: 'ready' })).toBe(false);
  });

  it('returns false for empty id string', () => {
    expect(isValidMessage({ protocol: 'mog.embed', version: 1, id: '', type: 'ready' })).toBe(
      false,
    );
  });

  it('returns false for missing type', () => {
    expect(isValidMessage({ protocol: 'mog.embed', version: 1, id: 'abc' })).toBe(false);
  });

  it('returns false for invalid type string', () => {
    expect(isValidMessage({ protocol: 'mog.embed', version: 1, id: 'abc', type: 'bogus' })).toBe(
      false,
    );
  });

  it.each([
    'ready',
    'error',
    'dispose',
    'heartbeat',
    'resize',
    'viewportChanged',
    'sheetChange',
    'selectionChange',
    'dirtyChange',
    'saveRequested',
    'saveCompleted',
    'saveFailed',
    'exportRequested',
    'exportCompleted',
    'effectiveCapabilities',
    'capabilityDenied',
    'sheetSelect',
    'rangeSelect',
    'scrollTo',
  ] as const)('returns true for valid type "%s"', (type) => {
    const msg = { protocol: 'mog.embed', version: 1, id: 'test-id', type };
    expect(isValidMessage(msg)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateOrigin
// ---------------------------------------------------------------------------

describe('validateOrigin', () => {
  it('returns true when event.origin is in allowlist', () => {
    const event = { origin: 'https://example.com' } as MessageEvent;
    expect(validateOrigin(event, ['https://example.com'])).toBe(true);
  });

  it('returns false when event.origin is NOT in allowlist', () => {
    const event = { origin: 'https://evil.com' } as MessageEvent;
    expect(validateOrigin(event, ['https://example.com'])).toBe(false);
  });

  it('returns false for empty allowlist', () => {
    const event = { origin: 'https://example.com' } as MessageEvent;
    expect(validateOrigin(event, [])).toBe(false);
  });

  it('works with multiple allowed origins', () => {
    const allowed = ['https://a.com', 'https://b.com', 'https://c.com'];
    expect(validateOrigin({ origin: 'https://b.com' } as MessageEvent, allowed)).toBe(true);
    expect(validateOrigin({ origin: 'https://d.com' } as MessageEvent, allowed)).toBe(false);
  });

  it('requires exact match (no substring)', () => {
    const event = { origin: 'https://example.com.evil.com' } as MessageEvent;
    expect(validateOrigin(event, ['https://example.com'])).toBe(false);
  });
});

describe('validateMessageEvent', () => {
  it('accepts only matching origin, source, protocol, and version', () => {
    const source = {} as MessageEventSource;
    const msg = createMessage('ready');
    const event = {
      data: msg,
      origin: 'https://app.example.com',
      source,
    } as MessageEvent;

    expect(validateMessageEvent(event, ['https://app.example.com'], source)).toEqual(msg);
  });

  it('rejects wrong source even when origin and payload are valid', () => {
    const event = {
      data: createMessage('ready'),
      origin: 'https://app.example.com',
      source: {} as MessageEventSource,
    } as MessageEvent;

    expect(
      validateMessageEvent(event, ['https://app.example.com'], {} as MessageEventSource),
    ).toBeNull();
  });

  it('rejects unsupported protocol versions', () => {
    const source = {} as MessageEventSource;
    const event = {
      data: { protocol: 'mog.embed', version: 99, id: 'x', type: 'ready' },
      origin: 'https://app.example.com',
      source,
    } as MessageEvent;

    expect(validateMessageEvent(event, ['https://app.example.com'], source)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateMessagePayload
// ---------------------------------------------------------------------------

describe('validateMessagePayload', () => {
  it('returns a valid message unchanged', () => {
    const msg = createMessage('ready');
    expect(validateMessagePayload(msg)).toEqual(msg);
  });

  it('returns null for null input', () => {
    expect(validateMessagePayload(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(validateMessagePayload(42)).toBeNull();
    expect(validateMessagePayload('string')).toBeNull();
    expect(validateMessagePayload(undefined)).toBeNull();
  });

  it('returns null for wrong protocol string', () => {
    expect(
      validateMessagePayload({ protocol: 'not.mog', version: 1, id: 'a', type: 'ready' }),
    ).toBeNull();
  });

  it('returns null for missing protocol', () => {
    expect(validateMessagePayload({ version: 1, id: 'a', type: 'ready' })).toBeNull();
  });

  it('returns null for non-numeric version', () => {
    expect(
      validateMessagePayload({ protocol: 'mog.embed', version: 'one', id: 'a', type: 'ready' }),
    ).toBeNull();
  });

  it('returns null for unsupported version', () => {
    expect(
      validateMessagePayload({ protocol: 'mog.embed', version: 999, id: 'a', type: 'ready' }),
    ).toBeNull();
  });

  it('returns null for missing id', () => {
    expect(validateMessagePayload({ protocol: 'mog.embed', version: 1, type: 'ready' })).toBeNull();
  });

  it('returns null for empty id', () => {
    expect(
      validateMessagePayload({ protocol: 'mog.embed', version: 1, id: '', type: 'ready' }),
    ).toBeNull();
  });

  it('returns null for missing type', () => {
    expect(validateMessagePayload({ protocol: 'mog.embed', version: 1, id: 'a' })).toBeNull();
  });

  it('returns null for unknown type', () => {
    expect(
      validateMessagePayload({ protocol: 'mog.embed', version: 1, id: 'a', type: 'invented' }),
    ).toBeNull();
  });

  it('accepts handshake types', () => {
    for (const type of ['hello', 'helloAck', 'versionMismatch'] as const) {
      const msg = createMessage(type);
      expect(validateMessagePayload(msg)).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// negotiateVersion
// ---------------------------------------------------------------------------

describe('negotiateVersion', () => {
  it('returns highest mutually supported version', () => {
    expect(negotiateVersion([1])).toBe(1);
  });

  it('returns null when no versions overlap', () => {
    expect(negotiateVersion([99, 100])).toBeNull();
  });

  it('returns null for empty offered list', () => {
    expect(negotiateVersion([])).toBeNull();
  });

  it('prefers the highest offered version that is supported', () => {
    expect(negotiateVersion([1, 99])).toBe(1);
  });
});
