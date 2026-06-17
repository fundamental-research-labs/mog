type PendingAutofitGlobal = typeof globalThis & {
  __MOG_PENDING_AUTOFIT__?: Promise<unknown>;
};

const globalPendingAutofit = () => globalThis as PendingAutofitGlobal;

export function trackPendingAutofit<T>(promise: Promise<T>): void {
  const global = globalPendingAutofit();
  const tracked = promise.catch(() => undefined);
  global.__MOG_PENDING_AUTOFIT__ = tracked;
  void tracked.finally(() => {
    if (global.__MOG_PENDING_AUTOFIT__ === tracked) {
      delete global.__MOG_PENDING_AUTOFIT__;
    }
  });
}

export async function waitForPendingAutofit(): Promise<void> {
  await Promise.resolve();
  await globalPendingAutofit().__MOG_PENDING_AUTOFIT__;
}
