const APPLY_AFTER_CLOSE_DELAY_MS = 100;

type DialogActionGlobal = typeof globalThis & {
  __MOG_PENDING_DIALOG_ACTION__?: Promise<void>;
  __MOG_ACTIVE_DIALOG_ACTION__?: Promise<void>;
};

function getDialogActionGlobal(): DialogActionGlobal {
  return globalThis as DialogActionGlobal;
}

export function scheduleDialogAction(action: () => unknown): void {
  const global = getDialogActionGlobal();
  const pending = new Promise<void>((resolve, reject) => {
    globalThis.setTimeout(() => {
      global.__MOG_ACTIVE_DIALOG_ACTION__ = pending;
      let result: unknown;
      try {
        result = action();
      } catch (error) {
        if (global.__MOG_ACTIVE_DIALOG_ACTION__ === pending) {
          delete global.__MOG_ACTIVE_DIALOG_ACTION__;
        }
        if (global.__MOG_PENDING_DIALOG_ACTION__ === pending) {
          delete global.__MOG_PENDING_DIALOG_ACTION__;
        }
        reject(error);
        return;
      }
      if (global.__MOG_ACTIVE_DIALOG_ACTION__ === pending) {
        delete global.__MOG_ACTIVE_DIALOG_ACTION__;
      }
      Promise.resolve(result).then(
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
  const global = getDialogActionGlobal();
  delete global.__MOG_PENDING_DIALOG_ACTION__;
  delete global.__MOG_ACTIVE_DIALOG_ACTION__;
}
