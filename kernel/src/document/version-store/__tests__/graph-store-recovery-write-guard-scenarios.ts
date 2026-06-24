import { VERSION_GRAPH_MAIN_REF, createInMemoryVersionGraphStore } from '../graph';
import {
  NAMESPACE,
  commit,
  commitInput,
  expectGraphFailed,
  expectGraphSuccess,
  expectMappedRecoverability,
  expectNoRawNamespaceLeak,
  graphInput,
} from './graph-store-recovery-test-helpers';

export function registerGraphStoreRecoveryWriteGuardTests(): void {
  it('rejects stale expected heads before object writes or ref mutation', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const refsBefore = graph.refStore.exportSnapshot();
    const objectsBefore = graph.objectStore.listObjectRecords();

    const result = await graph.commit(
      commitInput(await graphInput('stale-head'), commit('ff'), initialized.main.revision),
    );

    expectGraphFailed(result);
    expect(result.mutationGuarantee).toBe('no-write-attempted');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_REF_CONFLICT',
        refName: VERSION_GRAPH_MAIN_REF,
        commitId: initialized.commit.id,
        details: expect.objectContaining({
          expectedHead: commit('ff'),
          actualHead: initialized.commit.id,
        }),
      }),
    ]);
    expectMappedRecoverability(result.diagnostics, 'retry');
    expectNoRawNamespaceLeak(result.diagnostics);
    expect(graph.refStore.exportSnapshot()).toEqual(refsBefore);
    expect(graph.objectStore.listObjectRecords()).toEqual(objectsBefore);
  });
}
