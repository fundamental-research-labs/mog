type PendingClipboardPasteGlobal = typeof globalThis & {
  __MOG_PENDING_CLIPBOARD_PASTE__?: Promise<unknown>;
};

const globalPendingClipboardPaste = () => globalThis as PendingClipboardPasteGlobal;

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

export async function waitForPendingClipboardPaste(): Promise<void> {
  await Promise.resolve();
  await globalPendingClipboardPaste().__MOG_PENDING_CLIPBOARD_PASTE__;
}
