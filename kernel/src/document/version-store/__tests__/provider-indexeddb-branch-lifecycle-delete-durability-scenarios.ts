import { createProviderBackedBranchLifecycleService } from '../branch-provider-service';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
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
    if (!deleted.ok) throw new Error('expected branch delete success');
    await provider.close('test-teardown');

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
    const recreated = await reloadedBranchService.createBranch({
      name: 'scenario/idb-delete',
      targetCommitId: initialized.rootCommit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(recreated.ok).toBe(false);
    if (recreated.ok) throw new Error('expected reloaded tombstone create to fail');
    expect(recreated).toMatchObject({
      error: { code: 'refTombstoned' },
      conflict: {
        code: 'refTombstoned',
        tombstoneRefVersion: deleted.branch.ref.refVersion,
        previousRefIncarnationId: created.branch.ref.refIncarnationId,
      },
      diagnostics: [
        expect.objectContaining({
          code: 'refTombstoned',
          refName: 'scenario/idb-delete',
          commitId: initialized.rootCommit.id,
          refVersion: deleted.branch.ref.refVersion,
          tombstoneRefVersion: deleted.branch.ref.refVersion,
          previousRefIncarnationId: created.branch.ref.refIncarnationId,
        }),
      ],
    });
    const row = await readRefRecord(
      namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-branch-delete'),
      'scenario/idb-delete',
    );
    expect(asRecord(row.record)).toMatchObject({
      state: 'tombstone',
      previousTargetCommitId: initialized.rootCommit.id,
      previousProviderRefId: created.branch.ref.providerRefId,
      previousProviderEpoch: created.branch.ref.providerEpoch,
      previousRefIncarnationId: created.branch.ref.refIncarnationId,
      refVersion: deleted.branch.ref.refVersion,
    });
    await reloaded.close('test-teardown');
  });
}
