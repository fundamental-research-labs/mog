const APPLY_AFTER_CLOSE_DELAY_MS = 100;

type DialogActionGlobal = typeof globalThis & {
  __MOG_PENDING_DIALOG_ACTION__?: Promise<void>;
};

function getDialogActionGlobal(): DialogActionGlobal {
  return globalThis as DialogActionGlobal;
}

export function scheduleDialogAction(action: () => unknown): void {
  const global = getDialogActionGlobal();
  const pending = new Promise<void>((resolve, reject) => {
    globalThis.setTimeout(() => {
      Promise.resolve()
        .then(action)
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

export function runDialogActionNow(action: () => unknown): void {
  const global = getDialogActionGlobal();
  let resolvePending!: () => void;
  let rejectPending!: (error: unknown) => void;
  const pending = new Promise<void>((resolve, reject) => {
    resolvePending = resolve;
    rejectPending = reject;
  });
  const complete = () => {
    if (global.__MOG_PENDING_DIALOG_ACTION__ === pending) {
      delete global.__MOG_PENDING_DIALOG_ACTION__;
    }
  };
  global.__MOG_PENDING_DIALOG_ACTION__ = pending;
  try {
    Promise.resolve(action()).then(
      () => {
        complete();
        resolvePending();
      },
      (error) => {
        complete();
        rejectPending(error);
      },
    );
  } catch (error) {
    complete();
    rejectPending(error);
  }
}

export function getPendingDialogActionForTest(): Promise<void> | undefined {
  return getDialogActionGlobal().__MOG_PENDING_DIALOG_ACTION__;
}

export function clearPendingDialogActionForTest(): void {
  delete getDialogActionGlobal().__MOG_PENDING_DIALOG_ACTION__;
}
