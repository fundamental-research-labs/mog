import { createProviderBackedBranchLifecycleService } from '../branch-provider-service';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb-backend';
import { namespaceForDocumentScope } from '../provider';
import {
  AUTHOR,
  DOCUMENT_SCOPE,
  asRecord,
  expectInitializeSuccess,
  initializeInput,
  readRefRecord,
} from './provider-indexeddb-branch-lifecycle-test-utils';

export function registerIndexedDbBranchLifecycleDeleteDurabilityScenarios(): void {
  it('deletes branches durably through the public branch lifecycle service', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-branch-delete'),
    );
    expectInitializeSuccess(initialized);
    const branchService = createProviderBackedBranchLifecycleService({ provider });
    const created = await branchService.createBranch({
      name: 'scenario/idb-delete',
      targetCommitId: initialized.rootCommit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('expected branch create success');

    const deleted = await branchService.deleteBranch({
      name: 'scenario/idb-delete',
      expectedHead: initialized.rootCommit.id,
      expectedRefVersion: created.branch.ref.refVersion,
      deletedBy: AUTHOR,
    });

    expect(deleted).toMatchObject({
      ok: true,
      branch: {
        name: 'scenario/idb-delete',
        ref: {
          state: 'tombstone',
          previousTargetCommitId: initialized.rootCommit.id,
          refVersion: { kind: 'counter', value: '1' },
        },
      },
    });
    const reloaded = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloadedBranchService = createProviderBackedBranchLifecycleService({
      provider: reloaded,
    });
    const readDeleted = await reloadedBranchService.readBranch('scenario/idb-delete');
    expect(readDeleted.ok).toBe(false);
    if (readDeleted.ok) throw new Error('expected tombstoned branch read to fail');
    expect(readDeleted.error.code).toBe('refTombstoned');
    const list = await reloadedBranchService.listBranches();
    expect(list.ok).toBe(true);
    if (!list.ok) throw new Error('expected branch list success');
    expect(list.branches.map((branch) => branch.name)).not.toContain('scenario/idb-delete');
    const row = await readRefRecord(
      namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-branch-delete'),
      'scenario/idb-delete',
    );
    expect(asRecord(row.record).state).toBe('tombstone');
  });
}
