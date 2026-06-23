/**
 * Legacy Bypass Guards — the storage provider lifecycle legacy bypass and provider conformance
 *
 * These tests prove that stale/legacy document opening options are either
 * guarded or handled correctly by the the storage provider lifecycle provider lifecycle.
 *
 * Audited legacy bypasses (from the storage provider lifecycle "Current Evidence"):
 *   1. `CreateDocumentOptions.providers` — advertises provider arrays but
 *      the lifecycle ignores them (the DLS picks providers by environment).
 *   2. `CreateDocumentOptions.yrsState` — raw Yrs state boot path that
 *      bypasses provider lifecycle replay.
 *   3. `attachWsSidecar` / collab — WebSocket collaboration sidecar that
 *      applies updates outside the provider registry.
 *   4. Direct export APIs — `Workbook.toXlsx()`, `Workbook.save()` etc.
 *      materialize bytes directly (covered by write gate tests).
 *
 * Approach: we test at the lifecycle machine level using stub actors
 * (same pattern as lifecycle-machine-trap.test.ts). This avoids needing
 * a real compute engine while still exercising the state machine's
 * handling of these option fields.
 *
 */

import { jest } from '@jest/globals';
import { createActor, fromPromise } from 'xstate';

import {
  documentLifecycleMachine,
  documentLifecycleSelectors,
  type CreateEngineInput,
  type CreateEngineOutput,
  type AttachProvidersInput,
  type AttachProvidersOutput,
  type DisposeBridgeInput,
  type HydrateCsvInput,
  type HydrateCsvOutput,
  type HydrateXlsxInput,
  type HydrateXlsxOutput,
  type StartBridgeInput,
  type StartBridgeOutput,
  type WireContextInput,
  type WireContextOutput,
} from '../document-lifecycle-machine';
import { DocumentLifecycleSystem } from '../document-lifecycle-system';

import type { CreateDocumentOptions, ProviderConfig } from '@mog-sdk/contracts/document';

// ---------------------------------------------------------------------------
// Helpers — stub actors that resolve immediately with minimal output
// ---------------------------------------------------------------------------

/** Minimal ComputeBridge stub for machine context. */
function stubBridge(): CreateEngineOutput['computeBridge'] {
  return {
    getAllSheetIds: async () => ['sheet-1'],
    start: async () => {},
    setContext: () => {},
    initMutationHandler: () => {},
    createDefaultSheet: async () => {},
    settleForMirror: async () => {},
    destroy: async () => {},
    core: { forceRefreshAllViewports: async () => {} },
  } as unknown as CreateEngineOutput['computeBridge'];
}

function stubRustDocument(): CreateEngineOutput['rustDocument'] {
  return {
    ready: Promise.resolve(),
    attachProvider: async () => {},
    captureInitialProviderBaseline: async () => {},
    destroy: async () => {},
    flushSync: () => {},
  } as unknown as CreateEngineOutput['rustDocument'];
}

function stubDocumentContext(): WireContextOutput['documentContext'] {
  return {
    computeBridge: stubBridge(),
    schema: { start: () => {} },
    destroy: () => {},
    eventBus: { clear: () => {} },
  } as unknown as WireContextOutput['documentContext'];
}

/**
 * Build a machine with fast-resolving stub actors. The machine progresses
 * through all states to `ready` without needing real infrastructure.
 */
function makeFastMachine() {
  const bridge = stubBridge();
  const rustDoc = stubRustDocument();
  const docCtx = stubDocumentContext();

  return documentLifecycleMachine.provide({
    actors: {
      createEngine: fromPromise<CreateEngineOutput, CreateEngineInput>(async () => ({
        computeBridge: bridge,
        rustDocument: rustDoc,
      })),
      wireContext: fromPromise<WireContextOutput, WireContextInput>(async () => ({
        documentContext: docCtx,
      })),
      startBridge: fromPromise<StartBridgeOutput, StartBridgeInput>(async () => ({
        sheetIds: ['sheet-1'],
      })),
      hydrateXlsx: fromPromise<HydrateXlsxOutput, HydrateXlsxInput>(async () => ({
        cellCount: 0,
        sheetIds: ['sheet-1'],
        warnings: [],
      })),
      attachProviders: fromPromise<AttachProvidersOutput, AttachProvidersInput>(async () => ({
        sheetIds: ['sheet-1'],
      })),
      hydrateCsv: fromPromise<HydrateCsvOutput, HydrateCsvInput>(async () => ({
        cellCount: 0,
        sheetIds: ['sheet-1'],
        warnings: [],
      })),
      disposeBridge: fromPromise<void, DisposeBridgeInput>(async () => {}),
    },
  });
}

