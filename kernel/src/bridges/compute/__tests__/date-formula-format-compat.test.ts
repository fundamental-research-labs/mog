import { jest } from '@jest/globals';

(globalThis as any).window = {};

import type { BridgeTransport } from '@rust-bridge/client';
import { sheetId } from '@mog-sdk/contracts/core';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

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

function createStartedBridge(
  transport: BridgeTransport & { call: jest.Mock },
  ctx: IKernelContext = makeMockContext(),
): ComputeBridge {
  const bridge = new ComputeBridge(ctx, 'test-doc', transport);
  (bridge as any).core._phase = 'STARTED';
  return bridge;
}

function operationContext(operationId: string): VersionOperationContext {
  return {
    operationId,
    kind: 'mutation',
    author: { authorId: 'user-1', actorKind: 'user' },
    createdAt: '2026-06-20T00:00:00.000Z',
    sheetIds: ['sheet-1'],
    domainIds: ['cells'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
  };
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
        if (command === 'compute_get_table_at_cell') {
          return null;
        }
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

    const result = await bridge.setCellsByPosition(
      sheetId('sheet-1'),
      [{ row: 0, col: 0, input: { kind: 'parse', text: '=DATE(2026,1,2)' } }],
      { operationContext: operationContext('operation-date-format') },
    );

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
        if (command === 'compute_get_table_at_cell') {
          return null;
        }
        if (command === 'compute_batch_set_cells_by_position') {
          return [new Uint8Array(), mutationResult()];
        }
        if (command === 'compute_get_range_schemas_for_sheet') {
          return [];
        }
        if (command === 'compute_get_all_column_schemas') {
          return [];
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

    await bridge.setCellsByPosition(sheetId('sheet-1'), [{ row: 0, col: 0, input: input as any }], {
      operationContext: operationContext(`operation-${_name}`),
    });

    expect(transport.call).not.toHaveBeenCalledWith(
      'compute_set_format_for_ranges',
      expect.anything(),
    );
  });
});

describe('ComputeBridge table header writes', () => {
  it('routes single-cell writes to visible table headers through table column rename with version context', async () => {
    const capture = {
      recordPreMutation: jest.fn(async () => undefined),
      recordMutationResult: jest.fn(),
    };
    const ctx = {
      ...makeMockContext(),
      versioning: { mutationCapture: capture },
    } as any;
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        if (command === 'compute_get_table_at_cell') {
          return {
            id: 'Table2',
            name: 'Table2',
            sheetId: 'sheet-1',
            range: { startRow: 0, startCol: 3, endRow: 2, endCol: 4 },
            hasHeaderRow: true,
            hasTotalsRow: false,
            columns: [
              { id: 'col-1', name: 'Region', index: 0 },
              { id: 'col-2', name: 'Revenue', index: 1 },
            ],
            style: 'TableStyleMedium2',
            bandedRows: true,
            bandedColumns: false,
            emphasizeFirstColumn: false,
            emphasizeLastColumn: false,
            showFilterButtons: true,
            autoExpand: true,
            autoCalculatedColumns: true,
          };
        }
        if (command === 'compute_rename_table_column') {
          return [new Uint8Array(), mutationResult()];
        }
        if (command === 'compute_batch_set_cells_by_position') {
          throw new Error('header writes should not use cell batch writer');
        }
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const bridge = createStartedBridge(transport, ctx);
    const options = { operationContext: operationContext('operation-table-header') };

    await bridge.setCellsByPosition(
      sheetId('sheet-1'),
      [{ row: 0, col: 3, input: { kind: 'parse', text: 'Area' } }],
      options,
    );

    expect(transport.call).toHaveBeenCalledWith(
      'compute_rename_table_column',
      expect.objectContaining({
        tableName: 'Table2',
        columnIndex: 0,
        newColumnName: 'Area',
      }),
    );
    expect(capture.recordPreMutation).toHaveBeenCalledWith({
      operation: 'compute_rename_table_column',
      operationContext: options.operationContext,
    });
    expect(capture.recordMutationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'compute_rename_table_column',
        operationContext: options.operationContext,
      }),
    );
  });

  it('routes parsed single-cell header writes through table column rename', async () => {
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        if (command === 'compute_get_table_at_cell') {
          return {
            id: 'Table2',
            name: 'Table2',
            sheetId: 'sheet-1',
            range: { startRow: 0, startCol: 3, endRow: 2, endCol: 4 },
            hasHeaderRow: true,
            hasTotalsRow: false,
            columns: [
              { id: 'col-1', name: 'Region', index: 0 },
              { id: 'col-2', name: 'Revenue', index: 1 },
            ],
            style: 'TableStyleMedium2',
            bandedRows: true,
            bandedColumns: false,
            emphasizeFirstColumn: false,
            emphasizeLastColumn: false,
            showFilterButtons: true,
            autoExpand: true,
            autoCalculatedColumns: true,
          };
        }
        if (command === 'compute_rename_table_column') {
          return [new Uint8Array(), mutationResult()];
        }
        if (command === 'compute_set_cell_value_parsed') {
          throw new Error('header writes should not use parsed cell writer');
        }
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const bridge = createStartedBridge(transport);

    await bridge.setCellValueParsed(sheetId('sheet-1'), 0, 3, 'Area');

    expect(transport.call).toHaveBeenCalledWith(
      'compute_rename_table_column',
      expect.objectContaining({
        tableName: 'Table2',
        columnIndex: 0,
        newColumnName: 'Area',
      }),
    );
  });
});
