/**
 * trap-recovery-integration.test.ts
 *
 *
 * End-to-end integration test for the cascade-isolation property. Where
 * the per-track tests cover one layer in isolation
 * (`trap-error.test.ts` → wasm-trap classifier; `synthetic-trap.test.ts` →
 * synthetic trap fixture; `trap-recovery.test.ts` → ComputeCore self-mark;
 * `trap-recovery-coordinator.test.ts` → coordinator with mock
 * handles), this file wires every layer together and asserts the
 * production-shaped behavior:
 *
 *   transport-factory (synthetic trap mock or classifier-wrapped WasmModule)
 *     → wasm-transport classifier
 *     → ComputeCore auto-mark wrapper + onTrap fan-out
 *     → handle._trapRecovery.{onTrap,sendTrap,recover} (kernel API)
 *     → TrapRecoveryCoordinator
 *     → DocumentManager (real) state surfacing
 *
 * What this catches that the per-track tests don't:
 *   - The DocumentHandle's `_trapRecovery.onTrap` actually delegates to
 *     a real ComputeCore.onTrap (not a fake), so a regression that
 *     swaps `handle._trapRecovery` for a stub that doesn't propagate
 *     would fail here.
 *   - The coordinator's `inFlight` mechanism actually coalesces traps
 *     observed across multiple ComputeCores at the same tick.
 *   - The exhausted guard actually prevents a second recovery loop
 *     when a recovered (or new) doc traps again.
 *   - The coordinator's `attachToReadyDocs` re-fires on subscribe so
 *     a doc loaded AFTER the recovery still gets its onTrap listener.
 *
 * Why the synthetic-trap fixture: traps from `WebAssembly.RuntimeError`
 * are the production source of truth, and the wasm-trap classifier is the
 * load-bearing surface (a regression there silently turns every trap
 * into a generic TransportError and the recovery flow never fires).
 * Using the synthetic-trap mock transport lets us inject a
 * real `WebAssembly.RuntimeError` into the same `createWasmTransport`
 * pipeline production uses.
 *
 * IMPORTANT: We mock `@mog/transport` to (a) provide our own spy
 * `resetWasmModule`, and (b) sidestep `napi-loader.ts`'s
 * `import.meta.url` (Jest's CJS transform stumbles on it). The mock
 * re-uses the real `TrapError` / `TransportError` / `createWasmTransport`
 * implementations imported from their underlying source modules so
 * the wiring under test is genuine.
 */
import { jest } from '@jest/globals';

// jsdom provides `window`, but a few kernel paths fence on
// `typeof window === 'undefined'` and ComputeCore's actor inspect
// references `window.__OS_DEVTOOLS__`. The stub keeps those happy.
(globalThis as unknown as { window?: unknown }).window =
  (globalThis as unknown as { window?: unknown }).window ?? {};

