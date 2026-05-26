/**
 * Jest global setup — suppress known "Bridge is disposed" errors.
 *
 * The kernel's async lifecycle (ydoc observers, schema bridge timers) can fire
 * after engine.dispose() completes. These deferred callbacks find the bridge
 * already disposed and throw. In the browser, the page unloads so this is
 * invisible. In Node.js, it's an uncaught exception that kills the process.
 *
 * This setup file installs handlers at the earliest possible point to
 * suppress these harmless errors.
 */

export {};

function isBridgeDisposedError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('Bridge is disposed');
}

process.on('uncaughtException', (err) => {
  if (isBridgeDisposedError(err)) return;
  throw err;
});

process.on('unhandledRejection', (reason) => {
  if (isBridgeDisposedError(reason)) return;
  throw reason as Error;
});
