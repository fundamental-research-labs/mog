import { jest } from '@jest/globals';

import type {
  ObjectDigest,
  SemanticWorkbookDiff,
  SemanticWorkbookState,
} from '../../../bridges/compute/compute-types.gen';
import { createComputeBridgeSemanticStateReader } from '../semantic-state-reader';

describe('createComputeBridgeSemanticStateReader', () => {
  it('attaches shallow sheet record evidence to Rust sheet semantic changes', async () => {
    const before = semanticState();
    const after = semanticState({
      'sheet-2': {
        sheetId: 'sheet-2',
        name: 'Sheet 2',
        rowCount: 1000,
        columnCount: 26,
        rows: {},
        columns: {},
        cells: {},
      },
    });
    const objectId = 'sheet:sheet-2';
    const diff: SemanticWorkbookDiff = {
      beforeDigest: digest('before'),
      afterDigest: digest('after'),
      changes: [
        {
          changeId: 'added:sheet:sheet-2',
          kind: 'added',
          domainId: 'sheets',
          objectId,
          objectKind: 'sheet',
        },
      ],
    };
    const reader = createComputeBridgeSemanticStateReader({
      semanticWorkbookStateEnvelope: jest.fn(async () => ({
        state: after,
        stateDigest: digest('after'),
      })),
      diffSemanticWorkbookStates: jest.fn(async () => diff),
    });

    const result = await reader.diffSemanticStates(before, after);

    expect(result.changes[0]?.afterRecord).toEqual({
      objectId,
      objectKind: 'sheet',
      domainId: 'sheets',
      sheetId: 'sheet-2',
      sheetName: 'Sheet 2',
      record: {
        sheetId: 'sheet-2',
        name: 'Sheet 2',
      },
    });
    expect(result.changes[0]?.beforeRecord).toBeUndefined();
  });

  it('attaches direct-format record evidence to Rust format semantic changes', async () => {
    const before = semanticState({
      'sheet#0': sheetState({
        cells: {
          'cell:sheet#0:r2:c1': {
            objectId: 'cell:sheet#0:r2:c1',
            sheetId: 'sheet#0',
            row: 2,
            column: 1,
          },
        },
      }),
    });
    const after = semanticState({
      'sheet#0': sheetState({
        cells: {
          'cell:sheet#0:r2:c1': {
            objectId: 'cell:sheet#0:r2:c1',
            sheetId: 'sheet#0',
            row: 2,
            column: 1,
            directFormat: {
              properties: {
                numberFormat: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)',
              },
            },
          },
        },
      }),
    });
    const objectId = 'direct-format:cell:sheet#0:r2:c1';
    const diff: SemanticWorkbookDiff = {
      beforeDigest: digest('before'),
      afterDigest: digest('after'),
      changes: [
        {
          changeId: 'added:direct-format:cell:sheet#0:r2:c1',
          kind: 'added',
          domainId: 'cells.formats.direct',
          objectId,
          objectKind: 'direct-format',
        },
      ],
    };
    const reader = createComputeBridgeSemanticStateReader({
      semanticWorkbookStateEnvelope: jest.fn(async () => ({
        state: after,
        stateDigest: digest('after'),
      })),
      diffSemanticWorkbookStates: jest.fn(async () => diff),
    });

    const result = await reader.diffSemanticStates(before, after);

    expect(result.changes[0]?.afterRecord).toEqual({
      objectId,
      objectKind: 'direct-format',
      domainId: 'cells.formats.direct',
      sheetId: 'sheet#0',
      sheetName: 'Sheet 1',
      record: {
        properties: {
          numberFormat: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)',
        },
      },
    });
    expect(result.changes[0]?.beforeRecord).toBeUndefined();
  });

  it('attaches sheet display metadata to Rust cell-value semantic changes', async () => {
    const after = semanticState({
      'sheet-north': sheetState({
        sheetId: 'sheet-north',
        name: 'North',
        cells: {
          'cell:sheet-north:r0:c0': {
            objectId: 'cell:sheet-north:r0:c0',
            sheetId: 'sheet-north',
            row: 0,
            column: 0,
            value: {
              valueKind: 'number',
              canonicalValue: 10,
            },
          },
        },
      }),
    });
    const objectId = 'value:cell:sheet-north:r0:c0';
    const diff: SemanticWorkbookDiff = {
      beforeDigest: digest('before'),
      afterDigest: digest('after'),
      changes: [
        {
          changeId: 'added:value:cell:sheet-north:r0:c0',
          kind: 'added',
          domainId: 'cells.values',
          objectId,
          objectKind: 'cell-value',
        },
      ],
    };
    const reader = createComputeBridgeSemanticStateReader({
      semanticWorkbookStateEnvelope: jest.fn(async () => ({
        state: after,
        stateDigest: digest('after'),
      })),
      diffSemanticWorkbookStates: jest.fn(async () => diff),
    });

    const result = await reader.diffSemanticStates(semanticState(), after);

    expect(result.changes[0]?.afterRecord).toMatchObject({
      objectId,
      objectKind: 'cell-value',
      domainId: 'cells.values',
      sheetId: 'sheet-north',
      sheetName: 'North',
      record: {
        valueKind: 'number',
        canonicalValue: 10,
      },
    });
  });
});

function semanticState(sheets: SemanticWorkbookState['sheets'] = {}): SemanticWorkbookState {
  return {
    schemaVersion: '1',
    domains: {},
    sheets,
  };
}

function sheetState(
  overrides: Partial<SemanticWorkbookState['sheets'][string]> = {},
): SemanticWorkbookState['sheets'][string] {
  return {
    sheetId: 'sheet#0',
    name: 'Sheet 1',
    rowCount: 1000,
    columnCount: 26,
    rows: {},
    columns: {},
    cells: {},
    ...overrides,
  };
}

function digest(value: string): ObjectDigest {
  return {
    algorithm: 'sha256',
    value,
  };
}