// jsdom in some Node versions doesn't expose TextEncoder/TextDecoder on
// the test global scope, but kernel/src/bridges/wire/palette-binary.ts
// (transitively imported via compute-core) instantiates one at module
// load. Bridge from Node's built-in `util` if missing.
if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const util = require('node:util') as {
    TextEncoder: typeof TextEncoder;
    TextDecoder: typeof TextDecoder;
  };
  (globalThis as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = util.TextEncoder;
  (globalThis as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = util.TextDecoder;
}

// ---------------------------------------------------------------------------
// `@mog/transport` mock — re-uses real classifier + error classes
// ---------------------------------------------------------------------------
//
// The real `@mog/transport` index pulls in `napi-loader.ts` which calls
// `createRequire(import.meta.url)`. ts-jest's CJS transform doesn't
// support `import.meta.url`, so even unrelated tests that import
// `@mog/transport` fail at module-eval time. We sidestep the problem by
// mocking the package and re-exporting the actually-load-bearing
// surfaces from their underlying source files (which don't touch
// napi-loader). This keeps the *classifier* and *TrapError class* under
// test for real — only `resetWasmModule` is replaced with a spy.
jest.mock('@mog/transport', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const errorsMod =
    require('../../../../../infra/transport/src/errors') as typeof import('../../../../../infra/transport/src/errors');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const wasmTransportMod =
    require('../../../../../infra/transport/src/wasm-transport') as typeof import('../../../../../infra/transport/src/wasm-transport');

  return {
    TrapError: errorsMod.TrapError,
    TransportError: errorsMod.TransportError,
    AddonNotFoundError: errorsMod.AddonNotFoundError,
    createWasmTransport: wasmTransportMod.createWasmTransport,
    // No-op spy. ComputeCore.markModuleTrapped() calls resetWasmModule()
    // directly (eagerly, to close the window before the coordinator's
    // async recovery runs). That call goes through this mock. The
    // coordinator also calls it via its own seam (options.resetWasmModule),
    // which per-test overrides verify. Both calls are idempotent — nulling
    // the same singleton ref twice is fine. Using jest.fn() here lets the
    // ComputeCore-side call succeed without the test having to track it.
    resetWasmModule: jest.fn(),
  };
});

