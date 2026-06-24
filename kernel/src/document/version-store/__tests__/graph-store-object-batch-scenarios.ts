import { createInMemoryVersionGraphStore } from '../graph';
import {
  NAMESPACE,
  OTHER_NAMESPACE,
  commitInput,
  expectGraphFailed,
  expectGraphSuccess,
  graphInput,
  objectRecord,
} from './graph-store-object-batch-test-helpers';

export function registerGraphStoreObjectBatchAtomicityScenarios(): void {
  it('redacts wrong-namespace object preflight diagnostics before object writes', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const refsBefore = graph.refStore.exportSnapshot();
    const objectsBefore = graph.objectStore.listObjectRecords();

    const result = await graph.commit(
      commitInput(
        await graphInput('wrong-namespace', OTHER_NAMESPACE),
        initialized.commit.id,
        initialized.main.revision,
      ),
    );

    expectGraphFailed(result);
    expect(result.mutationGuarantee).toBe('no-write-attempted');
    expect(result.diagnostics[0]).toMatchObject({
      code: 'VERSION_WRONG_NAMESPACE',
      details: { path: 'snapshotRootRecord', namespace: 'redacted' },
    });
    expect(result.diagnostics[0]).not.toHaveProperty('namespace');

    const diagnosticText = JSON.stringify(result.diagnostics);
    for (const leakedValue of Object.values(OTHER_NAMESPACE)) {
      expect(diagnosticText).not.toContain(leakedValue);
    }
    expect(graph.refStore.exportSnapshot()).toEqual(refsBefore);
    expect(graph.objectStore.listObjectRecords()).toEqual(objectsBefore);
  });

  it('rejects dependency validation failures without partial object writes or ref mutation', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const refsBefore = graph.refStore.exportSnapshot();
    const objectsBefore = graph.objectStore.listObjectRecords();
    const missingSnapshotDependency = await objectRecord('workbook.snapshotRoot.v1', {
      label: 'missing-snapshot-dependency',
      sheets: [],
    });
    const input = await graphInput('dependency-gap', NAMESPACE, [
      {
        kind: 'object',
        objectType: 'workbook.snapshotRoot.v1',
        digest: missingSnapshotDependency.digest,
      },
    ]);

    const result = await graph.commit(
      commitInput(input, initialized.commit.id, initialized.main.revision),
    );

    expectGraphFailed(result);
    expect(result.mutationGuarantee).toBe('ref-not-mutated');
    expect(result.diagnostics[0]).toMatchObject({
      code: 'VERSION_OBJECT_STORE_FAILURE',
      sourceDiagnostics: [
        expect.objectContaining({
          code: 'VERSION_OBJECT_STORE_FAILURE',
          sourceDiagnostics: [
            expect.objectContaining({
              code: 'VERSION_MISSING_DEPENDENCY',
              objectType: 'workbook.snapshotRoot.v1',
              details: {
                dependencyKind: 'object',
                dependencyObjectType: 'workbook.snapshotRoot.v1',
              },
            }),
          ],
        }),
      ],
    });
    expect(graph.refStore.exportSnapshot()).toEqual(refsBefore);
    expect(graph.objectStore.listObjectRecords()).toEqual(objectsBefore);
  });
}
