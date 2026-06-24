import type {
  ObjectDigest,
  SemanticWorkbookDiff,
  SemanticWorkbookState,
  SemanticWorkbookStateEnvelope,
} from '../../../bridges/compute/compute-types.gen';
import { buildRustBackedSemanticChangeSetPayload } from '../semantic-mutation-rust-diff-capture';
import { captureInput } from './semantic-mutation-capture-test-helpers';

const BEFORE_DIGEST = digest('1');
const AFTER_DIGEST = digest('2');
const CELL_BEFORE_DIGEST = digest('3');
const CELL_AFTER_DIGEST = digest('4');

describe('Rust-backed semantic mutation capture', () => {
  it('rejects review-projected changes when no Rust semantic reader is available', async () => {
    const result = await buildRustBackedSemanticChangeSetPayload({
      commit: captureInput(),
      reviewChanges: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:cell:0',
            domain: 'cell',
            entityId: 'sheet-1!A1',
            propertyPath: ['value'],
          },
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'failed',
      diagnostics: [expect.objectContaining({ code: 'VERSION_MISSING_CHANGE_SET' })],
    });
  });

  it('preserves semantic diff diagnostics without rejecting normal commit capture', async () => {
    const before = semanticState('alpha');
    const after = semanticState('beta');
    const semanticDiff: SemanticWorkbookDiff = {
      beforeDigest: BEFORE_DIGEST,
      afterDigest: AFTER_DIGEST,
      changes: [
        {
          changeId: 'updated:cell:sheet#0:r0:c0',
          kind: 'updated',
          domainId: 'cells.values',
          objectId: 'cell:sheet#0:r0:c0',
          objectKind: 'cell',
          beforeDigest: CELL_BEFORE_DIGEST,
          afterDigest: CELL_AFTER_DIGEST,
        },
      ],
      diagnostics: [
        {
          severity: 'error',
          code: 'VERSIONING_OPAQUE_BLOCKING_DOMAIN',
          domainId: 'unsupported-cell-values',
          domainClass: 'authored',
          capabilityState: 'opaque-blocking',
          status: 'opaque-blocking',
          message: 'opaque sidecar changed during a snapshot-backed normal commit',
          objectIds: ['cell:sheet#0:r1:c1:unsupported'],
        },
      ],
    };

    const result = await buildRustBackedSemanticChangeSetPayload({
      commit: captureInput(),
      semanticStateReader: {
        readCurrentSemanticState: async () => envelope(after, AFTER_DIGEST),
        diffSemanticStates: async () => semanticDiff,
      },
      beforeSemanticState: envelope(before, BEFORE_DIGEST),
      reviewChanges: [],
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error(`expected success: ${result.diagnostics[0]?.code}`);
    }
    expect(result.payload).toMatchObject({
      schemaVersion: 1,
      source: {
        kind: 'rustSemanticDiff',
        beforeStateDigest: BEFORE_DIGEST,
        afterStateDigest: AFTER_DIGEST,
      },
      changes: semanticDiff.changes,
      semanticDiff,
    });
  });
});

function semanticState(value: string): SemanticWorkbookState {
  return {
    schemaVersion: 'semantic-workbook-state.v1',
    workbookId: 'wb-1',
    domains: {
      'cells.values': {
        domainId: 'cells.values',
        domainClass: 'authored',
        capabilityState: 'supported',
      },
    },
    sheets: {
      'sheet#0': {
        sheetId: 'sheet#0',
        name: 'Sheet1',
        rowCount: 1,
        columnCount: 1,
        rows: {},
        columns: {},
        cells: {
          'cell:sheet#0:r0:c0': {
            objectId: 'cell:sheet#0:r0:c0',
            sheetId: 'sheet#0',
            row: 0,
            column: 0,
            value: {
              valueKind: 'string',
              canonicalValue: value,
            },
          },
        },
      },
    },
  };
}

function envelope(
  state: SemanticWorkbookState,
  stateDigest: ObjectDigest,
): SemanticWorkbookStateEnvelope {
  return { state, stateDigest };
}

function digest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}
