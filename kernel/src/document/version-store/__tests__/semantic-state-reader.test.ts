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
      record: {
        sheetId: 'sheet-2',
        name: 'Sheet 2',
      },
    });
    expect(result.changes[0]?.beforeRecord).toBeUndefined();
  });
});

function semanticState(
  sheets: SemanticWorkbookState['sheets'] = {},
): SemanticWorkbookState {
  return {
    schemaVersion: '1',
    domains: {},
    sheets,
  };
}

function digest(value: string): ObjectDigest {
  return {
    algorithm: 'sha256',
    value,
  };
}
