import type { ReservePendingRemoteSegmentInput } from '../pending-remote-segment-store';
import type { VersionGraphNamespace } from '../object-store';
import {
  namespaceForDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphStore,
} from '../provider';
import { AUTHOR, DOCUMENT_SCOPE } from './pending-remote-segment-store-fixtures-constants';
import { objectRecord } from './pending-remote-segment-store-fixtures-objects';

export async function initializeProvider(provider: {
  initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult>;
}): Promise<VersionGraphNamespace> {
  const input = await initializeInput('graph-1');
  const initialized = await provider.initializeGraph(input);
  expect(initialized.status).toBe('success');
  if (initialized.status !== 'success') {
    throw new Error(`expected initialize success: ${initialized.diagnostics[0]?.code}`);
  }
  return namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
}

export async function expectReadHeadSuccess(graph: VersionGraphStore) {
  const result = await graph.readHead();
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readHead success: ${result.diagnostics[0]?.code}`);
  }
  return {
    headId: result.head.id,
    mainRevision: result.main.revision,
  };
}

export async function expectGraphHeadUnchanged(
  graph: VersionGraphStore,
  expected: Awaited<ReturnType<typeof expectReadHeadSuccess>>,
): Promise<void> {
  await expect(expectReadHeadSuccess(graph)).resolves.toEqual(expected);
}

export async function expectPersistedPendingObjects(
  graph: VersionGraphStore,
  input: ReservePendingRemoteSegmentInput,
): Promise<void> {
  await expect(
    graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.mutationSegment.v1',
      digest: input.mutationSegmentDigest,
    }),
  ).resolves.toMatchObject({
    digest: input.mutationSegmentDigest,
    preimage: { objectType: 'workbook.mutationSegment.v1' },
  });
  if (input.snapshotRootDigest !== undefined) {
    await expect(
      graph.getObjectRecord({
        kind: 'object',
        objectType: 'workbook.snapshotRoot.v1',
        digest: input.snapshotRootDigest,
      }),
    ).resolves.toMatchObject({
      digest: input.snapshotRootDigest,
      preimage: { objectType: 'workbook.snapshotRoot.v1' },
    });
  }
  if (input.semanticChangeSetDigest === undefined) return;
  await expect(
    graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: input.semanticChangeSetDigest,
    }),
  ).resolves.toMatchObject({
    digest: input.semanticChangeSetDigest,
    preimage: { objectType: 'workbook.semanticChangeSet.v1' },
  });
}

async function initializeInput(graphId: string): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(
        'workbook.snapshotRoot.v1',
        { label: 'root', sheets: [] },
        namespace,
      ),
      semanticChangeSetRecord: await objectRecord(
        'workbook.semanticChangeSet.v1',
        { label: 'root', changes: [] },
        namespace,
      ),
      author: AUTHOR,
      createdAt: '2026-06-20T00:00:00.000Z',
      completenessDiagnostics: [],
    },
  };
}
