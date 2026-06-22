import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createVersionObjectRecord, type VersionGraphNamespace } from './object-store';
import type { VersionGraphInitializeInput } from './provider';
import {
  captureWorkbookSnapshotRootRecord,
  type SnapshotRootByteSyncPort,
} from './snapshot-root-capture';
import type { VersionSemanticStateReaderPort } from './semantic-state-reader';

export const BLANK_WORKBOOK_ROOT_GRAPH_ID = 'blank-workbook-root';

const BLANK_WORKBOOK_ROOT_AUTHOR: VersionAuthor = {
  authorId: 'mog.blank-workbook',
  actorKind: 'system',
  displayName: 'Mog Blank Workbook',
};

export async function buildBlankWorkbookRootWrite(input: {
  readonly namespace: VersionGraphNamespace;
  readonly snapshotRootByteSyncPort: SnapshotRootByteSyncPort;
  readonly semanticStateReader: VersionSemanticStateReaderPort;
  readonly createdAt: string;
}): Promise<VersionGraphInitializeInput['rootWrite']> {
  const [snapshotRootRecord, semanticState] = await Promise.all([
    captureWorkbookSnapshotRootRecord(input.namespace, input.snapshotRootByteSyncPort),
    input.semanticStateReader.readCurrentSemanticState(),
  ]);
  const semanticChangeSetRecord = await createVersionObjectRecord(input.namespace, {
    objectType: 'workbook.semanticChangeSet.v1',
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload: {
      schemaVersion: 1,
      source: {
        kind: 'blankWorkbookRoot',
        semanticStateDigest: semanticState.stateDigest,
      },
      semanticState,
      changes: [],
    },
  });

  return {
    snapshotRootRecord,
    semanticChangeSetRecord,
    author: BLANK_WORKBOOK_ROOT_AUTHOR,
    createdAt: input.createdAt,
    completenessDiagnostics: [],
  };
}
