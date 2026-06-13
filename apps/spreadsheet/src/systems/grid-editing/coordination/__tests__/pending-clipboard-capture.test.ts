import {
  trackPendingClipboardCapture,
  waitForPendingClipboardCapture,
} from '../pending-clipboard-capture';

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function resetClipboardCaptureGlobal(): void {
  delete (globalThis as { __MOG_PENDING_CLIPBOARD_CAPTURE__?: unknown })
    .__MOG_PENDING_CLIPBOARD_CAPTURE__;
}

describe('pending clipboard capture', () => {
  beforeEach(() => {
    resetClipboardCaptureGlobal();
  });

  afterEach(() => {
    resetClipboardCaptureGlobal();
  });

  it('publishes pending capture globally until the copy work settles', async () => {
    const pending = createDeferred();
    trackPendingClipboardCapture(pending.promise);

    expect(
      (globalThis as { __MOG_PENDING_CLIPBOARD_CAPTURE__?: unknown })
        .__MOG_PENDING_CLIPBOARD_CAPTURE__,
    ).toBeInstanceOf(Promise);

    let settled = false;
    const wait = waitForPendingClipboardCapture().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    pending.resolve();
    await wait;
    await Promise.resolve();

    expect(settled).toBe(true);
    expect(
      (globalThis as { __MOG_PENDING_CLIPBOARD_CAPTURE__?: unknown })
        .__MOG_PENDING_CLIPBOARD_CAPTURE__,
    ).toBeUndefined();
  });
});
