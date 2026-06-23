import { jest } from '@jest/globals';

import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';
import {
  AUX_COMMIT_ID,
  DOCUMENT_SCOPE,
  commitGraphChild,
  createWorkbook,
  expectInitializeSuccess,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
  initializeInput,
} from './version-refs-provider-w8-test-utils';

export function registerProviderW8CasDeleteGuardScenarios(): void {
  it('rejects current HEAD deletes before invoking the provider tombstone writer', async () => {
    const branchName = 'scenario/current-head-delete';
    const refName = `refs/heads/${branchName}`;
    const branchService = {
      getHead: jest.fn(async () => ({
        ok: true,
        head: {
          mode: 'attached',
          refName,
          branchName,
          commitId: AUX_COMMIT_ID,
          refVersion: { kind: 'counter', value: '0' },
          refIncarnationId: 'inc-current-head-delete',
        },
        diagnostics: [],
      })),
      readBranch: jest.fn(),
      deleteBranch: jest.fn(),
    };
    const version = new WorkbookVersionImpl({ versioning: { branchService } } as any);

    const currentHeadDelete = await version.deleteRef({
      name: branchName as any,
      expectedHead: AUX_COMMIT_ID as any,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(currentHeadDelete, 'VERSION_REF_WRITE_UNAVAILABLE', {
      payload: expect.objectContaining({ issue: 'activeBranchDelete' }),
    });
    expectNoDiagnosticLeak(currentHeadDelete, branchName);
    expect(branchService.getHead).toHaveBeenCalledTimes(1);
    expect(branchService.readBranch).not.toHaveBeenCalled();
    expect(branchService.deleteBranch).not.toHaveBeenCalled();
  });

  it('rejects stale expected-head provider deletes before tombstone writes', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-stale-delete'));
    expectInitializeSuccess(initialized);
    const graph = await provider.openGraph(
      namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-stale-delete'),
    );
    const child = await commitGraphChild(
      graph,
      'graph-stale-delete',
      initialized.rootCommit.id,
      initialized.initialHead.revision,
      'stale-delete-child',
    );
    const wb = createWorkbook({ versioning: { provider } });

    await expect(
      wb.version.createBranch({
        name: 'scenario/stale-delete-head' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      wb.version.fastForwardBranch({
        name: 'scenario/stale-delete-head' as any,
        nextCommitId: child.commit.id,
        expectedHead: initialized.rootCommit.id,
        expectedRefRevision: { kind: 'counter', value: '0' },
      }),
    ).resolves.toMatchObject({ ok: true });

    const deleteBranch = jest.spyOn(graph, 'deleteBranch');
    const stale = await wb.version.deleteRef({
      name: 'scenario/stale-delete-head' as any,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: { kind: 'counter', value: '1' },
    });
    expectNoWriteFailure(stale, 'VERSION_REF_CONFLICT', {
      recoverability: 'retry',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
        conflict: 'expectedHeadMismatch',
      }),
    });
    expectNoDiagnosticLeak(stale, 'scenario/stale-delete-head');
    expect(deleteBranch).not.toHaveBeenCalled();
  });
}
