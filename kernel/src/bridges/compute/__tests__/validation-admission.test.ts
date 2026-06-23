import { jest } from '@jest/globals';

(globalThis as any).window = {};

import type { BridgeTransport } from '@rust-bridge/client';
import { sheetId } from '@mog-sdk/contracts/core';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';

import { ComputeBridge } from '../compute-bridge';
import type { MutationResult, RangeSchema } from '../compute-types.gen';
import type { MutationAdmissionOptions } from '../mutation-admission';

const SHEET_ID = sheetId('sheet-1');

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
  (bridge as any).core.engineCreated = true;
  return bridge;
}

function mutationOptions(operationId: string): MutationAdmissionOptions {
  return {
    operationContext: {
      operationId,
      kind: 'mutation',
      author: { authorId: 'user-1', actorKind: 'user' },
      createdAt: '2026-06-20T00:00:00.000Z',
      sheetIds: [SHEET_ID],
      domainIds: ['cells'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    },
  };
}

function listValidation(overrides: Partial<RangeSchema> = {}): RangeSchema {
  return {
    id: 'dv-1',
    createdAt: 1,
    ranges: [{ startId: '0:0', endId: '0:0' }],
    schema: { constraints: { enum: ['Base', 'Bull', 'Bear'] } as any },
    enforcement: 'strict',
    ...overrides,
  };
}

function tableAtHeader() {
  return {
    id: 'Table2',
    name: 'Table2',
    sheetId: SHEET_ID,
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

describe('ComputeBridge validation admission', () => {
  it('rejects invalid strict validation writes before mutating transport', async () => {
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        if (command === 'compute_get_table_at_cell') return null;
        if (command === 'compute_get_range_schemas_for_sheet') return [listValidation()];
        if (command === 'compute_get_all_column_schemas') return [];
        if (command === 'compute_validate_cell_value') {
          return {
            valid: false,
            errorMessage: 'Value is not in allowed values',
            enforcement: 'strict',
          };
        }
        if (command === 'compute_batch_set_cells_by_position') {
          throw new Error('strict validation failure should not mutate');
        }
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const bridge = createStartedBridge(transport);

    await expect(
      bridge.setCellsByPosition(SHEET_ID, [
        { row: 0, col: 0, input: { kind: 'parse', text: 'Upside+' } },
      ]),
    ).rejects.toMatchObject({
      code: 'API_INVALID_ARGUMENT',
      message: 'Value is not in allowed values',
    });

    expect(transport.call).not.toHaveBeenCalledWith(
      'compute_batch_set_cells_by_position',
      expect.anything(),
    );
  });

  it('allows invalid warning validation writes to reach the normal mutation path', async () => {
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        if (command === 'compute_get_table_at_cell') return null;
        if (command === 'compute_get_range_schemas_for_sheet') {
          return [listValidation({ enforcement: 'warning' })];
        }
        if (command === 'compute_get_all_column_schemas') return [];
        if (command === 'compute_validate_cell_value') {
          return { valid: false, errorMessage: 'warning only', enforcement: 'warning' };
        }
        if (command === 'compute_batch_set_cells_by_position') {
          return [new Uint8Array(), mutationResult()];
        }
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const bridge = createStartedBridge(transport);

    await bridge.setCellsByPosition(
      SHEET_ID,
      [{ row: 0, col: 0, input: { kind: 'parse', text: 'Upside+' } }],
      mutationOptions('validation-warning-write'),
    );

    expect(transport.call).toHaveBeenCalledWith(
      'compute_batch_set_cells_by_position',
      expect.objectContaining({ docId: 'test-doc' }),
    );
  });

  it('validates duplicate coordinates with last-write-wins semantics', async () => {
    const validatedValues: string[] = [];
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string, payload: any) => {
        if (command === 'compute_get_all_tables_in_sheet') return [];
        if (command === 'compute_get_range_schemas_for_sheet') return [listValidation()];
        if (command === 'compute_get_all_column_schemas') return [];
        if (command === 'compute_validate_cell_value') {
          validatedValues.push(payload.value);
          return { valid: payload.value === 'Base', enforcement: 'strict' };
        }
        if (command === 'compute_batch_set_cells_by_position') {
          return [new Uint8Array(), mutationResult()];
        }
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const bridge = createStartedBridge(transport);

    await bridge.setCellsByPosition(
      SHEET_ID,
      [
        { row: 0, col: 0, input: { kind: 'parse', text: 'Upside+' } },
        { row: 0, col: 0, input: { kind: 'parse', text: 'Base' } },
      ],
      mutationOptions('validation-duplicate-write'),
    );

    expect(validatedValues).toEqual(['Base']);
    expect(transport.call).toHaveBeenCalledWith(
      'compute_batch_set_cells_by_position',
      expect.objectContaining({ docId: 'test-doc' }),
    );
  });

  it('does not apply split table-header renames when a normal edit fails strict validation', async () => {
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        if (command === 'compute_get_all_tables_in_sheet') return [tableAtHeader()];
        if (command === 'compute_get_range_schemas_for_sheet') {
          return [listValidation({ ranges: [{ startId: '1:1', endId: '1:1' }] })];
        }
        if (command === 'compute_get_all_column_schemas') return [];
        if (command === 'compute_validate_cell_value') {
          return { valid: false, errorMessage: 'blocked', enforcement: 'strict' };
        }
        if (command === 'compute_rename_table_column') {
          throw new Error('header rename should not run after validation failure');
        }
        if (command === 'compute_batch_set_cells_by_position') {
          throw new Error('strict validation failure should not mutate');
        }
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const bridge = createStartedBridge(transport);

    await expect(
      bridge.setCellsByPosition(SHEET_ID, [
        { row: 0, col: 3, input: { kind: 'parse', text: 'Area' } },
        { row: 1, col: 1, input: { kind: 'parse', text: 'Upside+' } },
      ]),
    ).rejects.toMatchObject({ code: 'API_INVALID_ARGUMENT' });

    expect(transport.call).not.toHaveBeenCalledWith(
      'compute_rename_table_column',
      expect.anything(),
    );
  });
});
