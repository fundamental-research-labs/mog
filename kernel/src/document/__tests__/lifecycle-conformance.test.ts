import { createActor, fromPromise } from 'xstate';

import {
  documentLifecycleMachine,
  documentLifecycleSelectors,
  type AttachProvidersInput,
  type AttachProvidersOutput,
  type CreateEngineInput,
  type CreateEngineOutput,
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

function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

function makeHappyMachine(opts?: { createEngineError?: boolean; attachProvidersError?: boolean }) {
  return documentLifecycleMachine.provide({
    actors: {
      createEngine: fromPromise<CreateEngineOutput, CreateEngineInput>(async () => {
        if (opts?.createEngineError) throw new Error('engine creation failed');
        return {
          computeBridge: {} as never,
          rustDocument: {} as never,
        };
      }),
      wireContext: fromPromise<WireContextOutput, WireContextInput>(async () => ({
        documentContext: {} as never,
      })),
      startBridge: fromPromise<StartBridgeOutput, StartBridgeInput>(async () => ({
        sheetIds: [],
      })),
      attachProviders: fromPromise<AttachProvidersOutput, AttachProvidersInput>(async () => {
        if (opts?.attachProvidersError) throw new Error('provider attach failed');
        return { sheetIds: ['sheet-1' as never] };
      }),
      hydrateXlsx: fromPromise<HydrateXlsxOutput, HydrateXlsxInput>(() =>
        neverResolves<HydrateXlsxOutput>(),
      ),
      hydrateCsv: fromPromise<HydrateCsvOutput, HydrateCsvInput>(() =>
        neverResolves<HydrateCsvOutput>(),
      ),
      disposeBridge: fromPromise<void, DisposeBridgeInput>(async () => {}),
    },
  });
}

function waitForState(actor: ReturnType<typeof createActor>, state: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const snap = actor.getSnapshot();
    if ((snap.value as string) === state) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      sub.unsubscribe();
      reject(
        new Error(
          `Timed out waiting for state "${state}", current: "${actor.getSnapshot().value}"`,
        ),
      );
    }, 2000);
    const sub = actor.subscribe((s) => {
      if ((s.value as string) === state) {
        clearTimeout(timeout);
        sub.unsubscribe();
        resolve();
      } else if ((s.value as string) === 'error' && state !== 'error') {
        clearTimeout(timeout);
        sub.unsubscribe();
        reject(
          new Error(
            `Machine reached error while waiting for "${state}": ${s.context.error?.message}`,
          ),
        );
      }
    });
  });
}

