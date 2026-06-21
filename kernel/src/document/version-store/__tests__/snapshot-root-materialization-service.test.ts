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
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../provider';
import {
  createWorkbookSnapshotRootRecord,
  createYrsFullStateSnapshotRootPayload,
} from '../snapshot-root-capture';
import { createSnapshotRootMaterializationService } from '../snapshot-root-materialization-service';

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

describe('SnapshotRootMaterializationService', () => {
  it('reads a committed snapshot root and materializes it through a fresh lifecycle', async () => {
    const sourceHandle = await DocumentFactory.create({
      documentId: 'stored-source-doc',
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let materialized: SnapshotRootFreshLifecycleMaterialization | undefined;

    try {
      const sourceWorkbook = await sourceHandle.workbook();
      await sourceWorkbook.activeSheet.setCell('A1', 7);
      await sourceWorkbook.activeSheet.setCell('A2', '=A1*6');

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
        documentIdFactory: () => 'stored-materialized-doc',
      });
      const hydrateYrsFullState = jest.fn(
        lifecycleHydrator.hydrateYrsFullState.bind(lifecycleHydrator),
      );
      const service = createSnapshotRootMaterializationService({
        provider,
        hydrator: { hydrateYrsFullState },
      });

      const result = await service.materializeSnapshotRoot({ target: 'ref', refName: 'main' });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected materialization success: ${result.error.code}`);
      materialized = result.materialized;
      expect(result.commitId).toBe(initialized.rootCommit.id);
      expect(result.snapshotRootDigest).toEqual(snapshotRootRecord.digest);
      expect(result.snapshotRootRecord.digest).toEqual(snapshotRootRecord.digest);
      expect(result.mutationGuarantee).toBe('no-current-workbook-mutation');
      expect(hydrateYrsFullState).toHaveBeenCalledTimes(1);
      const hydrationInput = hydrateYrsFullState.mock.calls[0]?.[0];
      expect(hydrationInput).toMatchObject({
        source: 'record',
        objectDigest: snapshotRootRecord.digest,
        byteLength: snapshotRootPayload.byteLength,
      });
      expect(hydrationInput?.yrsFullStateBytes.byteLength).toBe(snapshotRootPayload.byteLength);
      expect(materialized.documentId).toBe('stored-materialized-doc');
      await expect(materialized.workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 7,
      });
      await expect(materialized.workbook.activeSheet.getCell('A2')).resolves.toMatchObject({
        value: 42,
      });

      await sourceWorkbook.activeSheet.setCell('A1', 99);
      await expect(materialized.workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 7,
      });
    } finally {
      if (materialized) await materialized.dispose();
      await sourceHandle.dispose();
    }
  });

  it('fails closed before hydration for legacy synthetic sheet-list snapshot roots', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const snapshotRootRecord = await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      sheets: [],
    });
    const initialized = await provider.initializeGraph({
      expectedRegistryRevision: null,
      graphId: 'graph-1',
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
    const hydrateYrsFullState = jest.fn();
    const service = createSnapshotRootMaterializationService({
      provider,
      hydrator: { hydrateYrsFullState },
    });

    const result = await service.materializeCommitSnapshotRoot(initialized.rootCommit.id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected materialization failure');
    expect(result.error.code).toBe('VERSION_SNAPSHOT_ROOT_MATERIALIZATION_RELOAD_FAILED');
    expect(result.snapshotRootDigest).toEqual(snapshotRootRecord.digest);
    expect(result.mutationGuarantee).toBe('no-current-workbook-mutation');
    expect(hydrateYrsFullState).not.toHaveBeenCalled();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_RELOAD_FAILED',
        sourceDiagnostics: [
          expect.objectContaining({
            code: 'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_ROOT',
          }),
        ],
      }),
    ]);
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
