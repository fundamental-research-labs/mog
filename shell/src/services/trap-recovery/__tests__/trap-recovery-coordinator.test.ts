/**
 * trap-recovery-coordinator.test.ts
 *
 *
 * Drives the coordinator with a mock DocumentManager + mock
 * DocumentHandles whose `_trapRecovery` surfaces are fakes. The
 * coordinator's contract:
 *
 *   1. Subscribes to DocumentManager and attaches `onTrap` to every
 *      open doc as it appears.
 *   2. On the FIRST trap observed in any doc:
 *      a. Marks every open doc trapped via `sendTrap` (originating +
 *         siblings).
 *      b. Surfaces the trap to DocumentManager.errors via setError.
 *      c. Calls `resetWasmModule()` (verified via the test seam).
 *      d. Calls `recover()` on every doc EXCEPT the originating one.
 *      e. Clears DocumentManager.errors for siblings that recovered.
 *   3. After recovery has run once, additional trap notifications log
 *      and drop (the "exhausted" guard) — no second recovery loop.
 *   4. Concurrent trap observations from sibling docs coalesce onto
 *      the first in-flight recovery; `recover()` runs once.
 */

import { jest } from '@jest/globals';
import type { DocumentHandleInternal } from '@mog-sdk/kernel/internal';

// Avoid pulling the full @mog/transport surface (napi-loader's
// `import.meta.url` breaks Jest's CJS transform). The coordinator
// imports `resetWasmModule` from `@mog/transport` as the default for
// its options seam — tests override that seam, but the import still
// has to resolve. Mock the module so the CJS transformer doesn't
// stumble on napi-loader.
jest.mock('@mog/transport', () => {
  /** Local TrapError-shape used by the test fixtures only. */
  class TrapError extends Error {
    readonly isTrap = true as const;
    constructor(
      public readonly command: string,
      trapMessage: string,
      options?: { cause?: unknown },
    ) {
      super(`[${command}] WASM trap during ${command}: ${trapMessage}`, options);
      this.name = 'TrapError';
    }
  }
  return {
    TrapError,
    resetWasmModule: () => {
      throw new Error(
        'resetWasmModule should be overridden by the test seam — see options.resetWasmModule',
      );
    },
  };
});

// `TrapError` is a type-only import in production, but tests need a
// concrete constructor. Pull it from the mock at runtime. The cast to
// `any` is local-only — we just need a class whose instances have the
// `isTrap` discriminator, which the mock's TrapError above provides.
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
const TrapError: any = (require('@mog/transport') as { TrapError: unknown }).TrapError;

import type { DocumentManager } from '../../document/document-manager';
import type {
  DocumentManagerListener,
  DocumentManagerState,
  Unsubscribe,
} from '../../document/types';
import { TrapRecoveryCoordinator } from '../trap-recovery-coordinator';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeDocumentHandleControls {
  /** Trigger the trap listener registered via `onTrap`. */
  fireTrap(trap: TrapError): void;
  /** Spy: how many times `sendTrap` was called on this handle. */
  readonly sendTrapCount: number;
  /** Spy: trap argument(s) passed to `sendTrap`. */
  readonly sentTraps: ReadonlyArray<TrapError>;
  /** Spy: how many times `recover` was called on this handle. */
  readonly recoverCount: number;
  /** Toggle: when true, `recover()` rejects with the supplied error. */
  setRecoverFails(error: Error | null): void;
}

