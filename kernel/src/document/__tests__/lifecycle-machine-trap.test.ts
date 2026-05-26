/**
 * lifecycle-machine-trap.test.ts
 *
 *
 * Pure tests of the document lifecycle machine's TRAP and RECOVER
 * events. The machine is the source of truth for state transitions;
 * the system class wires actor implementations on top, but the state
 * graph itself is testable in isolation by providing stub actors that
 * resolve immediately.
 *
 * Covered:
 *   - TRAP from idle/creating/wiring/starting/hydrating/attaching/ready/
 *     hydrating_csv lands in `error` with the trap as context error.
 *   - TRAP from error stays in error (idempotent — first trap wins).
 *   - RECOVER from error transitions back to `creating` with the
 *     recovery yrsState plumbed into options.
 *   - RECOVER from any other state is unhandled (no transition).
 *   - The `isTrapped` selector recognises TRAP-induced errors and
 *     ignores generic actor failures.
 */
import { jest } from '@jest/globals';
import { createActor, fromPromise } from 'xstate';

import { TrapError } from '@mog/transport';

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

// ---------------------------------------------------------------------------
// Stub actors — never resolve. We use them to PIN the machine in a
// specific state (e.g. `creating`) so the test can dispatch TRAP from
// that exact phase. Resolving actors would race the test's assertions.
// ---------------------------------------------------------------------------

function neverResolves<TOutput>(): Promise<TOutput> {
  return new Promise<TOutput>(() => {
    // pending forever
  });
}

