import type { WorkbookCommitId } from '@mog-sdk/contracts/api';
import type { TrustedExportSeed } from './version-xlsx-reimport-trust-workbook-types';

import { createVersionObjectRecord } from '../../../document/version-store/object-store';
import { captureWorkbookSnapshotRootRecord } from '../../../document/version-store/snapshot-root-capture';
import { DOCUMENT_ID, WORKSPACE_ID } from './version-xlsx-reimport-trust-constants';
import { openIndexedDbGraph } from './version-xlsx-reimport-trust-version-store';

export async function advanceLocalHead(seed: TrustedExportSeed): Promise<WorkbookCommitId> {
  const { provider, graph, namespace } = await openIndexedDbGraph(DOCUMENT_ID, WORKSPACE_ID);
  try {
    const head = await graph.readHead();
    expect(head.status).toBe('success');
    if (head.status !== 'success') throw new Error(`expected local graph head`);
    expect(head.head.id).toBe(seed.rootCommitId);

    const semanticState = localAdvanceSemanticState();
    const snapshotRootRecord = await captureWorkbookSnapshotRootRecord(namespace, {
      encodeDiff: async () => new Uint8Array([0x51, 0x52, 0x53]),
    });
    const semanticChangeSetRecord = await createVersionObjectRecord(namespace, {
      objectType: 'workbook.semanticChangeSet.v1',
      schemaVersion: 1,
      payloadEncoding: 'mog-canonical-json-v1',
      dependencies: [],
      payload: {
        schemaVersion: 1,
        source: {
          kind: 'testLocalAdvance',
          semanticStateDigest: semanticState.stateDigest,
        },
        semanticState,
        changes: [],
      },
    });

    const committed = await graph.commit({
      snapshotRootRecord,
      semanticChangeSetRecord,
      author: {
        authorId: 'test.local-advance',
        actorKind: 'user',
        displayName: 'Local Advance',
      },
      createdAt: '2026-06-23T00:00:00.000Z',
      completenessDiagnostics: [],
      expectedHeadCommitId: head.head.id,
      expectedMainRefVersion: head.main.revision,
    });
    expect(committed.status).toBe('success');
    if (committed.status !== 'success') {
      throw new Error(`expected local advance commit: ${committed.diagnostics[0]?.code}`);
    }
    return committed.commit.id;
  } finally {
    await provider.close('test-teardown').catch(() => {});
  }
}

function localAdvanceSemanticState() {
  return {
    state: {
      schemaVersion: 'semantic-workbook-state.v1',
      workbookId: 'local-advance',
      domains: {},
      sheets: {},
    },
    stateDigest: {
      algorithm: 'sha256',
      value: 'localadvance'.repeat(6).slice(0, 64),
    },
  };
}
