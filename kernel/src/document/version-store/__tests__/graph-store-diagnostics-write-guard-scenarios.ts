import { createInMemoryVersionGraphStore } from '../graph';
import {
  NAMESPACE,
  OTHER_NAMESPACE,
  commitInput,
  expectGraphFailed,
  expectGraphSuccess,
  graphInput,
  objectRecord,
} from './graph-store-test-utils';

export function registerGraphStoreWriteGuardDiagnosticsScenarios(): void {
  it('rejects wrong-namespace dependency records before object writes', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);

    const result = await graph.commit(
      commitInput(
        await graphInput('wrong-namespace', OTHER_NAMESPACE),
        initialized.commit.id,
        initialized.main.revision,
      ),
    );

    expectGraphFailed(result);
    expect(result.mutationGuarantee).toBe('no-write-attempted');
    expect(result.diagnostics[0]).toMatchObject({ code: 'VERSION_WRONG_NAMESPACE' });
    expect(graph.refStore.getRef('main')).toMatchObject({
      ok: true,
      ref: { targetCommitId: initialized.commit.id, refVersion: initialized.main.revision },
    });
  });

  it('returns object-store failure diagnostics without advancing main', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const missingChunk = await objectRecord('workbook.snapshotChunk.v1', {
      chunkId: 'missing',
    });

    const result = await graph.commit(
      commitInput(
        await graphInput('object-store-failure', NAMESPACE, [
          {
            kind: 'object',
            objectType: 'workbook.snapshotChunk.v1',
            digest: missingChunk.digest,
          },
        ]),
        initialized.commit.id,
        initialized.main.revision,
      ),
    );

    expectGraphFailed(result);
    expect(result.mutationGuarantee).toBe('ref-not-mutated');
    expect(result.diagnostics[0]).toMatchObject({ code: 'VERSION_OBJECT_STORE_FAILURE' });
    expect(graph.refStore.getRef('main')).toMatchObject({
      ok: true,
      ref: { targetCommitId: initialized.commit.id, refVersion: initialized.main.revision },
    });
  });
}
