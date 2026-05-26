/**
 * @jest-environment jsdom
 */
import { MogIframeHost } from '../iframe/child-host';
import { createMessage, isValidMessage, SUPPORTED_VERSIONS } from '../iframe/protocol';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PARENT_ORIGIN = 'https://app.example.com';

/**
 * Mock window.parent.postMessage — jsdom's window.parent === window by
 * default, so we override it with a minimal mock that captures calls.
 */
function installMockParent(): jest.Mock {
  const mockPostMessage = jest.fn();
  Object.defineProperty(window, 'parent', {
    value: { postMessage: mockPostMessage },
    writable: true,
    configurable: true,
  });
  return mockPostMessage;
}

/**
 * Simulate a message arriving on the child window from the parent.
 * `source` defaults to `window.parent`.
 */
function simulateParentMessage(
  data: unknown,
  origin: string,
  source: unknown = window.parent,
): void {
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

describe('MogIframeHost – construction', () => {
  it('throws if allowedParentOrigins is empty', () => {
    expect(
      () =>
        new MogIframeHost({
          allowedParentOrigins: [],
          channelNonce: 'nonce',
        }),
    ).toThrow('At least one allowed parent origin is required');
  });

  it('accepts non-empty origins array', () => {
    expect(
      () =>
        new MogIframeHost({
          allowedParentOrigins: [PARENT_ORIGIN],
          channelNonce: 'nonce',
        }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------

describe('MogIframeHost – start / message validation', () => {
  let parentPost: jest.Mock;
  let host: MogIframeHost;

  beforeEach(() => {
    parentPost = installMockParent();
    host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
  });

  afterEach(() => {
    host.dispose();
  });

  it('accepts messages from allowed origin with valid format', () => {
    // Send a message that triggers the host to store parentOrigin
    const msg = createMessage('sheetSelect', { target: 0 });
    simulateParentMessage(msg, PARENT_ORIGIN);

    // parentOrigin now known — emitReady should post to parent
    host.emitReady();
    expect(parentPost).toHaveBeenCalled();
    const sentMsg = parentPost.mock.calls[0][0];
    expect(sentMsg.type).toBe('ready');
  });

  it('rejects messages with wrong origin', () => {
    const msg = createMessage('sheetSelect', { target: 0 });
    simulateParentMessage(msg, 'https://evil.com');

    // parentOrigin should still be null — emitReady should not post
    host.emitReady();
    expect(parentPost).not.toHaveBeenCalled();
  });

  it('rejects messages with wrong source (not window.parent)', () => {
    const msg = createMessage('sheetSelect', { target: 0 });
    simulateParentMessage(msg, PARENT_ORIGIN, {}); // wrong source

    host.emitReady();
    expect(parentPost).not.toHaveBeenCalled();
  });

  it('rejects messages that fail isValidMessage', () => {
    simulateParentMessage({ bogus: true }, PARENT_ORIGIN);

    host.emitReady();
    expect(parentPost).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// emitReady
// ---------------------------------------------------------------------------

describe('MogIframeHost – emitReady', () => {
  let parentPost: jest.Mock;

  beforeEach(() => {
    parentPost = installMockParent();
  });

  it('does NOT post if parentOrigin not yet known', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
    host.emitReady();
    expect(parentPost).not.toHaveBeenCalled();
    host.dispose();
  });

  it('posts ready message after parentOrigin is established', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();

    // Establish parentOrigin by receiving a valid message
    simulateParentMessage(createMessage('heartbeat'), PARENT_ORIGIN);

    host.emitReady();
    expect(parentPost).toHaveBeenCalledTimes(1);
    const [msg, origin] = parentPost.mock.calls[0];
    expect(msg.type).toBe('ready');
    expect(origin).toBe(PARENT_ORIGIN);
    expect(isValidMessage(msg)).toBe(true);
    host.dispose();
  });
});

// ---------------------------------------------------------------------------
// Emit methods
// ---------------------------------------------------------------------------

describe('MogIframeHost – emit methods', () => {
  let parentPost: jest.Mock;
  let host: MogIframeHost;

  beforeEach(() => {
    parentPost = installMockParent();
    host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
    // Establish parentOrigin
    simulateParentMessage(createMessage('heartbeat'), PARENT_ORIGIN);
    parentPost.mockClear();
  });

  afterEach(() => {
    host.dispose();
  });

  it('emitSheetChange sends sheetChange with correct payload', () => {
    host.emitSheetChange({ index: 3, name: 'Revenue' });
    const [msg] = parentPost.mock.calls[0];
    expect(msg.type).toBe('sheetChange');
    expect(msg.payload).toEqual({ index: 3, name: 'Revenue' });
  });

  it('emitSelectionChange sends selectionChange with correct payload', () => {
    host.emitSelectionChange({ row: 10, col: 5 });
    const [msg] = parentPost.mock.calls[0];
    expect(msg.type).toBe('selectionChange');
    expect(msg.payload).toEqual({ row: 10, col: 5 });
  });

  it('emitDirtyChange sends dirtyChange with dirty flag', () => {
    host.emitDirtyChange(true);
    const [msg] = parentPost.mock.calls[0];
    expect(msg.type).toBe('dirtyChange');
    expect(msg.payload).toEqual({ dirty: true });
  });

  it('emitDirtyChange sends dirtyChange with false', () => {
    host.emitDirtyChange(false);
    const [msg] = parentPost.mock.calls[0];
    expect(msg.type).toBe('dirtyChange');
    expect(msg.payload).toEqual({ dirty: false });
  });

  it('emitCapabilityDenied sends capabilityDenied with capability and reason', () => {
    host.emitCapabilityDenied('save', 'Not supported');
    const [msg] = parentPost.mock.calls[0];
    expect(msg.type).toBe('capabilityDenied');
    expect(msg.payload).toEqual({ capability: 'save', reason: 'Not supported' });
  });

  it('emitCapabilityDenied sends without reason when omitted', () => {
    host.emitCapabilityDenied('export');
    const [msg] = parentPost.mock.calls[0];
    expect(msg.type).toBe('capabilityDenied');
    expect(msg.payload).toEqual({ capability: 'export', reason: undefined });
  });

  it('emitError sends error with message', () => {
    host.emitError(new Error('Something failed'));
    const [msg] = parentPost.mock.calls[0];
    expect(msg.type).toBe('error');
    expect(msg.payload).toEqual({ message: 'Something failed' });
  });
});

// ---------------------------------------------------------------------------
// emitSaveState
// ---------------------------------------------------------------------------

describe('MogIframeHost – emitSaveState', () => {
  let parentPost: jest.Mock;
  let host: MogIframeHost;

  beforeEach(() => {
    parentPost = installMockParent();
    host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
    simulateParentMessage(createMessage('heartbeat'), PARENT_ORIGIN);
    parentPost.mockClear();
  });

  afterEach(() => {
    host.dispose();
  });

  it('"saved" sends saveCompleted', () => {
    host.emitSaveState('saved');
    const [msg] = parentPost.mock.calls[0];
    expect(msg.type).toBe('saveCompleted');
  });

  it('"error" sends saveFailed', () => {
    host.emitSaveState('error');
    const [msg] = parentPost.mock.calls[0];
    expect(msg.type).toBe('saveFailed');
  });

  it('"idle" does not send a message', () => {
    host.emitSaveState('idle');
    expect(parentPost).not.toHaveBeenCalled();
  });

  it('"saving" does not send a message', () => {
    host.emitSaveState('saving');
    expect(parentPost).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Save / export request handling
// ---------------------------------------------------------------------------

describe('MogIframeHost – save request handling', () => {
  let parentPost: jest.Mock;

  beforeEach(() => {
    parentPost = installMockParent();
  });

  it('calls onSaveRequest callback when saveRequested received', async () => {
    const onSaveRequest = jest.fn().mockResolvedValue(true);
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
      onSaveRequest,
    });
    host.start();
    simulateParentMessage(createMessage('saveRequested'), PARENT_ORIGIN);

    // Allow the async handler to run
    await flushMicrotasks();
    expect(onSaveRequest).toHaveBeenCalledTimes(1);
    host.dispose();
  });

  it('emits capabilityDenied if onSaveRequest not provided', async () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
      // no onSaveRequest
    });
    host.start();
    simulateParentMessage(createMessage('saveRequested'), PARENT_ORIGIN);

    await flushMicrotasks();
    const capDenied = parentPost.mock.calls.find(([msg]: [any]) => msg.type === 'capabilityDenied');
    expect(capDenied).toBeDefined();
    expect(capDenied![0].payload.capability).toBe('save');
    host.dispose();
  });

  it('emits saveState error if onSaveRequest throws', async () => {
    const onSaveRequest = jest.fn().mockRejectedValue(new Error('fail'));
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
      onSaveRequest,
    });
    host.start();
    simulateParentMessage(createMessage('saveRequested'), PARENT_ORIGIN);

    await flushMicrotasks();
    const saveFailed = parentPost.mock.calls.find(([msg]: [any]) => msg.type === 'saveFailed');
    expect(saveFailed).toBeDefined();
    host.dispose();
  });

  it('emits saveCompleted when onSaveRequest returns true', async () => {
    const onSaveRequest = jest.fn().mockResolvedValue(true);
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
      onSaveRequest,
    });
    host.start();
    simulateParentMessage(createMessage('saveRequested'), PARENT_ORIGIN);

    await flushMicrotasks();
    const saveCompleted = parentPost.mock.calls.find(
      ([msg]: [any]) => msg.type === 'saveCompleted',
    );
    expect(saveCompleted).toBeDefined();
    host.dispose();
  });

  it('emits saveFailed when onSaveRequest returns false', async () => {
    const onSaveRequest = jest.fn().mockResolvedValue(false);
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
      onSaveRequest,
    });
    host.start();
    simulateParentMessage(createMessage('saveRequested'), PARENT_ORIGIN);

    await flushMicrotasks();
    const saveFailed = parentPost.mock.calls.find(([msg]: [any]) => msg.type === 'saveFailed');
    expect(saveFailed).toBeDefined();
    host.dispose();
  });
});

describe('MogIframeHost – export request handling', () => {
  let parentPost: jest.Mock;

  beforeEach(() => {
    parentPost = installMockParent();
  });

  it('calls onExportRequest callback', async () => {
    const blob = new Blob(['data']);
    const onExportRequest = jest.fn().mockResolvedValue(blob);
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
      onExportRequest,
    });
    host.start();
    simulateParentMessage(createMessage('exportRequested', { format: 'csv' }), PARENT_ORIGIN);

    await flushMicrotasks();
    expect(onExportRequest).toHaveBeenCalledWith('csv');
    host.dispose();
  });

  it('emits capabilityDenied if onExportRequest not provided', async () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
    simulateParentMessage(createMessage('exportRequested', { format: 'xlsx' }), PARENT_ORIGIN);

    await flushMicrotasks();
    const capDenied = parentPost.mock.calls.find(([msg]: [any]) => msg.type === 'capabilityDenied');
    expect(capDenied).toBeDefined();
    expect(capDenied![0].payload.capability).toBe('export');
    host.dispose();
  });

  it('emits exportCompleted when onExportRequest returns blob', async () => {
    const blob = new Blob(['data']);
    const onExportRequest = jest.fn().mockResolvedValue(blob);
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
      onExportRequest,
    });
    host.start();
    simulateParentMessage(createMessage('exportRequested', { format: 'csv' }), PARENT_ORIGIN);

    await flushMicrotasks();
    const completed = parentPost.mock.calls.find(([msg]: [any]) => msg.type === 'exportCompleted');
    expect(completed).toBeDefined();
    expect(completed![0].payload).toEqual({ format: 'csv' });
    host.dispose();
  });

  it('emits error when onExportRequest throws', async () => {
    const onExportRequest = jest.fn().mockRejectedValue(new Error('boom'));
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
      onExportRequest,
    });
    host.start();
    simulateParentMessage(createMessage('exportRequested', { format: 'xlsx' }), PARENT_ORIGIN);

    await flushMicrotasks();
    const errMsg = parentPost.mock.calls.find(([msg]: [any]) => msg.type === 'error');
    expect(errMsg).toBeDefined();
    expect(errMsg![0].payload.message).toBe('Export failed');
    host.dispose();
  });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe('MogIframeHost – dispose', () => {
  let parentPost: jest.Mock;

  beforeEach(() => {
    parentPost = installMockParent();
  });

  it('sends dispose message to the parent', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
    // Establish parentOrigin
    simulateParentMessage(createMessage('heartbeat'), PARENT_ORIGIN);
    parentPost.mockClear();

    host.dispose();
    expect(parentPost).toHaveBeenCalledTimes(1);
    const [msg, origin] = parentPost.mock.calls[0];
    expect(msg.type).toBe('dispose');
    expect(origin).toBe(PARENT_ORIGIN);
  });

  it('removes event listener (subsequent messages ignored)', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
    simulateParentMessage(createMessage('heartbeat'), PARENT_ORIGIN);

    host.dispose();
    parentPost.mockClear();

    // This message should be ignored — listener removed
    simulateParentMessage(createMessage('saveRequested'), PARENT_ORIGIN);
    // No new calls beyond what dispose itself sent
    expect(parentPost).not.toHaveBeenCalled();
  });

  it('subsequent emits are no-ops', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
    simulateParentMessage(createMessage('heartbeat'), PARENT_ORIGIN);

    host.dispose();
    parentPost.mockClear();

    host.emitReady();
    host.emitSheetChange({ index: 0, name: 'S1' });
    host.emitError(new Error('test'));
    expect(parentPost).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Version negotiation (child side)
// ---------------------------------------------------------------------------

describe('MogIframeHost – version negotiation', () => {
  let parentPost: jest.Mock;

  beforeEach(() => {
    parentPost = installMockParent();
  });

  it('responds with helloAck and selected version for supported version', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();

    const hello = createMessage('hello', { supportedVersions: [1] });
    simulateParentMessage(hello, PARENT_ORIGIN);

    expect(parentPost).toHaveBeenCalledTimes(1);
    const [msg, origin] = parentPost.mock.calls[0];
    expect(msg.type).toBe('helloAck');
    expect(msg.correlationId).toBe(hello.id);
    expect(msg.payload.selectedVersion).toBe(1);
    expect(origin).toBe(PARENT_ORIGIN);
    expect(host.negotiatedVersion).toBe(1);
    host.dispose();
  });

  it('responds with versionMismatch for unsupported versions', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();

    const hello = createMessage('hello', { supportedVersions: [99, 100] });
    simulateParentMessage(hello, PARENT_ORIGIN);

    expect(parentPost).toHaveBeenCalledTimes(1);
    const [msg] = parentPost.mock.calls[0];
    expect(msg.type).toBe('versionMismatch');
    expect(msg.correlationId).toBe(hello.id);
    expect(msg.payload.supportedVersions).toEqual([...SUPPORTED_VERSIONS]);
    expect(host.negotiatedVersion).toBeNull();
    host.dispose();
  });

  it('responds with versionMismatch for empty offered versions', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();

    const hello = createMessage('hello', { supportedVersions: [] });
    simulateParentMessage(hello, PARENT_ORIGIN);

    const [msg] = parentPost.mock.calls[0];
    expect(msg.type).toBe('versionMismatch');
    host.dispose();
  });
});

