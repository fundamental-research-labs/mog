/**
 * Bridge DevTools Wrapper
 *
 * Wraps any bridge object with a Proxy that times every method call
 * and reports to the OS DevTools global hook (`window.__OS_DEVTOOLS__`).
 *
 * Zero cost when devtools is not loaded — returns the original bridge unchanged.
 *
 */

interface DevToolsHook {
  reportBridgeCall(
    bridge: string,
    method: string,
    args: unknown[],
    durationMs: number,
    result: unknown,
    error?: string,
  ): void;
}

/**
 * Subset of the `__dt` console API that this wrapper depends on. Kernel only
 * reports bridge errors to devtools; devtools owns the rest of the `__dt`
 * console surface.
 */
interface DevToolsCaptureErrorAPI {
  captureError?: (source: string, error: unknown) => void;
}

/**
 * Push a thrown bridge error into the devtools `recentErrors` ring buffer
 *. The wrapper still re-throws — this is observation only.
 *
 * Source tag is `bridge:<methodName>` so callers reading the buffer can
 * pinpoint which compute/pivot/chart bridge call swallowed (now: surfaced)
 * the error. No-op when devtools isn't loaded.
 */
function pushBridgeError(method: string, err: unknown): void {
  if (typeof window === 'undefined') return;
  const dt = (window as { __dt?: DevToolsCaptureErrorAPI }).__dt;
  dt?.captureError?.(`bridge:${method}`, err);
}

// =============================================================================
// Eviction sink — IndexedDBProvider → __dt.captureError pathway
// =============================================================================

/**
 * Eviction event emitted by `IndexedDBProvider` when it soft-evicts docs
 * (quota / age threshold). Mirrors the
 * `console.warn(...)` payload that previously reached `__dt.captureError`
 * via a hand-coded `globalThis.__dt` lookup inside the provider.
 *
 */
export interface EvictionEvent {
  readonly evictedCount: number;
  readonly evictedDocIds: readonly string[];
  readonly message: string;
}

type EvictionSink = (event: EvictionEvent) => void;

let evictionSink: EvictionSink | null = null;

/**
 * Read the currently-installed eviction sink (or `null` if no shell-level
 * harness has wired one). `IndexedDBProvider` calls this from its eviction
 * code path; the harness wires it to `__dt.captureError` via
 * {@link installEvictionSink}.
 *
 * Mirrors the injected-reader pattern used by shell/devtools readbacks so
 * kernel modules don't reach into `globalThis.__dt` by hand.
 */
export function getEvictionSink(): EvictionSink | null {
  return evictionSink;
}

/**
 * Install a sink for `IndexedDBProvider` eviction events. The shell-level
 * harness wires the sink to `__dt.captureError` so the hard-kill persistence
 * scenario can read the eviction warning via `__dt.getRecentErrors()`.
 *
 * Idempotent — calling again replaces the previous sink.
 */
export function installEvictionSink(sink: EvictionSink | null): void {
  evictionSink = sink;
}

/**
 * Sanitize an array of call arguments so they can be safely passed over
 * BroadcastChannel (which uses the structured-clone algorithm).
 *
 * Non-serializable values — functions, class instances with prototype methods,
 * Proxies, WASM objects — are replaced with a plain descriptor string so that
 * the DevTools panel still gets useful context without crashing.
 */
function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (arg === null || arg === undefined) return arg;
    if (typeof arg === 'function') return '[Function]';
    if (typeof arg !== 'object') return arg;
    // Fast path: try structured-clone; if it throws, fall back to a safe repr.
    try {
      return structuredClone(arg);
    } catch {
      // Non-cloneable object (e.g. WASM handle, Proxy, class instance with
      // methods). Return a plain descriptor that DevTools can display.
      const ctor = (arg as object).constructor?.name;
      return `[${ctor && ctor !== 'Object' ? ctor : 'Object'}]`;
    }
  });
}

/**
 * Get the devtools hook if available.
 * Returns undefined in production or when devtools is not loaded.
 */
function getDevToolsHook(): DevToolsHook | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as { __OS_DEVTOOLS__?: DevToolsHook }).__OS_DEVTOOLS__;
}

/**
 * Wrap a bridge object with devtools call tracing.
 *
 * Every method call on the returned proxy is timed and reported to
 * `window.__OS_DEVTOOLS__.reportBridgeCall()`. Both sync and async
 * (Promise-returning) methods are handled.
 *
 * If `__OS_DEVTOOLS__` is not present, returns the original bridge
 * unchanged — zero overhead in production.
 *
 * @param bridge - The bridge instance to wrap
 * @param name - Human-readable name (e.g. 'compute', 'pivot', 'chart')
 * @returns The proxied bridge (same type as input)
 */
export function wrapBridgeForDevTools<T extends object>(bridge: T, name: string): T {
  const hook = getDevToolsHook();
  if (!hook) return bridge;

  return new Proxy(bridge, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;

      return function (this: unknown, ...args: unknown[]) {
        const start = performance.now();
        // Sanitize args once — reused for all reportBridgeCall paths below.
        // BroadcastChannel requires structured-cloneable values; callbacks and
        // WASM objects are not, and would throw a DataCloneError.
        const safeArgs = sanitizeArgs(args);
        try {
          const result = value.apply(this === receiver ? target : this, args);

          // Handle async (Promise-returning) methods
          if (
            result &&
            typeof result === 'object' &&
            typeof (result as Promise<unknown>).then === 'function'
          ) {
            return (result as Promise<unknown>).then(
              (res: unknown) => {
                hook.reportBridgeCall(name, String(prop), safeArgs, performance.now() - start, res);
                return res;
              },
              (err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                hook.reportBridgeCall(
                  name,
                  String(prop),
                  safeArgs,
                  performance.now() - start,
                  undefined,
                  msg,
                );
                // O-A: surface the error in the devtools error ring buffer so
                // callers reading `__dt.getRecentErrors()` see which bridge
                // method rejected. Re-throw so the calling code's own
                // try/catch (or unhandledrejection handler) still sees it —
                // this is observation only, never swallow.
                pushBridgeError(String(prop), err);
                throw err;
              },
            );
          }

          // Sync method
          hook.reportBridgeCall(name, String(prop), safeArgs, performance.now() - start, result);
          return result;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          hook.reportBridgeCall(
            name,
            String(prop),
            safeArgs,
            performance.now() - start,
            undefined,
            msg,
          );
          // O-A: surface sync throws too. Re-throw immediately after — no
          // swallowing.
          pushBridgeError(String(prop), err);
          throw err;
        }
      };
    },
  });
}