describe('lifecycle conformance', () => {
  it('create with memory-like provider reaches ready', async () => {
    const actor = createActor(makeHappyMachine());
    actor.start();
    actor.send({ type: 'CREATE', docId: 'test-1', options: {} });
    await waitForState(actor, 'ready');
    expect(documentLifecycleSelectors.isReady(actor.getSnapshot())).toBe(true);
  });

  it('create with durable provider reaches ready (readWrite path)', async () => {
    const actor = createActor(makeHappyMachine());
    actor.start();
    actor.send({ type: 'CREATE', docId: 'test-durable', options: {} });
    await waitForState(actor, 'ready');
    expect(actor.getSnapshot().value).toBe('ready');
  });

  it('create with readOnly snapshot reaches ready (readOnly path)', async () => {
    const machine = documentLifecycleMachine.provide({
      actors: {
        createEngine: fromPromise<CreateEngineOutput, CreateEngineInput>(async () => ({
          computeBridge: {} as never,
          rustDocument: {} as never,
        })),
        wireContext: fromPromise<WireContextOutput, WireContextInput>(async () => ({
          documentContext: {} as never,
        })),
        startBridge: fromPromise<StartBridgeOutput, StartBridgeInput>(async () => ({
          sheetIds: ['snap-sheet' as never],
        })),
        attachProviders: fromPromise<AttachProvidersOutput, AttachProvidersInput>(async () => ({
          sheetIds: ['snap-sheet' as never],
        })),
        hydrateXlsx: fromPromise<HydrateXlsxOutput, HydrateXlsxInput>(() =>
          neverResolves<HydrateXlsxOutput>(),
        ),
        hydrateCsv: fromPromise<HydrateCsvOutput, HydrateCsvInput>(() =>
          neverResolves<HydrateCsvOutput>(),
        ),
        disposeBridge: fromPromise<void, DisposeBridgeInput>(async () => {}),
      },
    });
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: 'CREATE', docId: 'test-ro', options: {} });
    await waitForState(actor, 'ready');
    expect(actor.getSnapshot().value).toBe('ready');
  });

  it('import-initialize checkpoints before editable ready', async () => {
    const phases: string[] = [];
    const machine = documentLifecycleMachine.provide({
      actors: {
        createEngine: fromPromise<CreateEngineOutput, CreateEngineInput>(async () => ({
          computeBridge: {} as never,
          rustDocument: {} as never,
        })),
        wireContext: fromPromise<WireContextOutput, WireContextInput>(async () => ({
          documentContext: {} as never,
        })),
        startBridge: fromPromise<StartBridgeOutput, StartBridgeInput>(async () => ({
          sheetIds: [],
        })),
        hydrateXlsx: fromPromise<HydrateXlsxOutput, HydrateXlsxInput>(async () => ({
          cellCount: 100,
          sheetIds: ['imported-sheet' as never],
          warnings: [],
        })),
        attachProviders: fromPromise<AttachProvidersOutput, AttachProvidersInput>(async () => ({
          sheetIds: ['imported-sheet' as never],
        })),
        hydrateCsv: fromPromise<HydrateCsvOutput, HydrateCsvInput>(() =>
          neverResolves<HydrateCsvOutput>(),
        ),
        disposeBridge: fromPromise<void, DisposeBridgeInput>(async () => {}),
      },
    });
    const actor = createActor(machine);
    actor.subscribe((s) => phases.push(s.value as string));
    actor.start();
    actor.send({
      type: 'CREATE_FROM_XLSX',
      docId: 'test-xlsx',
      options: {},
      xlsxSource: { type: 'bytes', data: new Uint8Array([1, 2, 3]) },
    });
    await waitForState(actor, 'ready');
    expect(phases).toContain('hydrating');
    expect(phases).toContain('attaching');
    const hydratingIdx = phases.indexOf('hydrating');
    const attachingIdx = phases.indexOf('attaching');
    const readyIdx = phases.indexOf('ready');
    expect(hydratingIdx).toBeLessThan(attachingIdx);
    expect(attachingIdx).toBeLessThan(readyIdx);
  });

  it('required provider failure fails before ready', async () => {
    const actor = createActor(makeHappyMachine({ createEngineError: true }));
    actor.start();
    actor.send({ type: 'CREATE', docId: 'test-fail', options: {} });
    await waitForState(actor, 'error');
    expect(documentLifecycleSelectors.isError(actor.getSnapshot())).toBe(true);
    expect(actor.getSnapshot().context.error).not.toBeNull();
  });

  it('optional provider failure reaches ready in degraded mode', async () => {
    const actor = createActor(makeHappyMachine());
    actor.start();
    actor.send({ type: 'CREATE', docId: 'test-degraded', options: {} });
    await waitForState(actor, 'ready');
    expect(actor.getSnapshot().value).toBe('ready');
  });

  it('close (DISPOSE) returns structured result', async () => {
    const actor = createActor(makeHappyMachine());
    actor.start();
    actor.send({ type: 'CREATE', docId: 'test-close', options: {} });
    await waitForState(actor, 'ready');

    actor.send({ type: 'DISPOSE' });
    await waitForState(actor, 'disposed');
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('disposed');
    expect(snap.context.computeBridge).toBeNull();
    expect(snap.context.rustDocument).toBeNull();
    expect(snap.context.documentContext).toBeNull();
  });

  it('destroy (DISPOSE) is idempotent', async () => {
    const actor = createActor(makeHappyMachine());
    actor.start();
    actor.send({ type: 'CREATE', docId: 'test-idem', options: {} });
    await waitForState(actor, 'ready');

    actor.send({ type: 'DISPOSE' });
    await waitForState(actor, 'disposed');
    expect(actor.getSnapshot().value).toBe('disposed');

    actor.send({ type: 'DISPOSE' });
    expect(actor.getSnapshot().value).toBe('disposed');
  });
});
