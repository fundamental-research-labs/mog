/**
 * Error capture self-test.
 *
 * Validates the three new ingestion paths added to the devtools error ring
 * buffer:
 *
 *   1. `withHandlerErrors('<NAME>', fn)` — fire-and-forget handler wrapper
 *      surfaces a thrown error as `source: 'handler:<NAME>'`.
 *   2. The bridge devtools wrapper (`wrapBridgeForDevTools`) pushes
 *      `source: 'bridge:<methodName>'` *and* re-throws so callers still see
 *      the error. Both sync throws and async rejections are covered.
 *   3. `__dt.setCaptureConsoleErrors(true)` routes every `console.error(...)`
 *      call into the buffer with `source: 'console.error'`.
 *
 * They map 1:1 to the three describe-blocks below.
 *
 * Pattern matches `dev/app-eval/__tests__/*.spec.ts` — bun:test, ESM,
 * no test runner config required.
 */

import { describe, test, expect, beforeEach } from 'bun:test';

import { createConsoleAPI } from '../src/console/api';
import { EventStore } from '../src/event-store';
import { ActorRecorder } from '../src/recorders/actor-recorder';
import { wrapBridgeForDevTools } from '../../../kernel/src/context/bridge-devtools-wrapper';
import { withHandlerErrors } from '../../../apps/spreadsheet/src/devtools/handler-error-boundary';
import type { DevToolsConsoleAPI } from '../src/types';

// ── Test harness: a minimal `window.__dt` + `window.__OS_DEVTOOLS__` ──

/**
 * Build a console API instance and install it on `globalThis.window` so the
 * production code paths under test (which reach `window.__dt` and
 * `window.__OS_DEVTOOLS__`) see a real implementation.
 */
function setupRuntime(): { api: DevToolsConsoleAPI; cleanup: () => void } {
  // Polyfill enough of `window` so the production code paths pass their
  // `typeof window !== 'undefined'` guards. Bun's runtime doesn't ship a
  // DOM, so we wire `addEventListener` to a no-op (the listeners are
  // exercised by the `__dt.captureError` and `setCaptureConsoleErrors`
  // paths under test, not by the global `unhandledrejection` /
  // `error` listeners which have no analogue in bun anyway).
  const g = globalThis as { window?: Record<string, unknown> };
  const listeners: Record<string, Array<(ev: unknown) => void>> = {};
  g.window = {
    addEventListener: (name: string, handler: (ev: unknown) => void) => {
      (listeners[name] ??= []).push(handler);
    },
    removeEventListener: () => {},
    // Tests dispatch synthetic events via this helper.
    __dispatchEvent: (name: string, ev: unknown) => {
      for (const h of listeners[name] ?? []) h(ev);
    },
  };

  const store = new EventStore();
  store.enable();
  const actorRecorder = new ActorRecorder(store);
  const api = createConsoleAPI(store, actorRecorder);

  // Provide a minimal __OS_DEVTOOLS__ hook so wrapBridgeForDevTools doesn't
  // short-circuit to the unwrapped bridge.
  (g.window as Record<string, unknown>).__OS_DEVTOOLS__ = {
    reportBridgeCall: () => {},
  };
  (g.window as Record<string, unknown>).__dt = api;

  return {
    api,
    cleanup: () => {
      // Restore in case console.error was hooked.
      api.setCaptureConsoleErrors(false);
      api.clearErrors();
      delete g.window;
    },
  };
}

