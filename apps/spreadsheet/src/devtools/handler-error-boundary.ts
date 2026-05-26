/**
 * Handler error boundary.
 *
 * Thin async wrapper that surfaces fire-and-forget handler errors into the
 * devtools `recentErrors` ring buffer. Wrap any promise chain that previously
 * had a missing or empty `.catch(() => {})` so a failure no longer dies in
 * silence.
 *
 * Usage from a hook / chrome callback:
 *
 * await withHandlerErrors('CLEAR_CONTENTS', async => {
 * await ws.cells.clear(ranges);
 * });
 *
 * // Or wrapping an existing dispatch return value:
 * void withHandlerErrors('CLEAR_CONTENTS', => dispatch('CLEAR_CONTENTS', deps));
 *
 * Behaviour:
 * 1. Awaits `fn`.
 * 2. On throw / rejection: pushes `source: 'handler:<name>'` into the
 * devtools error buffer via `window.__dt?.captureError?.(...)` (optional
 * chaining keeps the production build that doesn't load devtools at zero
 * overhead), then re-throws so any caller `try/catch` or the global
 * `unhandledrejection` handler still sees the error.
 * 3. Returns whatever `fn` returned on success — this wrapper is
 * transparent for the happy path.
 *
 */

/** Subset of `__dt` we depend on — duck-typed so this file has no hard
 * dependency on `@mog/devtools` types loading first. */
interface DevToolsCaptureErrorAPI {
  captureError?: (source: string, error: unknown) => void;
}

/**
 * Wrap a fire-and-forget (or awaited) handler function so its errors land in
 * the devtools error ring buffer tagged with `source: 'handler:<name>'`.
 *
 * @param name - Canonical action name (e.g. `'CLEAR_CONTENTS'`, `'PASTE'`).
 * Becomes the suffix on `source: 'handler:<name>'`.
 * @param fn - The function to invoke. May be sync or async.
 * @returns - A Promise resolving to whatever `fn` returned. Re-throws on
 * error after capture.
 */
export async function withHandlerErrors<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // Optional chaining everywhere: if devtools isn't loaded (production)
    // or we're running outside a browser (SSR / Node test harness without
    // a polyfilled `window.__dt`), the call short-circuits silently. The
    // caller's try/catch or `unhandledrejection` handler still sees the
    // re-thrown error below — observation, never swallow.
    const win =
      typeof window !== 'undefined' ? (window as { __dt?: DevToolsCaptureErrorAPI }) : undefined;
    win?.__dt?.captureError?.(`handler:${name}`, err);
    throw err;
  }
}
