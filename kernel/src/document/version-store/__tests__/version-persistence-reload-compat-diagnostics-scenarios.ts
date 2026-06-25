import { createVersionPersistence } from '../version-persistence';
import { expectReloadCompatibilityDiagnostics } from './version-persistence-reload-test-helpers';
import {
  createVersionPersistenceTestProvider,
  initializeGraphRoot,
  objectRecord,
  versionPersistenceNamespace,
} from './version-persistence-test-utils';

export function registerVersionPersistenceReloadCompatibilityDiagnosticsScenarios(): void {
  it('preserves persisted snapshot-root header compatibility diagnostics on reload', async () => {
    const namespace = versionPersistenceNamespace('graph-compat-diagnostics');
    const snapshotRootRecord = await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      schemaVersion: 1,
      kind: 'compat-diagnostic-test',
    });
    const semanticChangeSetRecord = await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes: [],
    });
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
    expectReloadCompatibilityDiagnostics(result.diagnostics);
  });
}