// ---------------------------------------------------------------------------
// Negative security (child side)
// ---------------------------------------------------------------------------

describe('MogIframeHost – negative security', () => {
  let parentPost: jest.Mock;

  beforeEach(() => {
    parentPost = installMockParent();
  });

  it('ignores message from wrong origin', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
    simulateParentMessage(createMessage('heartbeat'), 'https://evil.com');
    host.emitReady();
    expect(parentPost).not.toHaveBeenCalled();
    host.dispose();
  });

  it('ignores message with wrong protocol string', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
    simulateParentMessage(
      { protocol: 'wrong', version: 1, id: 'x', type: 'heartbeat' },
      PARENT_ORIGIN,
    );
    host.emitReady();
    expect(parentPost).not.toHaveBeenCalled();
    host.dispose();
  });

  it('ignores message with unsupported version number', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
    simulateParentMessage(
      { protocol: 'mog.embed', version: 999, id: 'x', type: 'heartbeat' },
      PARENT_ORIGIN,
    );
    host.emitReady();
    expect(parentPost).not.toHaveBeenCalled();
    host.dispose();
  });

  it('ignores malformed payload (missing required fields)', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
    simulateParentMessage({ protocol: 'mog.embed', version: 1, type: 'heartbeat' }, PARENT_ORIGIN);
    host.emitReady();
    expect(parentPost).not.toHaveBeenCalled();
    host.dispose();
  });

  it('ignores message with invalid/unknown type', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
    simulateParentMessage(
      { protocol: 'mog.embed', version: 1, id: 'x', type: 'madeUpType' },
      PARENT_ORIGIN,
    );
    host.emitReady();
    expect(parentPost).not.toHaveBeenCalled();
    host.dispose();
  });

  it('ignores message with wrong source (not window.parent)', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
    simulateParentMessage(createMessage('heartbeat'), PARENT_ORIGIN, {});
    host.emitReady();
    expect(parentPost).not.toHaveBeenCalled();
    host.dispose();
  });

  it('ignores messages after dispose', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
    simulateParentMessage(createMessage('heartbeat'), PARENT_ORIGIN);
    host.dispose();
    parentPost.mockClear();

    simulateParentMessage(createMessage('saveRequested'), PARENT_ORIGIN);
    expect(parentPost).not.toHaveBeenCalled();
  });

  it('ignores non-object payloads', () => {
    const host = new MogIframeHost({
      allowedParentOrigins: [PARENT_ORIGIN],
      channelNonce: 'nonce',
    });
    host.start();
    simulateParentMessage('just a string', PARENT_ORIGIN);
    host.emitReady();
    expect(parentPost).not.toHaveBeenCalled();
    host.dispose();
  });
});

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