// `@mog/env` reads `typeof import.meta !== 'undefined'` to decide
// whether the Vite-injected env object is available. ts-jest's CJS
// transform doesn't accept `import.meta` as a syntactic form even with
// `useESM: true` for some module-resolution paths. Mocking the env package
// avoids the parse error.
jest.mock('@mog/env', () => ({
  isDev: () => false,
  isProd: () => false,
  isTest: () => true,
  getEnvVar: (_name: string) => undefined,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const transportMod = require('@mog/transport') as typeof import('@mog/transport');
const { TrapError, createWasmTransport } = transportMod;
type TrapErrorT = InstanceType<typeof TrapError>;

import type { BridgeTransport } from '@rust-bridge/client';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type { DocumentHandle } from '@mog-sdk/kernel';
import type { DocumentHandleInternal } from '@mog-sdk/kernel/internal';
import { ComputeCore } from '@mog-sdk/kernel/internal';

import { createDocumentManager } from '../../document/create-document-manager';
import { TrapRecoveryCoordinator } from '../trap-recovery-coordinator';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Make a minimal IKernelContext suitable for ComputeCore construction.
 * Mirrors the kernel-side trap recovery test (`makeMockContext`).
 */
function makeMockContext(): IKernelContext {
  return {
    eventBus: {
      emit: () => {},
      on: () => () => {},
      off: () => {},
    },
    setPendingUndoDescription: () => {},
    getPendingUndoDescription: () => null,
    clearPendingUndoDescription: () => {},
    destroy: () => {},
  } as unknown as IKernelContext;
}

/**
 * Build a `WasmModule` whose every export throws a real
 * `WebAssembly.RuntimeError` with `message = trapMessage`. Feeding this
 * through `createWasmTransport` exercises the wasm-trap classifier: a thrown
 * `RuntimeError` with a known trap message becomes `TrapError` at the
 * transport boundary.
 */
function makeTrappingWasmModule(
  trapMessage: string,
): import('../../../../../infra/transport/src/types').WasmModule {
  // The transport invokes by name and supplies positional args. The
  // function below ignores both and just throws.
  return new Proxy(
    {},
    {
      get() {
        return () => {
          throw new WebAssembly.RuntimeError(trapMessage);
        };
      },
    },
  ) as import('../../../../../infra/transport/src/types').WasmModule;
}

/**
 * Build a `WasmModule` that returns a fixed value for every command.
 * Used for healthy doc setup before injecting a trap on demand.
 */
function makeNoopWasmModule(
  value: unknown = undefined,
): import('../../../../../infra/transport/src/types').WasmModule {
  return new Proxy(
    {},
    {
      get() {
        return () => value;
      },
    },
  ) as import('../../../../../infra/transport/src/types').WasmModule;
}

/**
 * Module-state container — flips between a no-op and trapping module
 * via `getModule()`. The transport calls `getModule()` on every
 * `.call(...)`, so swapping the slot mid-flight changes the next call's
 * behavior. Mirrors how the production `wasm-loader` singleton swaps
 * out the module after `resetWasmModule()`.
 */
interface ModuleSlot {
  current: import('../../../../../infra/transport/src/types').WasmModule;
}

/**
 * Build a real `BridgeTransport` from `createWasmTransport` against a
 * mutable module slot. The transport classifier  runs on each
 * call, so a swap from `noop` to `trapping` flips behavior at the next
 * `.call(...)`.
 */
function buildTransport(slot: ModuleSlot): BridgeTransport {
  return createWasmTransport(() => slot.current);
}

/**
 * Build a DocumentHandle-shaped stub backed by a real ComputeCore.
 *
 * The stub delegates the trap-recovery surface (`onTrap`, `sendTrap`,
 * `recover`) through the real ComputeCore's listener machinery — so a
 * trap that propagates from the transport classifier through the
 * core's auto-mark wrapper fires the coordinator's `onTrap` listener
 * exactly as it would in production.
 *
 * We don't construct a full `DocumentLifecycleSystem` — that would
 * require WASM module loading via `createTransport()`. Instead the
 * `recover` callback fires `onRecover` so the test can verify the
 * coordinator dispatches RECOVER (the lifecycle-machine RECOVER → ready
 * transition is covered by the kernel-side machine tests).
 */
interface FakeHandleControls {
  /** The underlying ComputeCore (for poking `markModuleTrapped` directly). */
  readonly core: ComputeCore;
  /** Module slot — swap to inject traps mid-test. */
  readonly slot: ModuleSlot;
  /** How many times `recover()` was called by the coordinator. */
  readonly recoverCallCount: number;
  /** Toggle to make `recover()` reject. */
  setRecoverFails(error: Error | null): void;
}

function makeFakeHandle(
  fileId: string,
  initialModule: 'noop' | { trapMessage: string } = 'noop',
): { handle: DocumentHandleInternal; controls: FakeHandleControls } {
  const slot: ModuleSlot = {
    current:
      initialModule === 'noop'
        ? makeNoopWasmModule()
        : makeTrappingWasmModule(initialModule.trapMessage),
  };
  const transport = buildTransport(slot);
  const core = new ComputeCore(makeMockContext(), fileId, transport);

  let recoverCallCount = 0;
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
      onTrap: (listener: (trap: TrapErrorT) => void): (() => void) => {
        return core.onTrap(listener);
      },
      sendTrap: (trap: TrapErrorT): void => {
        core.markModuleTrapped(trap);
      },
      recover: async (_yrsState?: Uint8Array): Promise<void> => {
        recoverCallCount += 1;
        if (recoverFails) throw recoverFails;
        // Production recovery: re-create the bridge against the fresh
        // WASM. We model it by swapping the slot back to a no-op
        // module — the coordinator's `resetWasmModule()` having "fixed"
        // the underlying instance. Subsequent calls would succeed.
        slot.current = makeNoopWasmModule();
      },
    },
  } as unknown as DocumentHandleInternal;

  const controls: FakeHandleControls = {
    core,
    slot,
    get recoverCallCount() {
      return recoverCallCount;
    },
    setRecoverFails(error: Error | null) {
      recoverFails = error;
    },
  };

  return { handle, controls };
}

/**
 * Drain microtasks. `core.transport.call()` is async via the wrapper;
 * the `onTrap` listener fires synchronously inside the catch branch,
 * but the coordinator's `recover()` chain runs across several ticks.
 */
async function flushMicrotasks(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TrapRecoveryCoordinator integration', () => {
  describe('Scenario 1: one trapping doc, two healthy siblings', () => {
    it('isolates the trap to docA; recovers docB and docC; resets WASM exactly once', async () => {
      // Three docs. Doc A's transport will fire a real
      // WebAssembly.RuntimeError on its first call. B and C are healthy.
      const { handle: hA, controls: cA } = makeFakeHandle('A', {
        trapMessage: 'unreachable',
      });
      const { handle: hB, controls: cB } = makeFakeHandle('B');
      const { handle: hC, controls: cC } = makeFakeHandle('C');

      // Real DocumentManager. We bypass the network/WASM-bound
      // loadDocument/createDocument paths and inject the handle into the
      // private state via the loadingPromises trick: invoke
      // `createDocument` and intercept the load → instead, we use a
      // shell-internal test seam by reaching into the manager state
      // through the listener hook (the manager's contract surfaces
      // documents via getDocument). The simplest approach is
      // to use an EXTENDED manager that lets tests inject handles.
      //
      // The real `createDocumentManager` doesn't expose injection. To
      // keep this an integration test, we wrap it: the wrapper exposes
      // an `__addDoc` for the test (production has loadDocument /
      // createDocument).
      const mgr = wrapManagerWithInjection(createDocumentManager());

      mgr.__addDoc('A', hA);
      mgr.__addDoc('B', hB);
      mgr.__addDoc('C', hC);

      const reset = jest.fn();
      const coord = new TrapRecoveryCoordinator(mgr, {
        resetWasmModule: reset,
      });

      // Fire a real call against doc A's transport. The classifier
      //  wraps the RuntimeError as TrapError, the auto-marker
      //  flips `core.isModuleTrapped`, the onTrap listener fires,
      // and the coordinator runs.
      await expect(cA.core.transport.call('compute_recalc', { docId: 'A' })).rejects.toBeInstanceOf(
        TrapError,
      );

      await flushMicrotasks();

      // Doc A is trapped — the auto-marker wired by ComputeCore did
      // its job.
      expect(cA.core.isModuleTrapped).toBe(true);
      expect(cA.core.trapError).toBeInstanceOf(TrapError);

      // The coordinator marked B and C trapped via sendTrap (sibling
      // collateral damage from the shared dead WASM).
      expect(cB.core.isModuleTrapped).toBe(true);
      expect(cC.core.isModuleTrapped).toBe(true);

      // Recovery semantics: A stays in error (we don't replay it —
      // its bytes broke the engine). B and C recover.
      expect(cA.recoverCallCount).toBe(0);
      expect(cB.recoverCallCount).toBe(1);
      expect(cC.recoverCallCount).toBe(1);

      // resetWasmModule fired exactly once across the recovery.
      expect(reset).toHaveBeenCalledTimes(1);

      // Doc A's error stays in DocumentManager.errors. B and C cleared.
      expect(mgr.getError('A')).toBeInstanceOf(TrapError);
      expect(mgr.getError('B')).toBeNull();
      expect(mgr.getError('C')).toBeNull();

      coord.dispose();
    });
  });

  describe('Scenario 2: coalesced concurrent traps', () => {
    it('two docs observing the same dead WASM at the same tick run recovery exactly once', async () => {
      const { handle: hA, controls: cA } = makeFakeHandle('A', {
        trapMessage: 'unreachable',
      });
      const { handle: hB, controls: cB } = makeFakeHandle('B', {
        trapMessage: 'unreachable',
      });
      // Doc C is a healthy sibling that observes neither call directly,
      // but is collateral damage of the shared dead WASM.
      const { handle: hC, controls: cC } = makeFakeHandle('C');

      const mgr = wrapManagerWithInjection(createDocumentManager());
      mgr.__addDoc('A', hA);
      mgr.__addDoc('B', hB);
      mgr.__addDoc('C', hC);

      const reset = jest.fn();
      const coord = new TrapRecoveryCoordinator(mgr, {
        resetWasmModule: reset,
      });

      // Fire calls into A and B concurrently — both observe the trap
      // on the same tick. The classifier wraps both as TrapErrors;
      // both ComputeCores auto-mark; both fire their onTrap listeners.
      // The coordinator's `inFlight` mechanism must coalesce.
      const a = cA.core.transport.call('compute_recalc', { docId: 'A' });
      const b = cB.core.transport.call('compute_recalc', { docId: 'B' });

      await Promise.allSettled([a, b]);
      await flushMicrotasks();

      // resetWasmModule fired exactly ONCE despite two trap observations.
      expect(reset).toHaveBeenCalledTimes(1);

      // Each handle's `recover()` was called at most once. A or B is
      // the originating doc (whichever the coordinator saw first); the
      // other is treated as a sibling and recovered. C is always a
      // sibling.
      const totalRecovers = cA.recoverCallCount + cB.recoverCallCount + cC.recoverCallCount;
      // Two siblings recovered, one originating skipped — so total = 2.
      expect(totalRecovers).toBe(2);
      expect(cC.recoverCallCount).toBe(1);

      coord.dispose();
    });
  });

  describe('Scenario 3: late-loaded doc after recovery', () => {
    it('attaches an onTrap listener to a doc loaded AFTER recovery completed', async () => {
      const { handle: hA, controls: cA } = makeFakeHandle('A', {
        trapMessage: 'unreachable',
      });
      const { handle: hB } = makeFakeHandle('B');

      const mgr = wrapManagerWithInjection(createDocumentManager());
      mgr.__addDoc('A', hA);
      mgr.__addDoc('B', hB);

      const reset = jest.fn();
      const coord = new TrapRecoveryCoordinator(mgr, {
        resetWasmModule: reset,
      });

      // Trip the trap, complete the recovery.
      await expect(cA.core.transport.call('compute_recalc', { docId: 'A' })).rejects.toBeInstanceOf(
        TrapError,
      );
      await flushMicrotasks();
      expect(reset).toHaveBeenCalledTimes(1);

      // Now add a NEW doc post-recovery. The DocumentManager's
      // subscribe fires; the coordinator's `attachToReadyDocs` must
      // pick up the new fileId and wire its onTrap listener (even
      // though the coordinator is exhausted).
      const { handle: hLate, controls: cLate } = makeFakeHandle('Late');
      mgr.__addDoc('Late', hLate);
      await flushMicrotasks();

      // Indirect verification that the listener was attached: register
      // a probe via the same onTrap surface AFTER the coordinator's
      // listener was wired. ComputeCore.onTrap fires listeners in
      // registration order; if the coordinator wasn't attached, our
      // probe would be the only listener, and we'd see the listener
      // count as 1. With the coordinator attached, count >= 2.
      let probeFireCount = 0;
      cLate.core.onTrap(() => {
        probeFireCount += 1;
      });

      // Force-fire a trap on the late-doc's core. The coordinator is
      // exhausted, so its listener won't drive recovery — but the
      // listener WAS attached, so it should fire (and log the
      // exhausted message).
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const lateTrap = new TrapError('compute_late', 'unreachable');
        cLate.core.markModuleTrapped(lateTrap);
        await flushMicrotasks();

        // Our probe fired (listener-list contract).
        expect(probeFireCount).toBe(1);

        // Reset still ran exactly once — the late-doc's trap did NOT
        // re-trigger recovery (exhaustion guard).
        expect(reset).toHaveBeenCalledTimes(1);

        // The exhausted log was emitted, evidence that the coordinator
        // observed the late trap and refused to loop.
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('refusing to loop'),
          expect.objectContaining({ originatingFileId: 'Late' }),
        );
      } finally {
        consoleError.mockRestore();
      }

      coord.dispose();
    });
  });

  describe('Scenario 4: repeat trap after recovery → fail closed', () => {
    it('a NEW trap on a fresh ComputeCore after recovery does not loop', async () => {
      // The coordinator's `exhausted` flag flips at the end of
      // `_recoverImpl`. A trap observed AFTER that flag flips MUST
      // log + drop, not run a second recovery.
      //
      // After recovery the originating doc's old core is still trapped
      // (production replaces the entire bridge). A second trap can only
      // come from a NEW core (or a sibling whose recovery brought up a
      // fresh core that itself trapped on the new WASM). We model that
      // here by adding a NEW doc post-recovery and triggering a trap
      // on its FRESH core.
      const { handle: hA, controls: cA } = makeFakeHandle('A', {
        trapMessage: 'unreachable',
      });
      const { handle: hB, controls: cB } = makeFakeHandle('B');

      const mgr = wrapManagerWithInjection(createDocumentManager());
      mgr.__addDoc('A', hA);
      mgr.__addDoc('B', hB);

      const reset = jest.fn();
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const coord = new TrapRecoveryCoordinator(mgr, {
          resetWasmModule: reset,
        });

        // First trap → first recovery.
        await expect(
          cA.core.transport.call('compute_recalc', { docId: 'A' }),
        ).rejects.toBeInstanceOf(TrapError);
        await flushMicrotasks();
        expect(reset).toHaveBeenCalledTimes(1);
        expect(cB.recoverCallCount).toBe(1);

        // Add a fresh doc whose core will independently trap on its
        // FIRST call. The coordinator's listener attaches to it via
        // the manager's subscribe callback (`attachToReadyDocs`).
        const { handle: hLate, controls: cLate } = makeFakeHandle('Late', {
          trapMessage: 'memory access out of bounds',
        });
        mgr.__addDoc('Late', hLate);
        await flushMicrotasks();

        // Trip the late doc's trap. The coordinator's listener is
        // attached; the trap auto-marks the late core; the listener
        // calls `coord.recover('Late', ...)`, which hits the exhausted
        // guard and logs.
        await expect(
          cLate.core.transport.call('compute_recalc', { docId: 'Late' }),
        ).rejects.toBeInstanceOf(TrapError);
        await flushMicrotasks();

        // Reset must NOT fire a second time.
        expect(reset).toHaveBeenCalledTimes(1);

        // Every doc remains in error after the failed-closed second
        // trap — none was magically recovered.
        expect(cA.recoverCallCount).toBe(0); // originating doc, never recovered
        expect(cLate.recoverCallCount).toBe(0); // exhausted guard fired

        // Loud log proves the coordinator observed the second trap and
        // refused to loop.
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('refusing to loop'),
          expect.objectContaining({ originatingFileId: 'Late' }),
        );

        coord.dispose();
      } finally {
        consoleError.mockRestore();
      }
    });
  });

  describe('Wiring sanity: classifier and auto-marker together', () => {
    it('a real WebAssembly.RuntimeError flows through createWasmTransport → ComputeCore.onTrap', async () => {
      // Tight cross-layer check: the test fixture matches what
      // production hits when wasm32 traps. If the classifier ever
      // regresses to letting RuntimeError through as TransportError,
      // ComputeCore won't auto-mark, and the coordinator will never
      // fire. This test pins the wiring.
      const { controls: cA } = makeFakeHandle('A', {
        trapMessage: 'memory access out of bounds',
      });

      const seen: TrapErrorT[] = [];
      cA.core.onTrap((trap) => {
        seen.push(trap);
      });

      await expect(cA.core.transport.call('compute_init', { docId: 'A' })).rejects.toBeInstanceOf(
        TrapError,
      );

      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeInstanceOf(TrapError);
      expect(seen[0].message).toContain('memory access out of bounds');
      // The trap stored on the core is the same instance passed to the
      // listener — pointer identity proves the auto-mark is using the
      // SAME TrapError it propagated, not a clone.
      expect(seen[0]).toBe(cA.core.trapError);
    });
  });
});

