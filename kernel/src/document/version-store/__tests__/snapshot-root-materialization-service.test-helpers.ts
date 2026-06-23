import type { Workbook } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
import { jest } from '@jest/globals';

import { DocumentFactory } from '../../../api/document/document-factory';
import {
  createDocumentLifecycleSnapshotRootHydrator,
  type SnapshotRootFreshLifecycleMaterialization,
} from '../../../api/document/snapshot-root-lifecycle-hydrator';
import type { DocumentHandleInternal } from '../../../api/document/document-handle-types';
import type { VersionObjectType } from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../provider';
import {
  createWorkbookSnapshotRootRecord,
  createYrsFullStateSnapshotRootPayload,
} from '../snapshot-root-capture';
import {
  createSnapshotRootMaterializationService,
  type SnapshotRootMaterializationResult,
} from '../snapshot-root-materialization-service';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

export const CREATED_AT = '2026-06-20T00:00:00.000Z';

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export async function materializeAuthoredWorkbook<TArtifacts>(options: {
  readonly sourceDocumentId: string;
  readonly materializedDocumentId: string;
  readonly graphId?: string;
  readonly author: (workbook: Workbook) => Promise<TArtifacts>;
}) {
  const graphId = options.graphId ?? 'graph-1';
  const sourceHandle = await DocumentFactory.create({
    documentId: options.sourceDocumentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  let materialized: SnapshotRootFreshLifecycleMaterialization | undefined;

  try {
    const sourceWorkbook = await sourceHandle.workbook();
    const artifacts = await options.author(sourceWorkbook);
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
    const snapshotRootPayload = createYrsFullStateSnapshotRootPayload(
      await (sourceHandle as DocumentHandleInternal)
        .createSyncPort()
        .encodeDiff(new Uint8Array([0])),
    );
    const snapshotRootRecord = await createWorkbookSnapshotRootRecord(
      namespace,
      snapshotRootPayload,
    );
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await initializeGraphWithSnapshotRoot(
      provider,
      namespace,
      snapshotRootRecord,
    );

    const lifecycleHydrator = createDocumentLifecycleSnapshotRootHydrator({
      userTimezone: 'UTC',
      documentIdFactory: () => options.materializedDocumentId,
    });
    const hydrateYrsFullState = jest.fn(
      lifecycleHydrator.hydrateYrsFullState.bind(lifecycleHydrator),
    );
    const service = createSnapshotRootMaterializationService({
      provider,
      hydrator: { hydrateYrsFullState },
    });

    const result = await service.materializeSnapshotRoot({ target: 'ref', refName: 'main' });
    expectMaterializationSuccess(result);
    materialized = result.materialized;

    return Object.freeze({
      sourceHandle,
      sourceWorkbook,
      artifacts,
      provider,
      initialized,
      snapshotRootPayload,
      snapshotRootRecord,
      hydrateYrsFullState,
      result,
      materialized,
      dispose: async () => {
        await materialized?.dispose();
        await sourceHandle.dispose();
      },
    });
  } catch (error) {
    if (materialized) await materialized.dispose();
    await sourceHandle.dispose();
    throw error;
  }
}

export async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

export async function initializeGraphWithSnapshotRoot(
  provider: {
    initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult>;
  },
  namespace: VersionGraphNamespace,
  snapshotRootRecord: VersionObjectRecord<unknown>,
): Promise<Extract<VersionGraphInitializeResult, { status: 'success' }>> {
  const initialized = await provider.initializeGraph({
    expectedRegistryRevision: null,
    graphId: namespace.graphId,
    rootWrite: {
      snapshotRootRecord,
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        changes: [],
      }),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  });
  expectInitializeSuccess(initialized);
  return initialized;
}

export function expectMaterializationSuccess<TMaterialized>(
  result: SnapshotRootMaterializationResult<TMaterialized>,
): asserts result is Extract<SnapshotRootMaterializationResult<TMaterialized>, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected materialization success: ${result.error.code}`);
  }
}

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export function cellRangeEquals(
  range: { startRow: number; startCol: number; endRow: number; endCol: number },
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): boolean {
  return (
    range.startRow === startRow &&
    range.startCol === startCol &&
    range.endRow === endRow &&
    range.endCol === endCol
  );
}
