import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
import { namespaceForDocumentScope } from '../provider';
import {
  AUTHOR,
  DOCUMENT_SCOPE,
  copyMainRefToBranch,
  expectInitializeSuccess,
  initializeInput,
  lifecycleWithPersistRace,
  readRefRecord,
  rootWrite,
} from './provider-indexeddb-branch-lifecycle-test-utils';

export function registerIndexedDbBranchLifecycleCreateRaceScenarios(): void {
  it('preserves stale provider ref records when create loses durable absent-CAS', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-branch-create-race'),
    );
    expectInitializeSuccess(initialized);
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-branch-create-race');
    const graph = await provider.openGraph(namespace);
    const concurrentCommit = await graph.commit({
      ...(await rootWrite('create-race-concurrent', namespace)),
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
      parentCommitIds: [initialized.rootCommit.id],
    });
    expect(concurrentCommit.status).toBe('success');
    if (concurrentCommit.status !== 'success') throw new Error('expected concurrent commit');
    const lifecycle = lifecycleWithPersistRace(namespace, () =>
      copyMainRefToBranch(namespace, 'scenario/idb-create-race', {
        targetCommitId: concurrentCommit.commit.id,
        refVersion: { kind: 'counter', value: '9' },
      }),
    );

    const created = await lifecycle.createBranch({
      name: 'scenario/idb-create-race',
      targetCommitId: initialized.rootCommit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });

    expect(created.ok).toBe(false);
    if (created.ok) throw new Error('expected create conflict');
    expect(created.error.code).toBe('refAlreadyExists');
    expect(created.conflict).toMatchObject({
      code: 'refAlreadyExists',
      actualHead: concurrentCommit.commit.id,
      actualRefVersion: { kind: 'counter', value: '9' },
    });
    await expect(readRefRecord(namespace, 'scenario/idb-create-race')).resolves.toMatchObject({
      record: {
        state: 'live',
        targetCommitId: concurrentCommit.commit.id,
        refVersion: { kind: 'counter', value: '9' },
      },
    });
  });
}
