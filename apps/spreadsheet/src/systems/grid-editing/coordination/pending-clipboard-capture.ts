let pendingClipboardCapture: Promise<void> | null = null;

export function trackPendingClipboardCapture(promise: Promise<void>): void {
  let tracked: Promise<void>;
  tracked = promise.finally(() => {
    if (pendingClipboardCapture === tracked) {
      pendingClipboardCapture = null;
    }
  });
  pendingClipboardCapture = tracked;
}

export async function waitForPendingClipboardCapture(): Promise<void> {
  if (!pendingClipboardCapture) return;
  await pendingClipboardCapture.catch(() => undefined);
}
