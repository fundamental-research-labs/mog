import { DocumentFactory } from '../document-factory';
import {
  createDocumentLifecycleSnapshotRootHydrator,
  type SnapshotRootFreshLifecycleMaterialization,
} from '../snapshot-root-lifecycle-hydrator';
import {
  createWorkbookSnapshotRootRecord,
  createYrsFullStateSnapshotRootPayload,
} from '../../../document/version-store/snapshot-root-capture';
import { createSnapshotRootReloadService } from '../../../document/version-store/snapshot-root-reload-service';
import type { VersionGraphNamespace } from '../../../document/version-store/object-store';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

describe('createDocumentLifecycleSnapshotRootHydrator', () => {
  it('hydrates snapshot-root bytes through a fresh headless document lifecycle', async () => {
    const sourceHandle = await DocumentFactory.create({
      documentId: 'source-doc',
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let materialized: SnapshotRootFreshLifecycleMaterialization | undefined;

    try {
      const sourceWorkbook = await sourceHandle.workbook();
      await sourceWorkbook.activeSheet.setCell('A1', 41);
      await sourceWorkbook.activeSheet.setCell('A2', '=A1+1');
      const scenarioSheet = await sourceWorkbook.sheets.add('Scenario');
      await scenarioSheet.setCell('B1', 'fresh lifecycle');

      const fullStateBytes = await sourceHandle.createSyncPort().encodeDiff(new Uint8Array([0]));
      const record = await createWorkbookSnapshotRootRecord(
        NAMESPACE,
        createYrsFullStateSnapshotRootPayload(fullStateBytes),
      );
      const service = createSnapshotRootReloadService({
        hydrator: createDocumentLifecycleSnapshotRootHydrator({
          userTimezone: 'UTC',
          documentIdFactory: () => 'snapshot-reload-doc',
        }),
      });

      const result = await service.reloadSnapshotRoot(record);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected reload success: ${result.error.code}`);
      materialized = result.materialized;
      expect(result.mutationGuarantee).toBe('no-current-workbook-mutation');
      expect(materialized.documentId).toBe('snapshot-reload-doc');
      expect(materialized.documentId).not.toBe(sourceHandle.documentId);

      await expect(materialized.workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 41,
      });
      await expect(materialized.workbook.activeSheet.getCell('A2')).resolves.toMatchObject({
        value: 42,
      });
      const reloadedScenario = await materialized.workbook.getSheet('Scenario');
      await expect(reloadedScenario.getCell('B1')).resolves.toMatchObject({
        value: 'fresh lifecycle',
      });

      await sourceWorkbook.activeSheet.setCell('A1', 99);
      await expect(materialized.workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 41,
      });
    } finally {
      if (materialized) await materialized.dispose();
      await sourceHandle.dispose();
    }
  });

  it('returns structured failure diagnostics and disposes partial scratch handles', async () => {
    const disposed: string[] = [];
    const hydrator = createDocumentLifecycleSnapshotRootHydrator({
      userTimezone: 'UTC',
      createDocument: async () =>
        ({
          documentId: 'partial-doc',
          dispose: async () => {
            disposed.push('partial-doc');
          },
          workbook: async () => {
            throw new Error('workbook failed');
          },
        }) as never,
    });

    const result = await hydrator.hydrateYrsFullState({
      yrsFullStateBytes: new Uint8Array([1, 2, 3]),
      byteLength: 3,
      source: 'payload',
    });

    expect(result.status).toBe('failed');
    expect(disposed).toEqual(['partial-doc']);
    expect(result.freshLifecycleMutationGuarantee).toBe('unknown-after-hydrator-failure');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_SNAPSHOT_ROOT_RELOAD_HYDRATOR_FAILED',
        details: { cause: 'Error' },
      }),
    ]);
  });
});