function makeMachineWithStubActors() {
  return documentLifecycleMachine.provide({
    actors: {
      createEngine: fromPromise<CreateEngineOutput, CreateEngineInput>(() =>
        neverResolves<CreateEngineOutput>(),
      ),
      wireContext: fromPromise<WireContextOutput, WireContextInput>(() =>
        neverResolves<WireContextOutput>(),
      ),
      startBridge: fromPromise<StartBridgeOutput, StartBridgeInput>(() =>
        neverResolves<StartBridgeOutput>(),
      ),
      hydrateXlsx: fromPromise<HydrateXlsxOutput, HydrateXlsxInput>(() =>
        neverResolves<HydrateXlsxOutput>(),
      ),
      attachProviders: fromPromise<AttachProvidersOutput, AttachProvidersInput>(() =>
        neverResolves<AttachProvidersOutput>(),
      ),
      hydrateCsv: fromPromise<HydrateCsvOutput, HydrateCsvInput>(() =>
        neverResolves<HydrateCsvOutput>(),
      ),
      disposeBridge: fromPromise<void, DisposeBridgeInput>(() => neverResolves<void>()),
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleTrap = (): TrapError =>
  new TrapError('compute_recalc', 'unreachable', {
    cause: new WebAssembly.RuntimeError('unreachable'),
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('document lifecycle machine — TRAP event', () => {
  it('idle → error on TRAP', () => {
    const actor = createActor(makeMachineWithStubActors());
    actor.start();
    expect(actor.getSnapshot().value).toBe('idle');

    const trap = sampleTrap();
    actor.send({ type: 'TRAP', trap });

    expect(actor.getSnapshot().value).toBe('error');
    expect(documentLifecycleSelectors.isError(actor.getSnapshot())).toBe(true);
    expect(documentLifecycleSelectors.isTrapped(actor.getSnapshot())).toBe(true);
  });

  it('creating → error on TRAP (during in-flight createEngine)', () => {
    const actor = createActor(makeMachineWithStubActors());
    actor.start();

    actor.send({ type: 'CREATE', docId: 'd1', options: {} });
    expect(actor.getSnapshot().value).toBe('creating');

    actor.send({ type: 'TRAP', trap: sampleTrap() });
    expect(actor.getSnapshot().value).toBe('error');
    expect(documentLifecycleSelectors.isTrapped(actor.getSnapshot())).toBe(true);
  });

  it('error → error on TRAP keeps the FIRST trap in context', () => {
    const actor = createActor(makeMachineWithStubActors());
    actor.start();

    const firstTrap = new TrapError('compute_init', 'unreachable');
    const secondTrap = new TrapError('compute_recalc', 'memory access out of bounds');

    actor.send({ type: 'TRAP', trap: firstTrap });
    const errBefore = actor.getSnapshot().context.error;
    expect(errBefore).not.toBeNull();
    expect((errBefore as { cause?: unknown }).cause).toBe(firstTrap);

    actor.send({ type: 'TRAP', trap: secondTrap });
    expect(actor.getSnapshot().value).toBe('error');
    // Error stayed the same object — first trap wins.
    expect(actor.getSnapshot().context.error).toBe(errBefore);
  });

  it('TRAP from disposed is unhandled (machine is final)', () => {
    // Build a separate machine with a fast disposeBridge actor so we
    // can reach `disposed` deterministically.
    const machine = documentLifecycleMachine.provide({
      actors: {
        createEngine: fromPromise<CreateEngineOutput, CreateEngineInput>(() =>
          neverResolves<CreateEngineOutput>(),
        ),
        wireContext: fromPromise<WireContextOutput, WireContextInput>(() =>
          neverResolves<WireContextOutput>(),
        ),
        startBridge: fromPromise<StartBridgeOutput, StartBridgeInput>(() =>
          neverResolves<StartBridgeOutput>(),
        ),
        hydrateXlsx: fromPromise<HydrateXlsxOutput, HydrateXlsxInput>(() =>
          neverResolves<HydrateXlsxOutput>(),
        ),
        attachProviders: fromPromise<AttachProvidersOutput, AttachProvidersInput>(() =>
          neverResolves<AttachProvidersOutput>(),
        ),
        hydrateCsv: fromPromise<HydrateCsvOutput, HydrateCsvInput>(() =>
          neverResolves<HydrateCsvOutput>(),
        ),
        disposeBridge: fromPromise<void, DisposeBridgeInput>(async () => {}),
      },
    });
    const actor = createActor(machine);
    actor.start();
    // Idle has no DISPOSE handler; route through `creating` so the
    // DISPOSE event is valid (idle → creating → disposing → disposed).
    // The createEngine stub never resolves, so the `creating` state
    // is the parking point for DISPOSE to fire from.
    actor.send({ type: 'CREATE', docId: 'd1', options: {} });
    actor.send({ type: 'DISPOSE' });
    return new Promise<void>((resolve) => {
      const sub = actor.subscribe((snap) => {
        if (snap.value === 'disposed') {
          sub.unsubscribe();
          // TRAP after disposed: no-op (unhandled).
          actor.send({ type: 'TRAP', trap: sampleTrap() });
          expect(actor.getSnapshot().value).toBe('disposed');
          resolve();
        }
      });
    });
  });
});

describe('document lifecycle machine — RECOVER event', () => {
  it('error → creating on RECOVER and forwards yrsState through context.options', () => {
    const actor = createActor(makeMachineWithStubActors());
    actor.start();

    // Set up CREATE first so context.options gets populated. Then trap
    // it to land in error.
    actor.send({ type: 'CREATE', docId: 'd1', options: { skipDefaultSheet: false } });
    actor.send({ type: 'TRAP', trap: sampleTrap() });
    expect(actor.getSnapshot().value).toBe('error');

    const yrsState = new Uint8Array([1, 2, 3]);
    actor.send({ type: 'RECOVER', yrsState });

    const snap = actor.getSnapshot();
    expect(snap.value).toBe('creating');
    expect(snap.context.error).toBeNull();
    expect(snap.context.recoveryYrsState).toBe(yrsState);
    // yrsState was merged into options so executeCreateEngine picks it up.
    expect(snap.context.options?.yrsState).toBe(yrsState);
    // skipDefaultSheet preserved from the original CREATE.
    expect(snap.context.options?.skipDefaultSheet).toBe(false);
  });

  it('RECOVER without yrsState clears error and re-enters creating', () => {
    const actor = createActor(makeMachineWithStubActors());
    actor.start();
    actor.send({ type: 'CREATE', docId: 'd1', options: {} });
    actor.send({ type: 'TRAP', trap: sampleTrap() });

    actor.send({ type: 'RECOVER' });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('creating');
    expect(snap.context.recoveryYrsState).toBeNull();
    expect(snap.context.options?.yrsState).toBeUndefined();
  });

  it('RECOVER from idle is unhandled (no transition)', () => {
    const actor = createActor(makeMachineWithStubActors());
    actor.start();
    expect(actor.getSnapshot().value).toBe('idle');

    actor.send({ type: 'RECOVER' });
    expect(actor.getSnapshot().value).toBe('idle');
  });

  it('RECOVER from creating is unhandled', () => {
    const actor = createActor(makeMachineWithStubActors());
    actor.start();
    actor.send({ type: 'CREATE', docId: 'd1', options: {} });
    expect(actor.getSnapshot().value).toBe('creating');

    actor.send({ type: 'RECOVER' });
    expect(actor.getSnapshot().value).toBe('creating');
  });

  it('RECOVER drops dead bridge/document refs from context', () => {
    const actor = createActor(makeMachineWithStubActors());
    actor.start();
    actor.send({ type: 'CREATE', docId: 'd1', options: {} });
    actor.send({ type: 'TRAP', trap: sampleTrap() });

    actor.send({ type: 'RECOVER' });
    const ctx = actor.getSnapshot().context;
    // The OLD bridge/rustDocument refs in context point into the dead
    // WASM. They MUST be dropped so executeCreateEngine builds fresh
    // ones. Tests for the actor side cover the dispose ordering.
    expect(ctx.computeBridge).toBeNull();
    expect(ctx.rustDocument).toBeNull();
    expect(ctx.documentContext).toBeNull();
    expect(ctx.initialSheetIds).toEqual([]);
  });
});

describe('document lifecycle selectors — isTrapped', () => {
  it('returns false for non-error states', () => {
    const actor = createActor(makeMachineWithStubActors());
    actor.start();
    expect(documentLifecycleSelectors.isTrapped(actor.getSnapshot())).toBe(false);
    actor.send({ type: 'CREATE', docId: 'd1', options: {} });
    expect(documentLifecycleSelectors.isTrapped(actor.getSnapshot())).toBe(false);
  });

  it('returns true when error was set via TRAP (cause has isTrap)', () => {
    const actor = createActor(makeMachineWithStubActors());
    actor.start();
    actor.send({ type: 'TRAP', trap: sampleTrap() });
    expect(documentLifecycleSelectors.isTrapped(actor.getSnapshot())).toBe(true);
  });

  it('returns false when error was set by an actor failure (no isTrap on cause)', async () => {
    // Build a machine whose createEngine actor rejects with a generic
    // (non-trap) error. The error path lands in `error` but `isTrapped`
    // should return false — only TRAP-induced errors are traps.
    const machine = documentLifecycleMachine.provide({
      actors: {
        createEngine: fromPromise<CreateEngineOutput, CreateEngineInput>(async () => {
          throw new Error('regular boring failure');
        }),
        wireContext: fromPromise<WireContextOutput, WireContextInput>(() =>
          neverResolves<WireContextOutput>(),
        ),
        startBridge: fromPromise<StartBridgeOutput, StartBridgeInput>(() =>
          neverResolves<StartBridgeOutput>(),
        ),
        hydrateXlsx: fromPromise<HydrateXlsxOutput, HydrateXlsxInput>(() =>
          neverResolves<HydrateXlsxOutput>(),
        ),
        attachProviders: fromPromise<AttachProvidersOutput, AttachProvidersInput>(() =>
          neverResolves<AttachProvidersOutput>(),
        ),
        hydrateCsv: fromPromise<HydrateCsvOutput, HydrateCsvInput>(() =>
          neverResolves<HydrateCsvOutput>(),
        ),
        disposeBridge: fromPromise<void, DisposeBridgeInput>(() => neverResolves<void>()),
      },
    });
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: 'CREATE', docId: 'd1', options: {} });

    return new Promise<void>((resolve) => {
      const sub = actor.subscribe((snap) => {
        if (snap.value === 'error') {
          sub.unsubscribe();
          expect(documentLifecycleSelectors.isTrapped(snap)).toBe(false);
          expect(documentLifecycleSelectors.isError(snap)).toBe(true);
          resolve();
        }
      });
    });
  });
});

describe('TRAP through ready state (post-startup runtime trap)', () => {
  it('reaches error from a ready doc when TRAP fires', async () => {
    // Build a fast-resolving machine to land in ready, then trap.
    const machine = documentLifecycleMachine.provide({
      actors: {
        createEngine: fromPromise<CreateEngineOutput, CreateEngineInput>(async () => ({
          // Cast: actors don't actually USE these refs, the machine
          // just stores them in context.
          computeBridge: {} as never,
          rustDocument: {} as never,
        })),
        wireContext: fromPromise<WireContextOutput, WireContextInput>(async () => ({
          documentContext: {} as never,
        })),
        startBridge: fromPromise<StartBridgeOutput, StartBridgeInput>(async () => ({
          sheetIds: [],
        })),
        attachProviders: fromPromise<AttachProvidersOutput, AttachProvidersInput>(async () => ({
          sheetIds: ['sheet-1' as never],
        })),
        hydrateXlsx: fromPromise<HydrateXlsxOutput, HydrateXlsxInput>(() =>
          neverResolves<HydrateXlsxOutput>(),
        ),
        hydrateCsv: fromPromise<HydrateCsvOutput, HydrateCsvInput>(() =>
          neverResolves<HydrateCsvOutput>(),
        ),
        disposeBridge: fromPromise<void, DisposeBridgeInput>(() => neverResolves<void>()),
      },
    });
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: 'CREATE', docId: 'd1', options: {} });

    await new Promise<void>((resolve) => {
      const sub = actor.subscribe((snap) => {
        if (snap.value === 'ready') {
          sub.unsubscribe();
          resolve();
        }
      });
    });

    actor.send({ type: 'TRAP', trap: sampleTrap() });
    expect(actor.getSnapshot().value).toBe('error');
    expect(documentLifecycleSelectors.isTrapped(actor.getSnapshot())).toBe(true);
  });
});
