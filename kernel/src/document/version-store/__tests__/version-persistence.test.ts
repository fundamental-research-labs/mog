import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
import { jest } from '@jest/globals';

import { DocumentFactory } from '../../../api/document/document-factory';
import {
  createDocumentLifecycleSnapshotRootHydrator,
  type SnapshotRootFreshLifecycleMaterialization,
} from '../../../api/document/snapshot-root-lifecycle-hydrator';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType } from '../object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeResult,
} from '../provider';
import {
  createWorkbookSnapshotRootRecord,
  createYrsFullStateSnapshotRootPayload,
} from '../snapshot-root-capture';
import { createVersionPersistence } from '../version-persistence';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const CREATED_AT = '2026-06-20T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('VersionPersistence', () => {
  it('reloads a committed snapshot root through a fresh lifecycle', async () => {
    const sourceHandle = await DocumentFactory.create({
      documentId: 'persistence-source-doc',
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let materialized: SnapshotRootFreshLifecycleMaterialization | undefined;

    try {
      const sourceWorkbook = await sourceHandle.workbook();
      await sourceWorkbook.activeSheet.setCell('A1', 11);
      await sourceWorkbook.activeSheet.setCell('A2', '=A1+31');

      const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
      const snapshotRootPayload = createYrsFullStateSnapshotRootPayload(
        await sourceHandle.createSyncPort().encodeDiff(new Uint8Array([0])),
      );
      const snapshotRootRecord = await createWorkbookSnapshotRootRecord(
        namespace,
        snapshotRootPayload,
      );
      const semanticChangeSetRecord = await objectRecord(
        namespace,
        'workbook.semanticChangeSet.v1',
        { schemaVersion: 1, changes: [] },
      );
      const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const initialized = await provider.initializeGraph({
        expectedRegistryRevision: null,
        graphId: 'graph-1',
        rootWrite: {
          snapshotRootRecord,
          semanticChangeSetRecord,
          author: AUTHOR,
          createdAt: CREATED_AT,
          completenessDiagnostics: [],
        },
      });
      expectInitializeSuccess(initialized);

      const lifecycleHydrator = createDocumentLifecycleSnapshotRootHydrator({
        userTimezone: 'UTC',
        documentIdFactory: () => 'persistence-reloaded-doc',
      });
      const hydrateYrsFullState = jest.fn(
        lifecycleHydrator.hydrateYrsFullState.bind(lifecycleHydrator),
      );
      const persistence = createVersionPersistence({
        provider,
        hydrator: { hydrateYrsFullState },
      });

      const result = await persistence.reload({ target: 'ref', refName: 'main' });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected reload success: ${result.error.code}`);
      materialized = result.materialized;
      expect(result.reload).toBe('fresh-lifecycle');
      expect(result.materialization).toBe('fresh-lifecycle');
      expect(result.commitId).toBe(initialized.rootCommit.id);
      expect(result.snapshotRootDigest).toEqual(snapshotRootRecord.digest);
      expect(result.snapshotRootRecord.digest).toEqual(snapshotRootRecord.digest);
      expect(result.mutationGuarantee).toBe('no-current-workbook-mutation');
      expect(hydrateYrsFullState).toHaveBeenCalledTimes(1);
      expect(materialized.documentId).toBe('persistence-reloaded-doc');
      await expect(materialized.workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 11,
      });
      await expect(materialized.workbook.activeSheet.getCell('A2')).resolves.toMatchObject({
        value: 42,
      });

      await sourceWorkbook.activeSheet.setCell('A1', 99);
      await expect(materialized.workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 11,
      });
    } finally {
      if (materialized) await materialized.dispose();
      await sourceHandle.dispose();
    }
  });

  it('fails closed when no materialization service or provider is attached', async () => {
    const persistence = createVersionPersistence();

    const result = await persistence.reload({
      target: 'commit',
      commitId: 'commit:sha256:0000000000000000000000000000000000000000000000000000000000000000',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected reload failure');
    expect(result.error.code).toBe('VERSION_PERSISTENCE_RELOAD_SERVICE_UNAVAILABLE');
    expect(result.mutationGuarantee).toBe('no-current-workbook-mutation');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_PERSISTENCE_RELOAD_SERVICE_UNAVAILABLE',
        severity: 'error',
      }),
    ]);
  });

  it('diagnoses object-written ref-not-advanced boundaries without mutating the visible graph', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph({
      expectedRegistryRevision: null,
      graphId: 'graph-1',
      rootWrite: {
        snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
          sheets: [],
        }),
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
    const before = await provider.readGraphRegistry();
    expect(before.status).toBe('ok');
    const persistence = createVersionPersistence({ provider });

    const result = await persistence.persistBoundary({
      boundary: 'segment-written-ref-not-advanced',
      commitId: initialized.rootCommit.id,
    });
    const after = await provider.readGraphRegistry();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected boundary success: ${result.error.code}`);
    expect(result).toMatchObject({
      status: 'diagnosed',
      boundary: 'segment-written-ref-not-advanced',
      commitId: initialized.rootCommit.id,
      graphId: 'graph-1',
      recoveryAction: 'reload-visible-graph',
      mutationGuarantee: 'ref-not-mutated',
      retryable: false,
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_PERSISTENCE_BOUNDARY_REF_NOT_ADVANCED',
          severity: 'warning',
          recoveryAction: 'reload-visible-graph',
        }),
      ],
    });
    expect(after).toEqual(before);
  });

  it('fails persistence-boundary diagnostics closed without a provider', async () => {
    const persistence = createVersionPersistence();

    const result = await persistence.persistBoundary({
      boundary: 'segment-written-ref-not-advanced',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected boundary failure');
    expect(result.error.code).toBe('VERSION_PERSISTENCE_BOUNDARY_PROVIDER_UNAVAILABLE');
    expect(result.mutationGuarantee).toBe('no-write-attempted');
    expect(result.retryable).toBe(false);
  });

  it('rejects unsupported persistence-boundary requests before provider reads', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const readGraphRegistry = jest.spyOn(provider, 'readGraphRegistry');
    const persistence = createVersionPersistence({ provider });

    const result = await persistence.persistBoundary({
      boundary: 'unsupported-boundary',
    } as never);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected boundary failure');
    expect(result.error.code).toBe('VERSION_PERSISTENCE_BOUNDARY_INVALID_REQUEST');
    expect(result.mutationGuarantee).toBe('no-write-attempted');
    expect(readGraphRegistry).not.toHaveBeenCalled();
  });
});

async function objectRecord(
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

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}
