import { expect } from '@jest/globals';

import type { SemanticWorkbookStateEnvelope } from '../../../bridges/compute/compute-types.gen';
import type { WorkbookCommit } from '../../../document/version-store/commit-store';
import {
  createInMemoryVersionGraphStore,
  type VersionGraphCommitRef,
  type VersionGraphRef,
} from '../../../document/version-store/graph';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
} from '../../../document/version-store/object-store';
import { captureWorkbookSnapshotRootRecord } from '../../../document/version-store/snapshot-root-capture';
import {
  buildXlsxVersionImportRootWrite,
  XLSX_IMPORT_ROOT_GRAPH_ID,
} from '../../../document/version-store/xlsx-import-root';
import { CREATED_AT } from './version-xlsx-external-change-branch-helpers-constants';
import { absentMetadataProvenance } from './version-xlsx-external-change-branch-helpers-provenance';
import {
  semanticStateReader,
  snapshotPort,
} from './version-xlsx-external-change-branch-helpers-state';

const TEST_AUTHOR = {
  authorId: 'test.local-edit',
  actorKind: 'user' as const,
  displayName: 'Local Edit',
};

export type XlsxExternalChangeBranchGraph = ReturnType<typeof createInMemoryVersionGraphStore>;

export function testNamespace(documentId: string): VersionGraphNamespace {
  return { documentId, graphId: XLSX_IMPORT_ROOT_GRAPH_ID };
}

export async function initializeExistingGraphFixture(input: {
  readonly documentId: string;
  readonly baseState: SemanticWorkbookStateEnvelope;
  readonly localState: SemanticWorkbookStateEnvelope;
  readonly localLabel: string;
}): Promise<{
  readonly namespace: VersionGraphNamespace;
  readonly graph: XlsxExternalChangeBranchGraph;
  readonly baseState: SemanticWorkbookStateEnvelope;
  readonly localState: SemanticWorkbookStateEnvelope;
  readonly baseCommit: WorkbookCommit;
  readonly baseHead: {
    readonly head: VersionGraphCommitRef;
    readonly main: VersionGraphRef;
  };
  readonly localCommit: WorkbookCommit;
}> {
  const namespace = testNamespace(input.documentId);
  const graph = createInMemoryVersionGraphStore({ namespace });
  const { baseCommit, baseHead } = await initializeImportRoot(graph, namespace, input.baseState);
  const localCommit = await commitMain({
    graph,
    namespace,
    head: baseHead,
    state: input.localState,
    label: input.localLabel,
  });

  return {
    namespace,
    graph,
    baseState: input.baseState,
    localState: input.localState,
    baseCommit,
    baseHead,
    localCommit,
  };
}

export async function initializeImportRoot(
  graph: XlsxExternalChangeBranchGraph,
  namespace: VersionGraphNamespace,
  state: SemanticWorkbookStateEnvelope,
): Promise<{
  readonly baseCommit: WorkbookCommit;
  readonly baseHead: {
    readonly head: VersionGraphCommitRef;
    readonly main: VersionGraphRef;
  };
}> {
  const rootWrite = await buildXlsxVersionImportRootWrite({
    namespace,
    snapshotRootByteSyncPort: snapshotPort(0x11),
    semanticStateReader: semanticStateReader(state, state),
    provenance: absentMetadataProvenance(128),
    createdAt: CREATED_AT,
  });
  const initialized = await graph.initializeGraph(rootWrite);
  expect(initialized.status).toBe('success');
  if (initialized.status !== 'success') {
    throw new Error(`expected graph initialize success: ${initialized.diagnostics[0]?.code}`);
  }
  const head = await graph.readHead();
  expect(head.status).toBe('success');
  if (head.status !== 'success') {
    throw new Error(`expected graph head success: ${head.diagnostics[0]?.code}`);
  }
  const baseCommit = await graph.readCommit(head.head.id);
  expect(baseCommit.status).toBe('success');
  if (baseCommit.status !== 'success') {
    throw new Error(`expected root commit success: ${baseCommit.diagnostics[0]?.code}`);
  }
  return { baseCommit: baseCommit.commit, baseHead: { head: head.head, main: head.main } };
}

export async function commitMain(input: {
  readonly graph: XlsxExternalChangeBranchGraph;
  readonly namespace: VersionGraphNamespace;
  readonly head: {
    readonly head: VersionGraphCommitRef;
    readonly main: VersionGraphRef;
  };
  readonly state: SemanticWorkbookStateEnvelope;
  readonly label: string;
}): Promise<WorkbookCommit> {
  const snapshotRootRecord = await captureWorkbookSnapshotRootRecord(
    input.namespace,
    snapshotPort(0x21),
  );
  const semanticChangeSetRecord = await createVersionObjectRecord(input.namespace, {
    objectType: 'workbook.semanticChangeSet.v1',
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload: {
      schemaVersion: 1,
      source: {
        kind: 'testLocalCommit',
        label: input.label,
        semanticStateDigest: input.state.stateDigest,
      },
      semanticState: input.state,
      changes: [],
    },
  });
  const committed = await input.graph.commit({
    snapshotRootRecord,
    semanticChangeSetRecord,
    author: TEST_AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
    expectedHeadCommitId: input.head.head.id,
    expectedMainRefVersion: input.head.main.revision,
  });
  expect(committed.status).toBe('success');
  if (committed.status !== 'success') {
    throw new Error(`expected local commit success: ${committed.diagnostics[0]?.code}`);
  }
  return committed.commit;
}
