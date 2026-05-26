/**
 * Jest setup for SDK conformance tests — suppress known lifecycle errors.
 *
 * The kernel's async lifecycle (ydoc observers, schema bridge timers) can fire
 * after engine.dispose() completes. These deferred callbacks find the bridge
 * already disposed and throw. In Node.js, this would be an uncaught exception.
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