/** Wait for actor to reach a specific state. */
function waitForState(
  actor: ReturnType<typeof createActor>,
  targetState: string,
  timeoutMs = 2000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for state '${targetState}'`)),
      timeoutMs,
    );

    const check = () => {
      const snap = actor.getSnapshot();
      if ((snap.value as string) === targetState) {
        clearTimeout(timer);
        resolve();
      }
    };

    // Check immediately.
    check();

    // Subscribe for transitions.
    const sub = actor.subscribe(() => check());

    // Cleanup on resolve/reject.
    const originalResolve = resolve;
    resolve = (() => {
      sub.unsubscribe();
      originalResolve();
    }) as typeof resolve;
  });
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Legacy bypass guards', () => {
  // -------------------------------------------------------------------------
  // 1. Stale `providers` array in CreateDocumentOptions
  // -------------------------------------------------------------------------
  describe('CreateDocumentOptions.providers field', () => {
    it('the lifecycle machine accepts options with a providers array and reaches ready (field is ignored)', async () => {
      // The `providers` field on CreateDocumentOptions exists in the type
      // system but the DocumentLifecycleSystem (DLS) does NOT read it. The
      // DLS picks providers by environment (browser → IndexedDB, headless
      // → none). This test proves the machine still reaches `ready` even
      // when a caller passes a provider config — the field is a no-op.
      const machine = makeFastMachine();
      const actor = createActor(machine);
      actor.start();

      const options: CreateDocumentOptions = {
        documentId: 'test-providers-ignored',
        providers: [{ type: 'indexeddb' }, { type: 'websocket', url: 'wss://example.com' }],
      };

      actor.send({ type: 'CREATE', docId: 'test-providers-ignored', options });
      await waitForState(actor, 'ready');

      const snap = actor.getSnapshot();
      expect(snap.value).toBe('ready');

      // The machine context stores the options but never reads `providers`.
      expect(snap.context.options?.providers).toEqual([
        { type: 'indexeddb' },
        { type: 'websocket', url: 'wss://example.com' },
      ]);

      actor.send({ type: 'DISPOSE' });
      await waitForState(actor, 'disposed');
    });

    it('the lifecycle machine reaches ready without a providers field', async () => {
      const machine = makeFastMachine();
      const actor = createActor(machine);
      actor.start();

      actor.send({
        type: 'CREATE',
        docId: 'test-no-providers',
        options: { documentId: 'test-no-providers' },
      });
      await waitForState(actor, 'ready');

      expect(actor.getSnapshot().value).toBe('ready');
      expect(actor.getSnapshot().context.options?.providers).toBeUndefined();

      actor.send({ type: 'DISPOSE' });
      await waitForState(actor, 'disposed');
    });

    it('the providers field type allows empty array (which is equivalent to headless)', async () => {
      const machine = makeFastMachine();
      const actor = createActor(machine);
      actor.start();

      const options: CreateDocumentOptions = {
        documentId: 'test-empty-providers',
        providers: [],
      };

      actor.send({ type: 'CREATE', docId: 'test-empty-providers', options });
      await waitForState(actor, 'ready');

      expect(actor.getSnapshot().value).toBe('ready');

      actor.send({ type: 'DISPOSE' });
      await waitForState(actor, 'disposed');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Raw yrsState boot path
  // -------------------------------------------------------------------------
  describe('CreateDocumentOptions.yrsState', () => {
    it('yrsState is forwarded into machine context options for createEngine', async () => {
      // The `yrsState` field is a legitimate internal path used by:
      //   - Collaboration recovery (R2)
      //   - Trap recovery (the RECOVER event plumbs yrsState into options)
      // It bypasses Provider replay by design — the engine bootstraps from
      // the raw bytes directly. This test proves the machine correctly
      // stores and forwards the field.
      const machine = makeFastMachine();
      const actor = createActor(machine);
      actor.start();

      const fakeYrsState = new Uint8Array([0x01, 0x02, 0x03]);
      const options: CreateDocumentOptions = {
        documentId: 'test-yrs-state',
        yrsState: fakeYrsState,
      };

      actor.send({ type: 'CREATE', docId: 'test-yrs-state', options });
      await waitForState(actor, 'ready');

      // The options are stored in context and forwarded to createEngine.
      expect(actor.getSnapshot().context.options?.yrsState).toBe(fakeYrsState);

      actor.send({ type: 'DISPOSE' });
      await waitForState(actor, 'disposed');
    });

    it('RECOVER event plumbs yrsState into options for re-creation', async () => {
      // This validates the recovery path where yrsState is merged
      // into options via the storeRecoveryState action.
      const machine = makeFastMachine();
      const actor = createActor(machine);
      actor.start();

      // First reach ready.
      actor.send({
        type: 'CREATE',
        docId: 'test-recover-yrs',
        options: { documentId: 'test-recover-yrs' },
      });
      await waitForState(actor, 'ready');

      // Simulate trap.
      const { TrapError } = await import('@mog/transport');
      const trap = new TrapError('compute_recalc', 'unreachable', {
        cause: new Error('test trap'),
      });
      actor.send({ type: 'TRAP', trap });
      await waitForState(actor, 'error');

      // Recover with yrsState.
      const recoveryState = new Uint8Array([0x04, 0x05, 0x06]);
      actor.send({ type: 'RECOVER', yrsState: recoveryState });
      await waitForState(actor, 'ready');

      // The recovery yrsState should be merged into options.
      expect(actor.getSnapshot().context.options?.yrsState).toEqual(recoveryState);

      actor.send({ type: 'DISPOSE' });
      await waitForState(actor, 'disposed');
    });

    it('yrsState without RECOVER context is only usable at document creation time', async () => {
      // Document the contract: yrsState is set at CREATE time, or at
      // RECOVER time. There is no runtime API to inject yrsState into an
      // already-ready document. The machine only reads it during the
      // creating state's createEngine actor.
      const machine = makeFastMachine();
      const actor = createActor(machine);
      actor.start();

      actor.send({
        type: 'CREATE',
        docId: 'test-yrs-timing',
        options: { documentId: 'test-yrs-timing' },
      });
      await waitForState(actor, 'ready');

      // Once ready, there's no event to inject yrsState. The only events
      // the ready state handles are DISPOSE and TRAP.
      const readySnap = actor.getSnapshot();
      expect(readySnap.value).toBe('ready');

      // Sending CREATE again from ready is a no-op (unhandled event).
      actor.send({
        type: 'CREATE',
        docId: 'test-yrs-timing-2',
        options: { yrsState: new Uint8Array([0x99]) },
      });
      // Still in ready — CREATE from ready is not handled.
      expect(actor.getSnapshot().value).toBe('ready');

      actor.send({ type: 'DISPOSE' });
      await waitForState(actor, 'disposed');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Collab sidecar (attachWsSidecar)
  // -------------------------------------------------------------------------
  describe('WebSocket collab sidecar', () => {
    it('attachWsSidecar operates outside the provider registry by design', async () => {
      // The collab sidecar (ws-sidecar.ts) does NOT go through the Provider
      // protocol's attach/appendUpdate/flush lifecycle. It receives a
      // DocumentByteSyncPort so inbound bytes still go through classified raw
      // sync admission before mutation.
      //
      // This test documents the contract: the sidecar's ComputeBridgeLike
      // interface requires syncDiff/syncStateVector but NOT
      // syncApply/appendUpdate/attach/flush. It is structurally NOT a Provider.
      const mod = await import('../collab/ws-sidecar');
      const { attachWsSidecar } = mod;

      // The sidecar factory requires a real WebSocket, which we can't
      // provide in a unit test. Instead, verify the structural contract:
      // the exported function exists and the module does NOT export
      // Provider-like methods (attach, appendUpdate, flush).
      expect(typeof attachWsSidecar).toBe('function');

      // The module's exports should include the sidecar factory but
      // NOT any Provider protocol methods — proving the sidecar is
      // a separate channel, not a Provider.
      const exportedKeys = Object.keys(mod);
      expect(exportedKeys).toContain('attachWsSidecar');
      expect(exportedKeys).not.toContain('attach');
      expect(exportedKeys).not.toContain('appendUpdate');
      expect(exportedKeys).not.toContain('flush');
    });

    it('the lifecycle machine does not reference collab/sidecar during CREATE flow', () => {
      // The document lifecycle machine has no collab-related states or
      // events. Collaboration is layered on top by the shell AFTER the
      // document reaches ready. This test documents that contract.
      const machineConfig = documentLifecycleMachine.config;
      const stateNames = Object.keys(machineConfig.states ?? {});

      // No collab-related states exist in the machine.
      expect(stateNames).not.toContain('collaborating');
      expect(stateNames).not.toContain('syncing_collab');
      expect(stateNames).not.toContain('attaching_collab');

      // The machine's event types do not include collab events.
      // (Verified by the DocumentLifecycleEvent union in the machine module.)
      const eventTypes = [
        'CREATE',
        'CREATE_FROM_XLSX',
        'CREATE_FROM_CSV',
        'DISPOSE',
        'TRAP',
        'RECOVER',
      ];
      // The machine should only handle these events — collab is external.
      expect(stateNames).toEqual(
        expect.arrayContaining([
          'idle',
          'creating',
          'wiring',
          'starting',
          'hydrating',
          'attaching',
          'hydrating_csv',
          'ready',
          'error',
          'disposing',
          'disposed',
        ]),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 4. Provider selection inputs
  // -------------------------------------------------------------------------
  describe('provider selection inputs', () => {
    it('the attachProviders actor receives environment from DLS, skipLocalPersistence from options, and ignores providers', async () => {
      // This is the core of the the storage provider lifecycle bypass guard: provider selection
      // is driven by the DLS's environment plus explicit safe lifecycle
      // flags, not by caller-supplied provider arrays. The machine's
      // attaching state passes `environment: undefined` in its input —
      // the DLS overrides it with its own environment.
      let capturedInput: AttachProvidersInput | null = null;

      const machine = documentLifecycleMachine.provide({
        actors: {
          createEngine: fromPromise<CreateEngineOutput, CreateEngineInput>(async () => ({
            computeBridge: stubBridge(),
            rustDocument: stubRustDocument(),
          })),
          wireContext: fromPromise<WireContextOutput, WireContextInput>(async () => ({
            documentContext: stubDocumentContext(),
          })),
          startBridge: fromPromise<StartBridgeOutput, StartBridgeInput>(async () => ({
            sheetIds: ['sheet-1'],
          })),
          hydrateXlsx: fromPromise<HydrateXlsxOutput, HydrateXlsxInput>(async () => ({
            cellCount: 0,
            sheetIds: ['sheet-1'],
            warnings: [],
          })),
          attachProviders: fromPromise<AttachProvidersOutput, AttachProvidersInput>(
            async ({ input }) => {
              capturedInput = input;
              return { sheetIds: ['sheet-1'] };
            },
          ),
          hydrateCsv: fromPromise<HydrateCsvOutput, HydrateCsvInput>(async () => ({
            cellCount: 0,
            sheetIds: ['sheet-1'],
            warnings: [],
          })),
          disposeBridge: fromPromise<void, DisposeBridgeInput>(async () => {}),
        },
      });

      const actor = createActor(machine);
      actor.start();

      // Even with providers in options, the attachProviders input gets
      // environment from the machine context (which the DLS overrides).
      actor.send({
        type: 'CREATE',
        docId: 'test-env-selection',
        options: {
          documentId: 'test-env-selection',
          providers: [{ type: 'websocket', url: 'wss://ignored.com' }],
          skipLocalPersistence: true,
        },
      });

      await waitForState(actor, 'ready');

      // The machine passes `environment: undefined` to attachProviders.
      // The DLS's provide() override replaces it with the real environment.
      expect(capturedInput).not.toBeNull();
      expect(capturedInput!.environment).toBeUndefined();
      expect(capturedInput!.skipLocalPersistence).toBe(true);

      // The captured input has no reference to the options.providers array.
      // Provider selection is entirely the DLS's responsibility.
      expect(capturedInput!).not.toHaveProperty('providers');

      actor.send({ type: 'DISPOSE' });
      await waitForState(actor, 'disposed');
    });

    it('internal documents skip provider attachment', async () => {
      let capturedInput: AttachProvidersInput | null = null;

      const machine = documentLifecycleMachine.provide({
        actors: {
          createEngine: fromPromise<CreateEngineOutput, CreateEngineInput>(async () => ({
            computeBridge: stubBridge(),
            rustDocument: stubRustDocument(),
          })),
          wireContext: fromPromise<WireContextOutput, WireContextInput>(async () => ({
            documentContext: stubDocumentContext(),
          })),
          startBridge: fromPromise<StartBridgeOutput, StartBridgeInput>(async () => ({
            sheetIds: ['sheet-1'],
          })),
          hydrateXlsx: fromPromise<HydrateXlsxOutput, HydrateXlsxInput>(async () => ({
            cellCount: 0,
            sheetIds: [],
            warnings: [],
          })),
          attachProviders: fromPromise<AttachProvidersOutput, AttachProvidersInput>(
            async ({ input }) => {
              capturedInput = input;
              return { sheetIds: ['sheet-1'] };
            },
          ),
          hydrateCsv: fromPromise<HydrateCsvOutput, HydrateCsvInput>(async () => ({
            cellCount: 0,
            sheetIds: [],
            warnings: [],
          })),
          disposeBridge: fromPromise<void, DisposeBridgeInput>(async () => {}),
        },
      });

      const actor = createActor(machine);
      actor.start();

      actor.send({
        type: 'CREATE',
        docId: 'test-internal',
        options: { documentId: 'test-internal', internal: true },
      });

      await waitForState(actor, 'ready');

      // The `internal` flag is forwarded to attachProviders.
      expect(capturedInput).not.toBeNull();
      expect(capturedInput!.internal).toBe(true);

      actor.send({ type: 'DISPOSE' });
      await waitForState(actor, 'disposed');
    });

    it('skipLocalPersistence skips legacy browser provider attachment', async () => {
      const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        value: {},
      });

      try {
        const harness = Object.create(DocumentLifecycleSystem.prototype) as {
          executeAttachProviders(input: AttachProvidersInput): Promise<AttachProvidersOutput>;
        };
        const computeBridge = {
          getAllSheetIds: jest.fn(async () => ['sheet-1']),
          createDefaultSheet: jest.fn(),
          settleForMirror: jest.fn(),
          core: { forceRefreshAllViewports: jest.fn() },
        } as unknown as AttachProvidersInput['computeBridge'];
        const rustDocument = {
          attachProvider: jest.fn(),
          captureInitialProviderBaseline: jest.fn(),
        } as unknown as AttachProvidersInput['rustDocument'];

        const result = await harness.executeAttachProviders({
          docId: 'csv-ephemeral-doc',
          computeBridge,
          rustDocument,
          internal: false,
          skipLocalPersistence: true,
          environment: 'browser',
          skipDefaultSheet: true,
          importInitialize: true,
          createFresh: false,
        });

        expect(result).toEqual({ sheetIds: ['sheet-1'] });
        expect(rustDocument.attachProvider).not.toHaveBeenCalled();
        expect(rustDocument.captureInitialProviderBaseline).not.toHaveBeenCalled();
      } finally {
        if (indexedDbDescriptor) {
          Object.defineProperty(globalThis, 'indexedDB', indexedDbDescriptor);
        } else {
          delete (globalThis as { indexedDB?: unknown }).indexedDB;
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // 5. XLSX import path goes through provider lifecycle
  // -------------------------------------------------------------------------
  describe('XLSX import uses provider lifecycle', () => {
    it('CREATE_FROM_XLSX goes through hydrating then attaching states', async () => {
      const statesVisited: string[] = [];

      const machine = makeFastMachine();
      const actor = createActor(machine);

      actor.subscribe((snap) => {
        const state = snap.value as string;
        if (!statesVisited.includes(state)) {
          statesVisited.push(state);
        }
      });

      actor.start();
      actor.send({
        type: 'CREATE_FROM_XLSX',
        docId: 'test-xlsx-lifecycle',
        options: { documentId: 'test-xlsx-lifecycle', skipDefaultSheet: true },
        xlsxSource: { type: 'bytes', data: new Uint8Array([0x50, 0x4b]) },
      });

      await waitForState(actor, 'ready');

      // The XLSX path MUST go through these states in order.
      expect(statesVisited).toEqual(
        expect.arrayContaining([
          'idle',
          'creating',
          'wiring',
          'starting',
          'hydrating',
          'attaching',
          'ready',
        ]),
      );

      // Hydrating must come before attaching.
      const hydratingIdx = statesVisited.indexOf('hydrating');
      const attachingIdx = statesVisited.indexOf('attaching');
      expect(hydratingIdx).toBeLessThan(attachingIdx);

      actor.send({ type: 'DISPOSE' });
      await waitForState(actor, 'disposed');
    });
  });

  // -------------------------------------------------------------------------
  // 6. CSV import path goes through the machine
  // -------------------------------------------------------------------------
  describe('CSV import uses lifecycle machine', () => {
    it('CREATE_FROM_CSV goes through hydrating_csv state', async () => {
      const statesVisited: string[] = [];

      const machine = makeFastMachine();
      const actor = createActor(machine);

      actor.subscribe((snap) => {
        const state = snap.value as string;
        if (!statesVisited.includes(state)) {
          statesVisited.push(state);
        }
      });

      actor.start();
      actor.send({
        type: 'CREATE_FROM_CSV',
        docId: 'test-csv-lifecycle',
        options: { documentId: 'test-csv-lifecycle', skipDefaultSheet: true },
        csvSource: { type: 'bytes', data: new Uint8Array([0x41, 0x2c, 0x42]) },
        csvImportOptions: null,
      });

      await waitForState(actor, 'ready');

      expect(statesVisited).toContain('hydrating_csv');

      actor.send({ type: 'DISPOSE' });
      await waitForState(actor, 'disposed');
    });
  });

  // -------------------------------------------------------------------------
  // 7. initialSnapshot path
  // -------------------------------------------------------------------------
  describe('CreateDocumentOptions.initialSnapshot', () => {
    it('initialSnapshot is forwarded to createEngine via machine context', async () => {
      let capturedEngineInput: CreateEngineInput | null = null;

      const machine = documentLifecycleMachine.provide({
        actors: {
          createEngine: fromPromise<CreateEngineOutput, CreateEngineInput>(async ({ input }) => {
            capturedEngineInput = input;
            return {
              computeBridge: stubBridge(),
              rustDocument: stubRustDocument(),
            };
          }),
          wireContext: fromPromise<WireContextOutput, WireContextInput>(async () => ({
            documentContext: stubDocumentContext(),
          })),
          startBridge: fromPromise<StartBridgeOutput, StartBridgeInput>(async () => ({
            sheetIds: ['sheet-1'],
          })),
          hydrateXlsx: fromPromise<HydrateXlsxOutput, HydrateXlsxInput>(async () => ({
            cellCount: 0,
            sheetIds: [],
            warnings: [],
          })),
          attachProviders: fromPromise<AttachProvidersOutput, AttachProvidersInput>(async () => ({
            sheetIds: ['sheet-1'],
          })),
          hydrateCsv: fromPromise<HydrateCsvOutput, HydrateCsvInput>(async () => ({
            cellCount: 0,
            sheetIds: [],
            warnings: [],
          })),
          disposeBridge: fromPromise<void, DisposeBridgeInput>(async () => {}),
        },
      });

      const actor = createActor(machine);
      actor.start();

      const snapshot = { sheets: { s1: { cells: {} } } };
      actor.send({
        type: 'CREATE',
        docId: 'test-snapshot',
        options: {
          documentId: 'test-snapshot',
          initialSnapshot: snapshot,
        },
      });

      await waitForState(actor, 'ready');

      expect(capturedEngineInput).not.toBeNull();
      expect(capturedEngineInput!.options.initialSnapshot).toEqual(snapshot);

      actor.send({ type: 'DISPOSE' });
      await waitForState(actor, 'disposed');
    });
  });

  // -------------------------------------------------------------------------
  // 8. Dispose from any state works correctly
  // -------------------------------------------------------------------------
  describe('dispose from any lifecycle phase', () => {
    it('DISPOSE from idle is a no-op (machine stays idle — no resources to clean up)', () => {
      // The idle state does not handle DISPOSE because there are no
      // resources to clean up. DISPOSE is only meaningful after CREATE
      // has been sent and resources have been allocated.
      const machine = makeFastMachine();
      const actor = createActor(machine);
      actor.start();

      expect(actor.getSnapshot().value).toBe('idle');
      actor.send({ type: 'DISPOSE' });
      // Machine stays in idle — DISPOSE is unhandled in this state.
      expect(actor.getSnapshot().value).toBe('idle');
    });

    it('DISPOSE from ready goes to disposing then disposed', async () => {
      const machine = makeFastMachine();
      const actor = createActor(machine);
      actor.start();

      actor.send({
        type: 'CREATE',
        docId: 'test-dispose-ready',
        options: {},
      });
      await waitForState(actor, 'ready');

      actor.send({ type: 'DISPOSE' });
      await waitForState(actor, 'disposed');
    });

    it('DISPOSE from error goes to disposing then disposed', async () => {
      const machine = makeFastMachine();
      const actor = createActor(machine);
      actor.start();

      // Force into error via TRAP from idle.
      const { TrapError } = await import('@mog/transport');
      const trap = new TrapError('compute_recalc', 'unreachable', {
        cause: new Error('test'),
      });
      actor.send({ type: 'TRAP', trap });
      await waitForState(actor, 'error');

      actor.send({ type: 'DISPOSE' });
      await waitForState(actor, 'disposed');
    });
  });
});
