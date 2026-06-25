import { DocumentFactory } from '../../../api/document/document-factory';
import type { SnapshotRootFreshLifecycleMaterialization } from '../../../api/document/snapshot-root-lifecycle-hydrator';
import {
  createWorkbookSnapshotRootRecord,
  createYrsFullStateSnapshotRootPayload,
} from '../snapshot-root-capture';
import { createVersionPersistence } from '../version-persistence';
import {
  createReloadLifecycleHydratorMock,
  expectReloadedSemanticChangeSetPayload,
  RELOADED_DOCUMENT_ID,
} from './version-persistence-reload-test-helpers';
import { vc06SemanticChangeSetPayload } from './version-persistence-semantic-fixtures';
import {
  createVersionPersistenceTestProvider,
  initializeGraphRoot,
  objectRecord,
  versionPersistenceNamespace,
} from './version-persistence-test-utils';

export function registerVersionPersistenceReloadFreshLifecycleScenarios(): void {
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

      const namespace = versionPersistenceNamespace('graph-1');
      const snapshotRootPayload = createYrsFullStateSnapshotRootPayload(
        await sourceHandle.createSyncPort().encodeDiff(new Uint8Array([0])),
      );
      const snapshotRootRecord = await createWorkbookSnapshotRootRecord(
        namespace,
        snapshotRootPayload,
      );
      const semanticChangeSetPayload = vc06SemanticChangeSetPayload();
      const semanticChangeSetRecord = await objectRecord(
        namespace,
        'workbook.semanticChangeSet.v1',
        semanticChangeSetPayload,
      );
      const provider = createVersionPersistenceTestProvider();
      const initialized = await initializeGraphRoot({
        provider,
        graphId: namespace.graphId,
        snapshotRootRecord,
        semanticChangeSetRecord,
      });

      const hydrateYrsFullState = createReloadLifecycleHydratorMock();
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
      expect(materialized.documentId).toBe(RELOADED_DOCUMENT_ID);
      await expect(materialized.workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 11,
      });
      await expect(materialized.workbook.activeSheet.getCell('A2')).resolves.toMatchObject({
        value: 42,
      });

      const reloadedGraph = await provider.openGraph(namespace);
      const reloadedCommit = await reloadedGraph.readCommit(initialized.rootCommit.id);
      expect(reloadedCommit.status).toBe('success');
      if (reloadedCommit.status !== 'success') {
        throw new Error(
          `expected reloaded commit read success: ${reloadedCommit.diagnostics[0]?.code}`,
        );
      }
      expect(reloadedCommit.commit.payload.semanticChangeSetDigest).toEqual(
        semanticChangeSetRecord.digest,
      );
      const reloadedSemanticChangeSetRecord = await reloadedGraph.getObjectRecord({
        kind: 'object',
        objectType: 'workbook.semanticChangeSet.v1',
        digest: reloadedCommit.commit.payload.semanticChangeSetDigest,
      });
      expectReloadedSemanticChangeSetPayload(
        reloadedSemanticChangeSetRecord.preimage.payload,
        semanticChangeSetPayload,
      );

      await sourceWorkbook.activeSheet.setCell('A1', 99);
      await expect(materialized.workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 11,
      });
    } finally {
      if (materialized) await materialized.dispose();
      await sourceHandle.dispose();
    }
  });
}