// ---------------------------------------------------------------------------
// Manager-injection helper
// ---------------------------------------------------------------------------

import type { DocumentManager } from '../../document/document-manager';
import type {
  DocumentManagerListener,
  DocumentManagerState,
  Unsubscribe,
} from '../../document/types';

/**
 * Wrap a real `DocumentManager` with a test-only `__addDoc` injection
 * point. Production loads docs via `loadDocument` / `createDocument`
 * (which spin up `DocumentLifecycleSystem` → real WASM); for an
 * integration test we want to drive the coordinator-side flow without
 * the WASM module-loading overhead.
 *
 * The wrapper preserves every public method by delegation (so the
 * coordinator's `subscribe` / `getOpenFileIds` / `getDocument` /
 * `setError` / `clearError` calls hit real implementations) and adds:
 *   - `__addDoc(fileId, handle)` — registers the handle in an internal
 *     map and re-fires manager listeners so the coordinator's
 *     subscribe callback picks it up. We can't reach into the real
 *     manager's private `documents` Map, so we shadow getDocument /
 *     getOpenFileIds with the union of the real manager's state and
 *     ours.
 *
 * This is a test-shim, not a production extension.
 */
interface InjectedManager extends DocumentManager {
  __addDoc(fileId: string, handle: DocumentHandle): void;
}

