type PendingClipboardCaptureGlobal = typeof globalThis & {
  __MOG_PENDING_CLIPBOARD_CAPTURE__?: Promise<unknown>;
};

const globalPendingClipboardCapture = () => globalThis as PendingClipboardCaptureGlobal;

export function trackPendingClipboardCapture(promise: Promise<void>): void {
  const global = globalPendingClipboardCapture();
  const tracked = promise.catch(() => undefined);
  global.__MOG_PENDING_CLIPBOARD_CAPTURE__ = tracked;
  void tracked.finally(() => {
    if (global.__MOG_PENDING_CLIPBOARD_CAPTURE__ === tracked) {
      delete global.__MOG_PENDING_CLIPBOARD_CAPTURE__;
    }
  });
}

export async function waitForPendingClipboardCapture(): Promise<void> {
  await Promise.resolve();
  await globalPendingClipboardCapture().__MOG_PENDING_CLIPBOARD_CAPTURE__;
}