function makeFakeHandle(fileId: string): {
  handle: DocumentHandleInternal;
  controls: FakeDocumentHandleControls;
} {
  const trapListeners = new Set<(trap: TrapError) => void>();
  const sentTraps: TrapError[] = [];
  let recoverCount = 0;
  let recoverFails: Error | null = null;

  const handle = {
    documentId: fileId,
    initialSheetId: 'sheet-1' as DocumentHandleInternal['initialSheetId'],
    context: {} as DocumentHandleInternal['context'],
    isDisposed: false,
    flushSync: () => {},
    pendingUpdatesCount: 0,
    hasFlushFailed: false,
    hasAppendActive: false,
    dispose: () => {},
    [Symbol.asyncDispose]: async () => {},
    workbook: async () => ({}) as never,
    _trapRecovery: {
      onTrap(listener: (trap: TrapError) => void): () => void {
        trapListeners.add(listener);
        return () => {
          trapListeners.delete(listener);
        };
      },
      sendTrap(trap: TrapError): void {
        sentTraps.push(trap);
      },
      async recover(_yrsState?: Uint8Array): Promise<void> {
        recoverCount += 1;
        if (recoverFails) throw recoverFails;
      },
    },
  } as unknown as DocumentHandleInternal;

  const controls: FakeDocumentHandleControls = {
    fireTrap(trap: TrapError): void {
      // Snapshot listeners before firing so that listener-fired
      // unsubscribes don't affect the dispatch list.
      for (const listener of Array.from(trapListeners)) listener(trap);
    },
    get sendTrapCount() {
      return sentTraps.length;
    },
    get sentTraps() {
      return sentTraps;
    },
    get recoverCount() {
      return recoverCount;
    },
    setRecoverFails(error: Error | null): void {
      recoverFails = error;
    },
  };

  return { handle, controls };
}

interface FakeDocumentManager extends DocumentManager {
  /** Test-only: add a doc to the manager and notify subscribers. */
  __addDoc(fileId: string, handle: DocumentHandle): void;
  /** Test-only: most-recent setError(fileId) → error map. */
  readonly __errors: ReadonlyMap<string, Error>;
}

