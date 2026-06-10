type PendingClipboardPasteGlobal = typeof globalThis & {
  __MOG_PENDING_CLIPBOARD_PASTE__?: Promise<unknown>;
  __MOG_ACTIVE_CLIPBOARD_PASTE__?: Promise<unknown>;
};

const globalPendingClipboardPaste = () => globalThis as PendingClipboardPasteGlobal;

function waitForTwoFrames(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, 32));
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function trackPendingClipboardPaste<T>(promise: Promise<T>): void {
  const global = globalPendingClipboardPaste();
  const tracked = promise.catch(() => undefined);
  global.__MOG_PENDING_CLIPBOARD_PASTE__ = tracked;
  void tracked.finally(() => {
    if (global.__MOG_PENDING_CLIPBOARD_PASTE__ === tracked) {
      delete global.__MOG_PENDING_CLIPBOARD_PASTE__;
    }
  });
}

export function trackActiveClipboardPaste<T>(promise: Promise<T>): void {
  const global = globalPendingClipboardPaste();
  const tracked = promise.catch(() => undefined);
  global.__MOG_ACTIVE_CLIPBOARD_PASTE__ = tracked;
  void tracked.finally(async () => {
    await waitForTwoFrames();
    if (global.__MOG_ACTIVE_CLIPBOARD_PASTE__ === tracked) {
      delete global.__MOG_ACTIVE_CLIPBOARD_PASTE__;
    }
  });
}

export async function waitForPendingClipboardPaste(): Promise<void> {
  await Promise.resolve();
  await globalPendingClipboardPaste().__MOG_PENDING_CLIPBOARD_PASTE__;
}

export async function waitForActiveClipboardPaste(): Promise<void> {
  await Promise.resolve();
  await globalPendingClipboardPaste().__MOG_ACTIVE_CLIPBOARD_PASTE__;
}

export function getActiveClipboardPaste(): Promise<unknown> | undefined {
  return globalPendingClipboardPaste().__MOG_ACTIVE_CLIPBOARD_PASTE__;
}
