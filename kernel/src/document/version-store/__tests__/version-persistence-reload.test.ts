import { jest } from '@jest/globals';

import { DocumentFactory } from '../../../api/document/document-factory';
import {
  createDocumentLifecycleSnapshotRootHydrator,
  type SnapshotRootFreshLifecycleMaterialization,
} from '../../../api/document/snapshot-root-lifecycle-hydrator';
import { VERSION_OBJECT_CURRENT_COMPATIBILITY_VERSION } from '../object-header';
import {
  createWorkbookSnapshotRootRecord,
  createYrsFullStateSnapshotRootPayload,
} from '../snapshot-root-capture';
import { createVersionPersistence } from '../version-persistence';
import { vc06SemanticChangeSetPayload } from './version-persistence-semantic-fixtures';
import {
  createVersionPersistenceTestProvider,
  initializeGraphRoot,
  objectRecord,
  versionPersistenceNamespace,
} from './version-persistence-test-utils';

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
      expect(reloadedSemanticChangeSetRecord.preimage.payload).toEqual(semanticChangeSetPayload);
      expect(reloadedSemanticChangeSetRecord.preimage.payload).toMatchObject({
        changes: expect.arrayContaining([
          expect.objectContaining({
            structural: expect.objectContaining({ domain: 'named-ranges' }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({ domain: 'tables' }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({ domain: 'comments-notes' }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({
              domain: 'conditional-formatting',
              entityId: 'sheet-1!cf:cf-top-10',
              propertyPath: ['rule'],
            }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({
              domain: 'data-validation',
              entityId: 'sheet-1!range:dv-status',
              propertyPath: ['range'],
            }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({ domain: 'filters' }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({ domain: 'sorts' }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({ domain: 'charts.source-range' }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({ domain: 'floating-objects.anchors' }),
          }),
        ]),
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

  it('preserves persisted snapshot-root header compatibility diagnostics on reload', async () => {
    const namespace = versionPersistenceNamespace('graph-compat-diagnostics');
    const snapshotRootRecord = await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      schemaVersion: 1,
      kind: 'compat-diagnostic-test',
    });
    const semanticChangeSetRecord = await objectRecord(
      namespace,
      'workbook.semanticChangeSet.v1',
      {
        schemaVersion: 1,
        changes: [],
      },
    );
    const provider = createVersionPersistenceTestProvider();
    const initialized = await initializeGraphRoot({
      provider,
      graphId: namespace.graphId,
      snapshotRootRecord,
      semanticChangeSetRecord,
    });
    const graph = await provider.openGraph(namespace);
    graph.objectStore.putCorruptRecordForTesting(snapshotRootRecord.digest, {
      ...snapshotRootRecord,
      preimage: {
        ...snapshotRootRecord.preimage,
        minReaderVersion: 'VC-12',
      },
    });
    const persistence = createVersionPersistence({ provider });

    const result = await persistence.reload({
      target: 'commit',
      commitId: initialized.rootCommit.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected reload failure');
    expect(result.error.code).toBe('VERSION_PERSISTENCE_RELOAD_MATERIALIZATION_FAILED');
    expect(JSON.stringify(result.diagnostics)).toContain('VERSION_UNSUPPORTED_SCHEMA');
    expect(JSON.stringify(result.diagnostics)).toContain('minReaderVersion');
    expect(JSON.stringify(result.diagnostics)).toContain(
      VERSION_OBJECT_CURRENT_COMPATIBILITY_VERSION,
    );
  });
});