function makeFakeManager(): FakeDocumentManager {
  const docs = new Map<string, DocumentHandle>();
  const listeners = new Set<DocumentManagerListener>();
  const errors = new Map<string, Error>();
  const loadingStates = new Map<string, ReturnType<DocumentManager['getLoadingState']>>();

  const getState = (): DocumentManagerState => ({
    documents: new Map(docs),
    loadingStates: new Map(loadingStates),
    errors: new Map(errors),
  });

  const notify = (): void => {
    const state = getState();
    listeners.forEach((listener) => listener(state));
  };

  return {
    async loadDocument(): Promise<DocumentHandle> {
      throw new Error('not implemented in fake');
    },
    async createDocument(): Promise<DocumentHandle> {
      throw new Error('not implemented in fake');
    },
    getDocument(fileId: string): DocumentHandle | null {
      return docs.get(fileId) ?? null;
    },
    async disposeDocument(fileId: string): Promise<void> {
      docs.delete(fileId);
      errors.delete(fileId);
      loadingStates.delete(fileId);
      notify();
    },
    async disposeAll(): Promise<void> {
      docs.clear();
      errors.clear();
      loadingStates.clear();
      notify();
    },
    getLoadingState(fileId: string) {
      return loadingStates.get(fileId) ?? 'idle';
    },
    getError(fileId: string): Error | null {
      return errors.get(fileId) ?? null;
    },
    getOpenFileIds(): string[] {
      return Array.from(docs.keys());
    },
    subscribe(listener: DocumentManagerListener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState,
    setError(fileId: string, error: Error): void {
      errors.set(fileId, error);
      loadingStates.set(fileId, 'error');
      notify();
    },
    clearError(fileId: string): void {
      if (!errors.has(fileId)) return;
      errors.delete(fileId);
      loadingStates.set(fileId, docs.has(fileId) ? 'loaded' : 'idle');
      notify();
    },
    __addDoc(fileId: string, handle: DocumentHandle): void {
      docs.set(fileId, handle);
      loadingStates.set(fileId, 'loaded');
      notify();
    },
    get __errors(): ReadonlyMap<string, Error> {
      return errors;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TrapRecoveryCoordinator ', () => {
  function makeTrap(message = 'unreachable'): TrapError {
    return new TrapError('compute_recalc', message);
  }

  describe('listener attachment', () => {
    it('attaches an onTrap listener to docs that already exist at construction', () => {
      const mgr = makeFakeManager();
      const { handle: hA, controls: cA } = makeFakeHandle('A');
      mgr.__addDoc('A', hA);

      const reset = jest.fn();
      new TrapRecoveryCoordinator(mgr, { resetWasmModule: reset });

      // Firing the trap should hit the coordinator and trigger setError.
      cA.fireTrap(makeTrap());
      // Microtask flush so the async `recover` flow lands setError calls.
      return Promise.resolve().then(() => {
        expect(mgr.__errors.has('A')).toBe(true);
      });
    });

    it('attaches to docs added AFTER construction via subscribe()', async () => {
      const mgr = makeFakeManager();
      const reset = jest.fn();
      new TrapRecoveryCoordinator(mgr, { resetWasmModule: reset });

      const { handle: hB, controls: cB } = makeFakeHandle('B');
      mgr.__addDoc('B', hB); // notifies the coordinator's subscribe callback

      cB.fireTrap(makeTrap());
      await Promise.resolve();
      await Promise.resolve();
      expect(reset).toHaveBeenCalledTimes(1);
    });

    it('does not double-attach to the same fileId across multiple subscribe fires', async () => {
      const mgr = makeFakeManager();
      const reset = jest.fn();
      new TrapRecoveryCoordinator(mgr, { resetWasmModule: reset });

      const { handle: hC, controls: cC } = makeFakeHandle('C');
      mgr.__addDoc('C', hC);
      // Fire subscribe a few more times by adding then removing other docs.
      const { handle: hD } = makeFakeHandle('D');
      mgr.__addDoc('D', hD);
      mgr.disposeDocument('D');
      mgr.__addDoc('D', hD);

      cC.fireTrap(makeTrap());
      await Promise.resolve();
      await Promise.resolve();

      // The coordinator marked C trapped (originating). It also called
      // setError once per open doc — C and D — verifying no listener
      // double-attachment caused duplicate sendTrap dispatch on C.
      expect(cC.sendTrapCount).toBe(1);
    });
  });

  describe('one trap → one recovery', () => {
    it('marks every open doc trapped and recovers all but the originating one', async () => {
      const mgr = makeFakeManager();
      const { handle: hA, controls: cA } = makeFakeHandle('A');
      const { handle: hB, controls: cB } = makeFakeHandle('B');
      const { handle: hC, controls: cC } = makeFakeHandle('C');
      mgr.__addDoc('A', hA);
      mgr.__addDoc('B', hB);
      mgr.__addDoc('C', hC);

      const reset = jest.fn();
      new TrapRecoveryCoordinator(mgr, { resetWasmModule: reset });

      const trap = makeTrap();
      cA.fireTrap(trap);
      // Drain microtasks for the async recovery flow.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Every doc was marked trapped (originating + siblings).
      expect(cA.sendTrapCount).toBe(1);
      expect(cB.sendTrapCount).toBe(1);
      expect(cC.sendTrapCount).toBe(1);
      // Reset fired exactly once.
      expect(reset).toHaveBeenCalledTimes(1);
      // Recovery skips the originating doc.
      expect(cA.recoverCount).toBe(0);
      expect(cB.recoverCount).toBe(1);
      expect(cC.recoverCount).toBe(1);
    });

    it('surfaces the trap to DocumentManager.setError for every open doc', async () => {
      const mgr = makeFakeManager();
      const { handle: hA, controls: cA } = makeFakeHandle('A');
      const { handle: hB } = makeFakeHandle('B');
      mgr.__addDoc('A', hA);
      mgr.__addDoc('B', hB);

      new TrapRecoveryCoordinator(mgr, { resetWasmModule: jest.fn() });

      const trap = makeTrap('memory access out of bounds');
      cA.fireTrap(trap);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Originating stays in error; sibling B recovered → cleared.
      expect(mgr.__errors.get('A')).toBe(trap);
      expect(mgr.__errors.has('B')).toBe(false);
    });

    it('keeps a sibling in error if its recover() rejects', async () => {
      const mgr = makeFakeManager();
      const { handle: hA, controls: cA } = makeFakeHandle('A');
      const { handle: hB, controls: cB } = makeFakeHandle('B');
      mgr.__addDoc('A', hA);
      mgr.__addDoc('B', hB);

      const recoverFailure = new Error('fresh wasm also OOMs on B');
      cB.setRecoverFails(recoverFailure);

      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        new TrapRecoveryCoordinator(mgr, { resetWasmModule: jest.fn() });

        cA.fireTrap(makeTrap());
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // B failed to recover — its error stays in the map.
        expect(mgr.__errors.has('B')).toBe(true);
        // The failure was logged.
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('sibling B failed to recover'),
          recoverFailure,
        );
      } finally {
        consoleError.mockRestore();
      }
    });
  });

  describe('concurrency / coalescing', () => {
    it('coalesces concurrent traps from multiple sibling docs into one recovery', async () => {
      const mgr = makeFakeManager();
      const { handle: hA, controls: cA } = makeFakeHandle('A');
      const { handle: hB, controls: cB } = makeFakeHandle('B');
      const { handle: hC, controls: cC } = makeFakeHandle('C');
      mgr.__addDoc('A', hA);
      mgr.__addDoc('B', hB);
      mgr.__addDoc('C', hC);

      const reset = jest.fn();
      new TrapRecoveryCoordinator(mgr, { resetWasmModule: reset });

      // Synchronous burst — all three docs observe the trap on the same
      // tick. Real-world cause: WASM dies, every per-doc security-event
      // drain re-fires together at the next 50ms tick.
      const trap = makeTrap();
      cA.fireTrap(trap);
      cB.fireTrap(trap);
      cC.fireTrap(trap);

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Reset and recover ran ONCE total, not once-per-fire.
      expect(reset).toHaveBeenCalledTimes(1);
      // Each non-originating handle recovered exactly once. A & B & C
      // all fired the trap; A is "originating" (first), B and C are
      // siblings. That's 2 recover calls total.
      expect(cA.recoverCount + cB.recoverCount + cC.recoverCount).toBe(2);
    });
  });

  describe('exhaustion (one recovery per page lifecycle)', () => {
    it('drops further trap notifications after a recovery has completed', async () => {
      const mgr = makeFakeManager();
      const { handle: hA, controls: cA } = makeFakeHandle('A');
      const { handle: hB } = makeFakeHandle('B');
      mgr.__addDoc('A', hA);
      mgr.__addDoc('B', hB);

      const reset = jest.fn();
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        new TrapRecoveryCoordinator(mgr, { resetWasmModule: reset });

        cA.fireTrap(makeTrap());
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(reset).toHaveBeenCalledTimes(1);

        // Simulate a SECOND trap firing later (e.g. the recovered doc
        // itself starts trapping on the fresh WASM).
        cA.fireTrap(makeTrap('memory access out of bounds'));
        await Promise.resolve();
        await Promise.resolve();

        // Reset must NOT fire again. Loud log warning is expected.
        expect(reset).toHaveBeenCalledTimes(1);
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('refusing to loop'),
          expect.objectContaining({ originatingFileId: 'A' }),
        );
      } finally {
        consoleError.mockRestore();
      }
    });
  });

  describe('disposal', () => {
    it('detaches subscriptions and listeners on dispose()', async () => {
      const mgr = makeFakeManager();
      const { handle: hA, controls: cA } = makeFakeHandle('A');
      mgr.__addDoc('A', hA);

      const reset = jest.fn();
      const coord = new TrapRecoveryCoordinator(mgr, { resetWasmModule: reset });
      coord.dispose();

      // After disposal, a trap should not trigger recovery.
      cA.fireTrap(makeTrap());
      await Promise.resolve();
      await Promise.resolve();
      expect(reset).not.toHaveBeenCalled();
    });

    it('dispose is idempotent', () => {
      const mgr = makeFakeManager();
      const coord = new TrapRecoveryCoordinator(mgr, { resetWasmModule: jest.fn() });
      expect(() => {
        coord.dispose();
        coord.dispose();
        coord.dispose();
      }).not.toThrow();
    });
  });
});
