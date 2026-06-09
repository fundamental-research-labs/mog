import { jest } from '@jest/globals';

(globalThis as any).window = {};

import type { BridgeTransport } from '@rust-bridge/client';
import { sheetId } from '@mog-sdk/contracts/core';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';

import { WriteGate } from '../../../document/write-gate';
import { ComputeBridge } from '../compute-bridge';
import { ComputeCore } from '../compute-core';
import type { MutationResult } from '../compute-types.gen';

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mutationResult(overrides: Partial<MutationResult> = {}): MutationResult {
  return {
    recalc: {
      changedCells: [],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
    ...overrides,
  } as MutationResult;
}

function makeMockContext(overrides: Partial<IKernelContext> = {}): IKernelContext {
  return {
    eventBus: { emit: jest.fn(), on: jest.fn(() => () => {}), off: jest.fn() },
    setPendingUndoDescription: jest.fn(),
    getPendingUndoDescription: jest.fn(() => null),
    clearPendingUndoDescription: jest.fn(),
    destroy: jest.fn(),
    services: {
      undo: {
        notifyForwardMutation: jest.fn(async () => undefined),
      },
    },
    ...overrides,
  } as unknown as IKernelContext;
}

function createStartedCore(ctx: IKernelContext, transport: BridgeTransport): ComputeCore {
  const core = new ComputeCore(ctx, 'test-doc', transport);
  (core as any)._phase = 'STARTED';
  (core as any).engineCreated = true;
  return core;
}

function createStartedBridge(ctx: IKernelContext, transport: BridgeTransport): ComputeBridge {
  const bridge = new ComputeBridge(ctx, 'test-doc', transport);
  (bridge as any).core._phase = 'STARTED';
  (bridge as any).core.engineCreated = true;
  return bridge;
}

describe('Compute mutation admission', () => {
  it('waits for all-sheet materialization before starting a public transport call', async () => {
    const materialized = deferred<void>();
    const awaitMaterialized = jest.fn(() => materialized.promise);
    const ctx = makeMockContext({ awaitMaterialized } as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const core = createStartedCore(ctx, transport);

    const promise = core.mutatePublic('compute_set_cell', () =>
      transport.call('compute_set_cell', { docId: 'test-doc' }) as Promise<
        [Uint8Array, MutationResult]
      >,
    );

    await Promise.resolve();

    expect(awaitMaterialized).toHaveBeenCalledWith('allSheets');
    expect(transport.call).not.toHaveBeenCalled();

    materialized.resolve();
    await promise;

    expect(transport.call).toHaveBeenCalledWith('compute_set_cell', { docId: 'test-doc' });
  });

  it('rechecks the write gate after materialization before starting public transport', async () => {
    const materialized = deferred<void>();
    const ctx = makeMockContext({
      awaitMaterialized: jest.fn(() => materialized.promise),
    } as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const core = createStartedCore(ctx, transport);
    const gate = new WriteGate();
    core.setWriteGate(gate);

    const promise = core.mutatePublic('compute_set_cell', () =>
      transport.call('compute_set_cell', { docId: 'test-doc' }) as Promise<
        [Uint8Array, MutationResult]
      >,
    );
    await Promise.resolve();

    gate.enterClosing();
    materialized.resolve();

    await expect(promise).rejects.toThrow("document is in 'closing' mode");
    expect(transport.call).not.toHaveBeenCalled();
  });

  it('lets system mutations bypass materialization and closing-mode public admission', async () => {
    const awaitMaterialized = jest.fn(async () => undefined);
    const ctx = makeMockContext({ awaitMaterialized } as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const core = createStartedCore(ctx, transport);
    const gate = new WriteGate();
    gate.enterClosing();
    core.setWriteGate(gate);

    await core.mutateSystem('compute_complete_deferred_hydration', () =>
      transport.call('compute_complete_deferred_hydration', { docId: 'test-doc' }) as Promise<
        [Uint8Array, MutationResult]
      >,
    );

    expect(awaitMaterialized).not.toHaveBeenCalled();
    expect(transport.call).toHaveBeenCalledWith('compute_complete_deferred_hydration', {
      docId: 'test-doc',
    });
    expect(gate.bypassDepth).toBe(0);
  });

  it('does not begin compound removeSheet mutation before materialization', async () => {
    const materialized = deferred<void>();
    const awaitMaterialized = jest.fn(() => materialized.promise);
    const ctx = makeMockContext({ awaitMaterialized } as Partial<IKernelContext>);
    const calls: string[] = [];
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        calls.push(command);
        if (command === 'compute_begin_undo_group') return undefined;
        if (command === 'compute_delete_sheet') return [new Uint8Array(), mutationResult()];
        if (command === 'compute_get_sheet_order') return [];
        if (command === 'compute_end_undo_group') return undefined;
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const bridge = createStartedBridge(ctx, transport);

    const promise = bridge.removeSheet(sheetId('sheet-delete'));
    await Promise.resolve();

    expect(awaitMaterialized).toHaveBeenCalledWith('allSheets');
    expect(calls).toEqual([]);

    materialized.resolve();
    await promise;

    expect(calls.slice(0, 2)).toEqual(['compute_begin_undo_group', 'compute_delete_sheet']);
  });
});
