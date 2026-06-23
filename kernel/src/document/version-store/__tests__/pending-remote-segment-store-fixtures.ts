import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  type PendingRemoteSegmentOperationContext,
  type ReservePendingRemoteSegmentInput,
} from '../pending-remote-segment-store';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType, WorkbookCommitId } from '../object-digest';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphStore,
} from '../provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export const PROMOTED_COMMIT = `commit:sha256:${'4'.repeat(64)}` as WorkbookCommitId;

export type PendingSegmentFixture = {
  readonly input: ReservePendingRemoteSegmentInput;
  readonly objectRecords: readonly VersionObjectRecord<unknown>[];
};

export async function pendingSegmentFixture(
  namespace: VersionGraphNamespace,
  options: {
    readonly createdAt?: string;
    readonly includeSnapshotRoot?: boolean;
    readonly payloadHash?: string;
    readonly updateId?: string;
  } = {},
): Promise<PendingSegmentFixture> {
  const operationContext = syncOperationContext({
    payloadHash: options.payloadHash,
    updateId: options.updateId,
  });
  const keys = await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext);
  const snapshotRootRecord = await objectRecord(
    'workbook.snapshotRoot.v1',
    { snapshotId: 'remote-boundary-snapshot-1', sheets: [] },
    namespace,
  );
  const semanticChangeSetRecord = await objectRecord(
    'workbook.semanticChangeSet.v1',
    { schemaVersion: 1, changes: [] },
    namespace,
  );
  const mutationSegmentRecord = await objectRecord(
    'workbook.mutationSegment.v1',
    { segmentId: 'remote-segment-1', domainId: 'runtime-diagnostics' },
    namespace,
  );
  return {
    input: {
      pendingRemoteSegmentId: keys.pendingRemoteSegmentId,
      idempotencyKey: keys.idempotencyKey,
      operationContext,
      mutationSegmentDigest: mutationSegmentRecord.digest,
      ...(options.includeSnapshotRoot ? { snapshotRootDigest: snapshotRootRecord.digest } : {}),
      semanticChangeSetDigest: semanticChangeSetRecord.digest,
      createdAt: options.createdAt ?? '2026-06-21T00:00:00.000Z',
    },
    objectRecords: [
      ...(options.includeSnapshotRoot ? [snapshotRootRecord] : []),
      semanticChangeSetRecord,
      mutationSegmentRecord,
    ],
  };
}

export function syncOperationContext(
  options: {
    readonly createdAt?: string;
    readonly updateId?: string;
    readonly payloadHash?: string;
  } = {},
): PendingRemoteSegmentOperationContext {
  const updateId = options.updateId ?? 'remote-update-1';
  const payloadHash = options.payloadHash ?? '3'.repeat(64);
  return {
    operationId: `sync:providerLiveInbound:${updateId}`,
    kind: 'sync-import',
    author: {
      authorId: 'subject-ref-1',
      actorKind: 'user',
      sessionId: 'remote-session-1',
    },
    createdAt: options.createdAt ?? '2026-06-21T00:00:01.000Z',
    workbookId: DOCUMENT_SCOPE.documentId,
    domainIds: ['runtime-diagnostics'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    collaboration: {
      sourceKind: 'providerLiveInbound',
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-1',
      authorityRef: 'authority-1',
      roomId: 'room-1',
      epoch: 'epoch-1',
      updateId,
      sequence: '7',
      payloadHash,
      trustStatus: 'verified',
      authorState: 'singleRemote',
      remoteSessionId: 'remote-session-1',
      correlationId: 'correlation-1',
      causationIds: ['cause-1'],
      replay: false,
      system: false,
      commitGrouping: 'pendingRemote',
      validationDiagnosticCount: 0,
    },
  };
}

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

export async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
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
