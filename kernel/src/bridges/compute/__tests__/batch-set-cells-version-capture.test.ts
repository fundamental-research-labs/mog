import { jest } from '@jest/globals';

(globalThis as any).window = {};

import type { BridgeTransport } from '@rust-bridge/client';
import { sheetId } from '@mog-sdk/contracts/core';
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

function createStartedBridge(ctx: IKernelContext, transport: BridgeTransport): ComputeBridge {
  const bridge = new ComputeBridge(ctx, 'test-doc', transport);
  (bridge as any).core._phase = 'STARTED';
  (bridge as any).core.engineCreated = true;
  return bridge;
}

describe('batch-set-cells version capture', () => {
  it('passes direct edit metadata for public batch-by-position writes', async () => {
    const recordMutationResult = jest.fn();
    const ctx = makeMockContext({
      versioning: {
        mutationCapture: { recordMutationResult },
      },
    } as unknown as Partial<IKernelContext>);
    const result = mutationResult({
      recalc: {
        changedCells: [
          {
            cellId: 'cell-c2',
            sheetId: 'sheet-1',
            position: { row: 1, col: 2 },
            oldValue: null,
            value: 7,
            extraFlags: 0,
          },
        ],
        projectionChanges: [],
        errors: [],
        validationAnnotations: [],
        metrics: {},
      },
    });
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), result]),
    };
    const bridge = createStartedBridge(ctx, transport);
    const operationContext = {
      operationId: 'operation-1',
      kind: 'mutation',
      author: { authorId: 'user-1', actorKind: 'user' },
      createdAt: '2026-06-20T00:00:00.000Z',
      domainIds: ['cell'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    };
    const edits: Parameters<ComputeBridge['batchSetCellsByPosition']>[0] = [
      [sheetId('sheet-1'), 1, 2, { kind: 'value', value: 7 }],
    ];

    await bridge.batchSetCellsByPosition(edits, true, {
      operationContext: operationContext as any,
    });

    expect(transport.call).toHaveBeenCalledWith('compute_batch_set_cells_by_position', {
      docId: 'test-doc',
      edits,
      skipCycleCheck: true,
    });
    expect(recordMutationResult).toHaveBeenCalledWith({
      operation: 'compute_batch_set_cells_by_position',
      result,
      directEdits: [{ sheetId: 'sheet-1', row: 1, col: 2 }],
      operationContext,
    });
  });
});
