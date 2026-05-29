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

function makeMockContext(): IKernelContext {
  return {
    eventBus: { emit: jest.fn(), on: jest.fn(() => () => {}), off: jest.fn() },
    setPendingUndoDescription: jest.fn(),
    getPendingUndoDescription: jest.fn(() => null),
    clearPendingUndoDescription: jest.fn(),
    destroy: jest.fn(),
  } as any;
}

function createStartedBridge(transport: BridgeTransport & { call: jest.Mock }): ComputeBridge {
  const bridge = new ComputeBridge(makeMockContext(), 'test-doc', transport);
  (bridge as any).core._phase = 'STARTED';
  return bridge;
}

describe('ComputeBridge DATE formula format compatibility', () => {
  it('applies M/d/yyyy only when stale WASM leaves a numeric DATE formula General', async () => {
    const primary = mutationResult();
    const formatChange = {
      sheetId: 'sheet-1',
      row: 0,
      col: 0,
      format: { numberFormat: 'M/d/yyyy' },
    };
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        if (command === 'compute_batch_set_cells_by_position') {
          return [new Uint8Array(), primary];
        }
        if (command === 'compute_get_resolved_format') {
          return {};
        }
        if (command === 'compute_get_cell_value') {
          return 46024;
        }
        if (command === 'compute_set_format_for_ranges') {
          return [new Uint8Array(), mutationResult({ propertyChanges: [formatChange as any] })];
        }
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const bridge = createStartedBridge(transport);

    const result = await bridge.setCellsByPosition(sheetId('sheet-1'), [
      { row: 0, col: 0, input: { kind: 'parse', text: '=DATE(2026,1,2)' } },
    ]);

    expect(transport.call).toHaveBeenCalledWith(
      'compute_set_format_for_ranges',
      expect.objectContaining({
        sheetId: 'sheet-1',
        ranges: [[0, 0, 0, 0]],
        format: { numberFormat: 'M/d/yyyy' },
      }),
    );
    expect(result.propertyChanges).toEqual([formatChange]);
  });

  it.each([
    ['non-DATE formula', { kind: 'parse', text: '=SUM(1,2)' }, {}, 3],
    [
      'already formatted DATE formula',
      { kind: 'parse', text: '=DATE(2026,1,2)' },
      { numberFormat: '0.00' },
      46024,
    ],
    ['literal date string', { kind: 'parse', text: '1/2/2026' }, {}, 46024],
    ['apostrophe-prefixed text', { kind: 'parse', text: "'=DATE(2026,1,2)" }, {}, 46024],
    ['non-numeric DATE result', { kind: 'parse', text: '=DATE("bad",1,2)' }, {}, '#VALUE!'],
  ])('does not apply fallback for %s', async (_name, input, resolvedFormat, value) => {
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        if (command === 'compute_batch_set_cells_by_position') {
          return [new Uint8Array(), mutationResult()];
        }
        if (command === 'compute_get_resolved_format') {
          return resolvedFormat;
        }
        if (command === 'compute_get_cell_value') {
          return value;
        }
        if (command === 'compute_set_format_for_ranges') {
          throw new Error('fallback format write should not run');
        }
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const bridge = createStartedBridge(transport);

    await bridge.setCellsByPosition(sheetId('sheet-1'), [{ row: 0, col: 0, input: input as any }]);

    expect(transport.call).not.toHaveBeenCalledWith(
      'compute_set_format_for_ranges',
      expect.anything(),
    );
  });
});
