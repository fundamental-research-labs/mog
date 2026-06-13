type PendingClipboardCaptureGlobal = typeof globalThis & {
  __MOG_PENDING_CLIPBOARD_CAPTURE__?: Promise<unknown>;
};

const globalPendingClipboardCapture = () => globalThis as PendingClipboardCaptureGlobal;

let pendingClipboardCapture: Promise<unknown> | null = null;

export function trackPendingClipboardCapture<T>(promise: Promise<T>): void {
  const global = globalPendingClipboardCapture();
  const tracked = promise.catch(() => undefined);
  pendingClipboardCapture = tracked;
  global.__MOG_PENDING_CLIPBOARD_CAPTURE__ = tracked;
  void tracked.finally(() => {
    if (pendingClipboardCapture === tracked) {
      pendingClipboardCapture = null;
    }
    if (global.__MOG_PENDING_CLIPBOARD_CAPTURE__ === tracked) {
      delete global.__MOG_PENDING_CLIPBOARD_CAPTURE__;
    }
  });
}

export async function waitForPendingClipboardCapture(): Promise<void> {
  await Promise.resolve();
  await (pendingClipboardCapture ??
    globalPendingClipboardCapture().__MOG_PENDING_CLIPBOARD_CAPTURE__);
}
