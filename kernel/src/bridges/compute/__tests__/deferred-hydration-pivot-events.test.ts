import { jest } from '@jest/globals';

(globalThis as any).window = {};

import type { BridgeTransport } from '@rust-bridge/client';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';

import { ComputeBridge } from '../compute-bridge';
import type { MutationResult } from '../compute-types.gen';

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

function makeMockContext() {
  const eventBus = {
    emit: jest.fn(),
    on: jest.fn(() => () => {}),
    off: jest.fn(),
  };
  const ctx = {
    eventBus,
    setPendingUndoDescription: jest.fn(),
    getPendingUndoDescription: jest.fn(() => null),
    clearPendingUndoDescription: jest.fn(),
    destroy: jest.fn(),
  } as unknown as IKernelContext;
  return { ctx, eventBus };
}

describe('ComputeBridge deferred hydration pivot events', () => {
  it('tags pivot changes from deferred import hydration with update metadata', async () => {
    const result = mutationResult({
      pivotChanges: [{ sheetId: 'sheet-1', pivotId: 'pivot-1', kind: 'Set' }],
    });
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        if (command === 'compute_complete_deferred_hydration') {
          return [new Uint8Array(), result];
        }
        if (command === 'compute_drain_pending_updates') {
          return [];
        }
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const { ctx, eventBus } = makeMockContext();
    const bridge = new ComputeBridge(ctx, 'test-doc', transport);
    bridge.initMutationHandler();
    (bridge as any).core._phase = 'STARTED';

    await bridge.completeDeferredHydration();

    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'pivot:updated',
        pivotId: 'pivot-1',
        update: { reason: 'uiConfigChanged', refreshPolicy: 'refreshAndMaterialize' },
      }),
    );
  });
});
