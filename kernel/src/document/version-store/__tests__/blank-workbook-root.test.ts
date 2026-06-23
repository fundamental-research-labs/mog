import { jest } from '@jest/globals';

import { BLANK_WORKBOOK_ROOT_GRAPH_ID, buildBlankWorkbookRootWrite } from '../blank-workbook-root';
import { decodeWorkbookSnapshotRootRecord } from '../snapshot-root-capture';
import type { VersionGraphNamespace } from '../object-store';
import type { VersionSemanticStateReaderPort } from '../semantic-state-reader';
import type { SemanticWorkbookStateEnvelope } from '../../../bridges/compute/compute-types.gen';

const NAMESPACE: VersionGraphNamespace = {
  documentId: 'blank-root-doc',
  graphId: BLANK_WORKBOOK_ROOT_GRAPH_ID,
};

const CREATED_AT = '2026-06-22T00:00:00.000Z';
const STATE_DIGEST = {
  algorithm: 'sha256' as const,
  digest: 'a'.repeat(64),
};

const SEMANTIC_STATE = {
  state: {
    schemaVersion: 'semantic-workbook-state.v1',
    domains: {},
    sheets: {
      'sheet-1': {
        name: 'Sheet1',
        index: 0,
      },
    },
  },
  stateDigest: STATE_DIGEST,
} as unknown as SemanticWorkbookStateEnvelope;

describe('blank workbook root initializer', () => {
  it('builds a system-authored zero-parent root from the current workbook state', async () => {
    const snapshotBytes = new Uint8Array([0x01, 0x02, 0x03]);
    const semanticStateReader: VersionSemanticStateReaderPort = {
      readCurrentSemanticState: jest.fn().mockResolvedValue(SEMANTIC_STATE as never),
      diffSemanticStates: jest.fn(),
    };

    const rootWrite = await buildBlankWorkbookRootWrite({
      namespace: NAMESPACE,
      snapshotRootByteSyncPort: {
        encodeDiff: jest.fn().mockResolvedValue(snapshotBytes as never),
      },
      semanticStateReader,
      createdAt: CREATED_AT,
    });

    expect(Array.from(decodeWorkbookSnapshotRootRecord(rootWrite.snapshotRootRecord))).toEqual([
      0x01, 0x02, 0x03,
    ]);
    expect(rootWrite.semanticChangeSetRecord.preimage.payload).toMatchObject({
      schemaVersion: 1,
      source: {
        kind: 'blankWorkbookRoot',
        semanticStateDigest: STATE_DIGEST,
      },
      semanticState: SEMANTIC_STATE,
      changes: [],
    });
    expect(rootWrite).toMatchObject({
      author: {
        authorId: 'mog.blank-workbook',
        actorKind: 'system',
        displayName: 'Mog Blank Workbook',
      },
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    });
    expect(rootWrite).not.toHaveProperty('mutationSegmentRecords');
  });
});
