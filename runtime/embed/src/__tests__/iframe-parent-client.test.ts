/**
 * @jest-environment jsdom
 */
import { MogIframeClient } from '../iframe/parent-client';
import {
  CorrelationTimeoutError,
  VersionMismatchError,
  createMessage,
  isValidMessage,
  validateMessagePayload,
  PROTOCOL_VERSION,
} from '../iframe/protocol';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TARGET_ORIGIN = 'https://embed.mog.dev';

function makeMockIframe() {
  const contentWindow = {
    postMessage: jest.fn(),
  };
  return {
    iframe: { contentWindow } as unknown as HTMLIFrameElement,
    contentWindow,
  };
}

/**
 * Dispatch a MessageEvent on `window` that looks like it came from
 * the iframe's contentWindow at the given origin.
 */
function simulateMessage(data: unknown, origin: string, source: unknown): void {
  const event = new MessageEvent('message', {
    data,
    origin,
    source: source as Window,
  });
  window.dispatchEvent(event);
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('MogIframeClient – construction', () => {
  it('throws if targetOrigin is "*"', () => {
    const { iframe } = makeMockIframe();
    expect(
      () =>
        new MogIframeClient({
          iframe,
          targetOrigin: '*',
          instanceId: 'test',
        }),
    ).toThrow('targetOrigin must be an exact origin, never "*"');
  });

  it('accepts an exact origin string', () => {
    const { iframe } = makeMockIframe();
    expect(
      () =>
        new MogIframeClient({
          iframe,
          targetOrigin: TARGET_ORIGIN,
          instanceId: 'inst-1',
        }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Send / postMessage
// ---------------------------------------------------------------------------

describe('MogIframeClient – send', () => {
  let client: MogIframeClient;
  let contentWindow: { postMessage: jest.Mock };

  beforeEach(() => {
    const mock = makeMockIframe();
    contentWindow = mock.contentWindow;
    client = new MogIframeClient({
      iframe: mock.iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
    });
  });

  afterEach(() => {
    client.dispose();
  });

  it('requestSheetChange sends sheetSelect type', () => {
    client.requestSheetChange(2);
    expect(contentWindow.postMessage).toHaveBeenCalledTimes(1);
    const [msg, origin] = contentWindow.postMessage.mock.calls[0];
    expect(origin).toBe(TARGET_ORIGIN);
    expect(isValidMessage(msg)).toBe(true);
    expect(msg.type).toBe('sheetSelect');
    expect(msg.payload).toEqual({ target: 2 });
  });

  it('requestSheetChange with string target', () => {
    client.requestSheetChange('Sheet2');
    const [msg] = contentWindow.postMessage.mock.calls[0];
    expect(msg.type).toBe('sheetSelect');
    expect(msg.payload).toEqual({ target: 'Sheet2' });
  });

  it('requestRangeSelect sends rangeSelect type', () => {
    client.requestRangeSelect('A1:B5');
    const [msg, origin] = contentWindow.postMessage.mock.calls[0];
    expect(origin).toBe(TARGET_ORIGIN);
    expect(msg.type).toBe('rangeSelect');
    expect(msg.payload).toEqual({ range: 'A1:B5' });
  });

  it('requestScrollTo sends scrollTo type', () => {
    client.requestScrollTo(10, 20);
    const [msg] = contentWindow.postMessage.mock.calls[0];
    expect(msg.type).toBe('scrollTo');
    expect(msg.payload).toEqual({ row: 10, col: 20 });
  });

  it('requestSave sends saveRequested type', () => {
    client.requestSave();
    const [msg] = contentWindow.postMessage.mock.calls[0];
    expect(msg.type).toBe('saveRequested');
  });

  it('requestExport sends exportRequested with format', () => {
    client.requestExport('xlsx');
    const [msg] = contentWindow.postMessage.mock.calls[0];
    expect(msg.type).toBe('exportRequested');
    expect(msg.payload).toEqual({ format: 'xlsx' });
  });

  it('does NOT send after dispose', () => {
    client.dispose();
    contentWindow.postMessage.mockClear();
    client.requestSave();
    expect(contentWindow.postMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// connect()
// ---------------------------------------------------------------------------

describe('MogIframeClient – connect', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects if already disposed', async () => {
    const { iframe, contentWindow } = makeMockIframe();
    const client = new MogIframeClient({
      iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
    });
    client.dispose();
    await expect(client.connect()).rejects.toThrow('Client is disposed');
  });

  it('times out after 30s', async () => {
    const { iframe } = makeMockIframe();
    const client = new MogIframeClient({
      iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
    });

    const promise = client.connect();
    jest.advanceTimersByTime(30_000);
    await expect(promise).rejects.toThrow('Timed out waiting for iframe ready');
    client.dispose();
  });

  it('resolves when helloAck received after version negotiation', async () => {
    const { iframe, contentWindow } = makeMockIframe();
    const client = new MogIframeClient({
      iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
    });

    const promise = client.connect();

    const helloCall = contentWindow.postMessage.mock.calls[0];
    const helloMsg = helloCall[0];
    expect(helloMsg.type).toBe('hello');

    const ack = createMessage('helloAck', { selectedVersion: 1 }, helloMsg.id);
    simulateMessage(ack, TARGET_ORIGIN, contentWindow);

    await expect(promise).resolves.toBeUndefined();
    expect(client.negotiatedVersion).toBe(1);
    client.dispose();
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('MogIframeClient – dispose', () => {
  it('sends dispose message to the iframe', () => {
    const { iframe, contentWindow } = makeMockIframe();
    const client = new MogIframeClient({
      iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
    });
    client.dispose();
    expect(contentWindow.postMessage).toHaveBeenCalledTimes(1);
    const [msg, origin] = contentWindow.postMessage.mock.calls[0];
    expect(msg.type).toBe('dispose');
    expect(origin).toBe(TARGET_ORIGIN);
  });

  it('emits disposed to pre-registered handlers', () => {
    const { iframe } = makeMockIframe();
    const client = new MogIframeClient({
      iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
    });
    const handler = jest.fn();
    client.on('disposed', handler);
    client.dispose();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('subsequent sends are no-ops', () => {
    const { iframe, contentWindow } = makeMockIframe();
    const client = new MogIframeClient({
      iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
    });
    client.dispose();
    contentWindow.postMessage.mockClear();
    client.requestSave();
    client.requestSheetChange(0);
    expect(contentWindow.postMessage).not.toHaveBeenCalled();
  });

  it('stops listening to messages', () => {
    const { iframe, contentWindow } = makeMockIframe();
    const client = new MogIframeClient({
      iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
    });

    // Start listening by calling connect (we won't await)
    const handler = jest.fn();
    client.on('sheetChange', handler);
    // Force start listening via connect
    const connectPromise = client.connect().catch(() => {});

    client.dispose();

    // Now simulate a message — should not be dispatched
    const msg = createMessage('sheetChange', { index: 1, name: 'Sheet2' });
    simulateMessage(msg, TARGET_ORIGIN, contentWindow);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Event dispatching
// ---------------------------------------------------------------------------

describe('MogIframeClient – event dispatching', () => {
  let client: MogIframeClient;
  let contentWindow: { postMessage: jest.Mock };

  beforeEach(() => {
    const mock = makeMockIframe();
    contentWindow = mock.contentWindow;
    client = new MogIframeClient({
      iframe: mock.iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
    });
    // Start listening (connect but don't await — we'll feed messages manually)
    client.connect().catch(() => {});
  });

  afterEach(() => {
    client.dispose();
  });

  it('dispatches sheetChange with index and name', () => {
    const handler = jest.fn();
    client.on('sheetChange', handler);
    const msg = createMessage('sheetChange', { index: 2, name: 'Data' });
    simulateMessage(msg, TARGET_ORIGIN, contentWindow);
    expect(handler).toHaveBeenCalledWith({ index: 2, name: 'Data' });
  });

  it('dispatches selectionChange from selectionChange message', () => {
    const handler = jest.fn();
    client.on('selectionChange', handler);
    const msg = createMessage('selectionChange', { row: 5, col: 3 });
    simulateMessage(msg, TARGET_ORIGIN, contentWindow);
    expect(handler).toHaveBeenCalledWith({ row: 5, col: 3 });
  });

  it('dispatches dirtyChange from dirtyChange message', () => {
    const handler = jest.fn();
    client.on('dirtyChange', handler);
    const msg = createMessage('dirtyChange', { dirty: true });
    simulateMessage(msg, TARGET_ORIGIN, contentWindow);
    expect(handler).toHaveBeenCalledWith(true);
  });

  it('dispatches saveStateChange as "saved" from saveCompleted', () => {
    const handler = jest.fn();
    client.on('saveStateChange', handler);
    simulateMessage(createMessage('saveCompleted'), TARGET_ORIGIN, contentWindow);
    expect(handler).toHaveBeenCalledWith('saved');
  });

  it('dispatches saveStateChange as "error" from saveFailed', () => {
    const handler = jest.fn();
    client.on('saveStateChange', handler);
    simulateMessage(createMessage('saveFailed'), TARGET_ORIGIN, contentWindow);
    expect(handler).toHaveBeenCalledWith('error');
  });

  it('dispatches capabilityDenied', () => {
    const handler = jest.fn();
    client.on('capabilityDenied', handler);
    const msg = createMessage('capabilityDenied', {
      capability: 'save',
      reason: 'Not supported',
    });
    simulateMessage(msg, TARGET_ORIGIN, contentWindow);
    expect(handler).toHaveBeenCalledWith({
      capability: 'save',
      reason: 'Not supported',
    });
  });

  it('dispatches capabilityDenied without reason', () => {
    const handler = jest.fn();
    client.on('capabilityDenied', handler);
    const msg = createMessage('capabilityDenied', { capability: 'export' });
    simulateMessage(msg, TARGET_ORIGIN, contentWindow);
    expect(handler).toHaveBeenCalledWith({
      capability: 'export',
      reason: undefined,
    });
  });

  it('dispatches effectiveState from effectiveCapabilities', () => {
    const handler = jest.fn();
    client.on('effectiveState', handler);
    const msg = createMessage('effectiveCapabilities', {
      mode: 'view',
      capabilities: ['scroll', 'select'],
    });
    simulateMessage(msg, TARGET_ORIGIN, contentWindow);
    expect(handler).toHaveBeenCalledWith({
      mode: 'view',
      capabilities: ['scroll', 'select'],
    });
  });

  it('dispatches error from error message', () => {
    const handler = jest.fn();
    client.on('error', handler);
    const msg = createMessage('error', { message: 'Something broke' });
    simulateMessage(msg, TARGET_ORIGIN, contentWindow);
    expect(handler).toHaveBeenCalledTimes(1);
    const err = handler.mock.calls[0][0] as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Something broke');
  });

  it('dispatches error with fallback message for non-string payload', () => {
    const handler = jest.fn();
    client.on('error', handler);
    const msg = createMessage('error', { code: 500 });
    simulateMessage(msg, TARGET_ORIGIN, contentWindow);
    const err = handler.mock.calls[0][0] as Error;
    expect(err.message).toBe('Unknown embed error');
  });

  it('dispatches ready event', () => {
    const handler = jest.fn();
    client.on('ready', handler);
    simulateMessage(createMessage('ready'), TARGET_ORIGIN, contentWindow);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignores messages with wrong origin', () => {
    const handler = jest.fn();
    client.on('sheetChange', handler);
    const msg = createMessage('sheetChange', { index: 0, name: 'S1' });
    simulateMessage(msg, 'https://evil.com', contentWindow);
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores messages with wrong source (not from iframe)', () => {
    const handler = jest.fn();
    client.on('sheetChange', handler);
    const msg = createMessage('sheetChange', { index: 0, name: 'S1' });
    simulateMessage(msg, TARGET_ORIGIN, {}); // wrong source
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores invalid messages (fails isValidMessage)', () => {
    const handler = jest.fn();
    client.on('ready', handler);
    simulateMessage({ not: 'a valid message' }, TARGET_ORIGIN, contentWindow);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Version negotiation
// ---------------------------------------------------------------------------

describe('MogIframeClient – version negotiation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects with VersionMismatchError when child sends versionMismatch', async () => {
    const { iframe, contentWindow } = makeMockIframe();
    const client = new MogIframeClient({
      iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
    });

    const promise = client.connect();

    const helloMsg = contentWindow.postMessage.mock.calls[0][0];
    const mismatch = createMessage('versionMismatch', { supportedVersions: [99] }, helloMsg.id);
    simulateMessage(mismatch, TARGET_ORIGIN, contentWindow);

    await expect(promise).rejects.toThrow(VersionMismatchError);
    client.dispose();
  });

  it('sends hello with supportedVersions on connect', () => {
    const { iframe, contentWindow } = makeMockIframe();
    const client = new MogIframeClient({
      iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
    });

    client.connect().catch(() => {});
    const helloMsg = contentWindow.postMessage.mock.calls[0][0];
    expect(helloMsg.type).toBe('hello');
    expect(helloMsg.payload.supportedVersions).toEqual([1]);
    client.dispose();
  });
});

// ---------------------------------------------------------------------------
// Request/response correlation timeout
// ---------------------------------------------------------------------------

describe('MogIframeClient – correlation timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects with CorrelationTimeoutError when response does not arrive', async () => {
    const { iframe, contentWindow } = makeMockIframe();
    const client = new MogIframeClient({
      iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
      responseTimeoutMs: 5000,
    });
    client.connect().catch(() => {});

    const promise = client.sendRequest('saveRequested');
    jest.advanceTimersByTime(5000);

    await expect(promise).rejects.toThrow(CorrelationTimeoutError);
    client.dispose();
  });

  it('resolves when correlated response arrives before timeout', async () => {
    const { iframe, contentWindow } = makeMockIframe();
    const client = new MogIframeClient({
      iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
      responseTimeoutMs: 5000,
    });
    client.connect().catch(() => {});

    const promise = client.sendRequest('saveRequested');
    const sentMsg = contentWindow.postMessage.mock.calls[1][0];

    const response = createMessage('saveCompleted', undefined, sentMsg.id);
    simulateMessage(response, TARGET_ORIGIN, contentWindow);

    const result = await promise;
    expect(result.type).toBe('saveCompleted');
    expect(result.correlationId).toBe(sentMsg.id);
    client.dispose();
  });

  it('rejects sendRequest if client is disposed', async () => {
    const { iframe } = makeMockIframe();
    const client = new MogIframeClient({
      iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
    });
    client.dispose();
    await expect(client.sendRequest('saveRequested')).rejects.toThrow('Client is disposed');
  });

  it('rejects pending requests on dispose', async () => {
    const { iframe } = makeMockIframe();
    const client = new MogIframeClient({
      iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
    });
    client.connect().catch(() => {});

    const promise = client.sendRequest('saveRequested');
    client.dispose();

    await expect(promise).rejects.toThrow('Client disposed');
  });
});

// ---------------------------------------------------------------------------
// Negative security: message validation on incoming
// ---------------------------------------------------------------------------

describe('MogIframeClient – negative security', () => {
  let client: MogIframeClient;
  let contentWindow: { postMessage: jest.Mock };

  beforeEach(() => {
    const mock = makeMockIframe();
    contentWindow = mock.contentWindow;
    client = new MogIframeClient({
      iframe: mock.iframe,
      targetOrigin: TARGET_ORIGIN,
      instanceId: 'inst',
    });
    client.connect().catch(() => {});
  });

  afterEach(() => {
    client.dispose();
  });

  it('ignores message with wrong protocol string', () => {
    const handler = jest.fn();
    client.on('ready', handler);
    simulateMessage(
      { protocol: 'wrong.protocol', version: 1, id: 'x', type: 'ready' },
      TARGET_ORIGIN,
      contentWindow,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores message with unsupported version', () => {
    const handler = jest.fn();
    client.on('ready', handler);
    simulateMessage(
      { protocol: 'mog.embed', version: 999, id: 'x', type: 'ready' },
      TARGET_ORIGIN,
      contentWindow,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores message with missing required fields (no id)', () => {
    const handler = jest.fn();
    client.on('ready', handler);
    simulateMessage(
      { protocol: 'mog.embed', version: 1, type: 'ready' },
      TARGET_ORIGIN,
      contentWindow,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores message with invalid/unknown type', () => {
    const handler = jest.fn();
    client.on('ready', handler);
    simulateMessage(
      { protocol: 'mog.embed', version: 1, id: 'x', type: 'unknownType' },
      TARGET_ORIGIN,
      contentWindow,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores message from wrong origin', () => {
    const handler = jest.fn();
    client.on('sheetChange', handler);
    simulateMessage(
      createMessage('sheetChange', { index: 0, name: 'S1' }),
      'https://attacker.com',
      contentWindow,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores messages after dispose', () => {
    const handler = jest.fn();
    client.on('sheetChange', handler);
    client.dispose();
    simulateMessage(
      createMessage('sheetChange', { index: 0, name: 'S1' }),
      TARGET_ORIGIN,
      contentWindow,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores non-object payloads (string)', () => {
    const handler = jest.fn();
    client.on('ready', handler);
    simulateMessage('not an object', TARGET_ORIGIN, contentWindow);
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores non-object payloads (number)', () => {
    const handler = jest.fn();
    client.on('ready', handler);
    simulateMessage(12345, TARGET_ORIGIN, contentWindow);
    expect(handler).not.toHaveBeenCalled();
  });
});