describe('O-A · withHandlerErrors → handler:<NAME>', () => {
  let runtime: ReturnType<typeof setupRuntime>;
  beforeEach(() => {
    runtime = setupRuntime();
  });

  test('captures thrown error with source handler:<NAME> and re-throws', async () => {
    const boom = new Error('handler exploded');
    let caught: unknown = null;
    try {
      await withHandlerErrors('CLEAR_CONTENTS', () => {
        throw boom;
      });
    } catch (err) {
      caught = err;
    } finally {
      // Re-throw contract: caller still sees the original error.
      expect(caught).toBe(boom);
    }

    const errors = runtime.api.getRecentErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe('handler:CLEAR_CONTENTS');
    expect(errors[0].error).toBe('handler exploded');
    expect(errors[0].stack).toBeTruthy();
    runtime.cleanup();
  });

  test('captures async rejection with source handler:<NAME> and re-throws', async () => {
    const boom = new Error('async handler exploded');
    let caught: unknown = null;
    try {
      await withHandlerErrors('PASTE', async () => {
        await Promise.resolve();
        throw boom;
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(boom);

    const errors = runtime.api.getRecentErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe('handler:PASTE');
    runtime.cleanup();
  });

  test('happy path returns the function value without touching the buffer', async () => {
    const result = await withHandlerErrors('UNDO', async () => 42);
    expect(result).toBe(42);
    expect(runtime.api.getRecentErrors()).toHaveLength(0);
    runtime.cleanup();
  });
});

describe('O-A · wrapBridgeForDevTools → bridge:<methodName>', () => {
  let runtime: ReturnType<typeof setupRuntime>;
  beforeEach(() => {
    runtime = setupRuntime();
  });

  test('async-rejection bridge call buffers AND re-throws', async () => {
    const boom = new Error('bridge async failure');
    const rawBridge = {
      async setCells(): Promise<never> {
        throw boom;
      },
    };
    const wrapped = wrapBridgeForDevTools(rawBridge, 'compute');

    let caught: unknown = null;
    try {
      await wrapped.setCells();
    } catch (err) {
      caught = err;
    }
    // Contract clause 2: re-thrown
    expect(caught).toBe(boom);

    // Contract clause 1: buffered with source `bridge:<methodName>`
    const errors = runtime.api.getRecentErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe('bridge:setCells');
    expect(errors[0].error).toBe('bridge async failure');
    runtime.cleanup();
  });

  test('sync-throw bridge call buffers AND re-throws', () => {
    const boom = new Error('bridge sync failure');
    const rawBridge = {
      getViewportBuffer(): never {
        throw boom;
      },
    };
    const wrapped = wrapBridgeForDevTools(rawBridge, 'compute');

    let caught: unknown = null;
    try {
      wrapped.getViewportBuffer();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(boom);

    const errors = runtime.api.getRecentErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe('bridge:getViewportBuffer');
    runtime.cleanup();
  });

  test('successful bridge call leaves the error buffer empty', async () => {
    const wrapped = wrapBridgeForDevTools(
      {
        async getResolvedFormat(): Promise<string> {
          return 'fmt';
        },
      },
      'compute',
    );
    const out = await wrapped.getResolvedFormat();
    expect(out).toBe('fmt');
    expect(runtime.api.getRecentErrors()).toHaveLength(0);
    runtime.cleanup();
  });
});

describe('O-A · setCaptureConsoleErrors → console.error', () => {
  let runtime: ReturnType<typeof setupRuntime>;
  beforeEach(() => {
    runtime = setupRuntime();
  });

  test('console.error is buffered with source console.error after enable', () => {
    // Stash so tests don't pollute the bun test reporter.
    const origError = console.error;
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    console.error = (() => {}) as typeof console.error;
    try {
      runtime.api.setCaptureConsoleErrors(true);
      console.error('something went wrong', 42);
      const errors = runtime.api.getRecentErrors();
      expect(errors.length).toBeGreaterThanOrEqual(1);
      const last = errors[errors.length - 1];
      expect(last.source).toBe('console.error');
      expect(last.error).toContain('something went wrong');
    } finally {
      runtime.api.setCaptureConsoleErrors(false);
      console.error = origError;
    }
    runtime.cleanup();
  });

  test('Error first-arg is unwrapped — stack preserved', () => {
    const origError = console.error;
    console.error = (() => {}) as typeof console.error;
    try {
      runtime.api.setCaptureConsoleErrors(true);
      console.error(new Error('typed error'));
      const errors = runtime.api.getRecentErrors();
      const last = errors[errors.length - 1];
      expect(last.source).toBe('console.error');
      expect(last.error).toBe('typed error');
      expect(last.stack).toBeTruthy();
    } finally {
      runtime.api.setCaptureConsoleErrors(false);
      console.error = origError;
    }
    runtime.cleanup();
  });

  test('disable restores the original console.error and stops capture', () => {
    const origError = console.error;
    console.error = (() => {}) as typeof console.error;
    try {
      runtime.api.setCaptureConsoleErrors(true);
      runtime.api.setCaptureConsoleErrors(false);
      runtime.api.clearErrors();
      console.error('post-disable message');
      expect(runtime.api.getRecentErrors()).toHaveLength(0);
    } finally {
      console.error = origError;
    }
    runtime.cleanup();
  });
});
