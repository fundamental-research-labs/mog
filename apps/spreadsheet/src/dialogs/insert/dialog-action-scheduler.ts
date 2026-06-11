const APPLY_AFTER_CLOSE_DELAY_MS = 100;

type DialogActionGlobal = typeof globalThis & {
  __MOG_PENDING_DIALOG_ACTION__?: Promise<void>;
  __MOG_PENDING_FILTER_HEADER_REFRESH__?: Promise<void>;
};

function getDialogActionGlobal(): DialogActionGlobal {
  return globalThis as DialogActionGlobal;
}

function waitForAnimationFrames(count: number): Promise<void> {
  if (count <= 0 || typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
}

async function waitForDialogActionBarriers(global: DialogActionGlobal): Promise<void> {
  await Promise.resolve();
  const pendingFilterRefresh = global.__MOG_PENDING_FILTER_HEADER_REFRESH__;
  if (pendingFilterRefresh) {
    await pendingFilterRefresh;
    await waitForAnimationFrames(2);
  }
}

export function scheduleDialogAction(action: () => unknown): void {
  const global = getDialogActionGlobal();
  const pending = new Promise<void>((resolve, reject) => {
    globalThis.setTimeout(() => {
      Promise.resolve()
        .then(action)
        .then(() => waitForDialogActionBarriers(global))
        .then(
          () => {
            if (global.__MOG_PENDING_DIALOG_ACTION__ === pending) {
              delete global.__MOG_PENDING_DIALOG_ACTION__;
            }
            resolve();
          },
          (error) => {
            if (global.__MOG_PENDING_DIALOG_ACTION__ === pending) {
              delete global.__MOG_PENDING_DIALOG_ACTION__;
            }
            reject(error);
          },
        );
    }, APPLY_AFTER_CLOSE_DELAY_MS);
  });
  global.__MOG_PENDING_DIALOG_ACTION__ = pending;
}

export function getPendingDialogActionForTest(): Promise<void> | undefined {
  return getDialogActionGlobal().__MOG_PENDING_DIALOG_ACTION__;
}

export function clearPendingDialogActionForTest(): void {
  delete getDialogActionGlobal().__MOG_PENDING_DIALOG_ACTION__;
}