function wrapManagerWithInjection(real: DocumentManager): InjectedManager {
  const injected = new Map<string, DocumentHandle>();
  const injectedListeners = new Set<DocumentManagerListener>();
  const realUnsub = real.subscribe(() => {
    fireInjectedListeners();
  });
  void realUnsub; // kept for symmetry; manager.disposeAll() handles cleanup

  const fireInjectedListeners = (): void => {
    const state = getState();
    for (const l of injectedListeners) {
      try {
        l(state);
      } catch (err) {
        console.error('[wrap] listener error:', err);
      }
    }
  };

  const errors = new Map<string, Error>();

  const getState = (): DocumentManagerState => {
    const realState = real.getState();
    const documents = new Map(realState.documents);
    for (const [k, v] of injected) documents.set(k, v);
    const allErrors = new Map(realState.errors);
    for (const [k, v] of errors) allErrors.set(k, v);
    return {
      documents,
      loadingStates: realState.loadingStates,
      errors: allErrors,
    };
  };

  const wrapper: InjectedManager = {
    async loadDocument(fileId, source, options) {
      return real.loadDocument(fileId, source, options);
    },
    async createDocument(fileId, options) {
      return real.createDocument(fileId, options);
    },
    getDocument(fileId: string): DocumentHandle | null {
      const i = injected.get(fileId);
      if (i) return i;
      return real.getDocument(fileId);
    },
    async disposeDocument(fileId: string): Promise<void> {
      injected.delete(fileId);
      errors.delete(fileId);
      await real.disposeDocument(fileId);
      fireInjectedListeners();
    },
    async disposeAll(): Promise<void> {
      injected.clear();
      errors.clear();
      await real.disposeAll();
      fireInjectedListeners();
    },
    getLoadingState(fileId: string) {
      return real.getLoadingState(fileId);
    },
    getError(fileId: string): Error | null {
      return errors.get(fileId) ?? real.getError(fileId);
    },
    getOpenFileIds(): string[] {
      const real_ids = real.getOpenFileIds();
      const set = new Set<string>([...real_ids, ...injected.keys()]);
      return Array.from(set);
    },
    subscribe(listener: DocumentManagerListener): Unsubscribe {
      injectedListeners.add(listener);
      // Don't double-subscribe to real — we already do once above and
      // fan out via fireInjectedListeners.
      return () => {
        injectedListeners.delete(listener);
      };
    },
    getState,
    setError(fileId: string, error: Error): void {
      errors.set(fileId, error);
      real.setError(fileId, error);
      fireInjectedListeners();
    },
    clearError(fileId: string): void {
      errors.delete(fileId);
      real.clearError(fileId);
      fireInjectedListeners();
    },
    __addDoc(fileId: string, handle: DocumentHandle): void {
      injected.set(fileId, handle);
      fireInjectedListeners();
    },
  };

  return wrapper;
}
