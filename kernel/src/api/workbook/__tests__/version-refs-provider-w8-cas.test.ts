import { jest } from '@jest/globals';

import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';
import {
  AUX_COMMIT_ID,
  DOCUMENT_SCOPE,
  commitGraphChild,
  createProviderWorkbook,
  createWorkbook,
  expectInitializeSuccess,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
  expectOneSuccessOneFailure,
  initializeInput,
  resetWorkbookProviderTestMocks,
} from './version-refs-provider-w8-test-utils';

describe('WorkbookVersion provider-backed ref lifecycle W8 CAS and tombstones', () => {
  beforeEach(() => {
    resetWorkbookProviderTestMocks();
  });

  it('serializes create, fast-forward, and delete CAS races across public provider facades', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const writer = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE, backend });
    const initialized = await writer.initializeGraph(await initializeInput('graph-cas-races'));
    expectInitializeSuccess(initialized);
    const graph = await writer.openGraph(
      namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-cas-races'),
    );
    const childA = await commitGraphChild(
      graph,
      'graph-cas-races',
      initialized.rootCommit.id,
      initialized.initialHead.revision,
      'race-child-a',
    );
    const childB = await commitGraphChild(
      graph,
      'graph-cas-races',
      childA.commit.id,
      childA.ref.revision,
      'race-child-b',
    );
    const wbA = createProviderWorkbook(backend);
    const wbB = createProviderWorkbook(backend);

    const createRace = expectOneSuccessOneFailure(
      await Promise.all([
        wbA.version.createBranch({
          name: 'scenario/cas-race' as any,
          targetCommitId: initialized.rootCommit.id,
        }),
        wbB.version.createBranch({
          name: 'scenario/cas-race' as any,
          targetCommitId: initialized.rootCommit.id,
        }),
      ]),
    );
    expect(createRace.success.value).toMatchObject({
      name: 'refs/heads/scenario/cas-race',
      commitId: initialized.rootCommit.id,
      revision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(createRace.failure, 'VERSION_REF_CONFLICT', {
      recoverability: 'retry',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
      }),
    });

    const advanceRace = expectOneSuccessOneFailure(
      await Promise.all([
        wbA.version.fastForwardBranch({
          name: 'scenario/cas-race' as any,
          nextCommitId: childA.commit.id,
          expectedHead: initialized.rootCommit.id,
          expectedRefRevision: { kind: 'counter', value: '0' },
        }),
        wbB.version.fastForwardBranch({
          name: 'refs/heads/scenario/cas-race' as any,
          nextCommitId: childB.commit.id,
          expectedHead: initialized.rootCommit.id,
          expectedRefRevision: { kind: 'counter', value: '0' },
        }),
      ]),
    );
    expect(advanceRace.success.value).toMatchObject({
      name: 'refs/heads/scenario/cas-race',
      revision: { kind: 'counter', value: '1' },
    });
    expectNoWriteFailure(advanceRace.failure, 'VERSION_REF_CONFLICT', {
      recoverability: 'retry',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
      }),
    });

    const deleteRace = expectOneSuccessOneFailure(
      await Promise.all([
        wbA.version.deleteRef({
          name: 'scenario/cas-race' as any,
          expectedHead: advanceRace.success.value.commitId,
          expectedRefRevision: { kind: 'counter', value: '1' },
        }),
        wbB.version.deleteBranch({
          name: 'refs/heads/scenario/cas-race' as any,
          expectedHead: advanceRace.success.value.commitId,
          expectedRefRevision: { kind: 'counter', value: '1' },
        }),
      ]),
    );
    expect(deleteRace.success.value).toMatchObject({
      name: 'refs/heads/scenario/cas-race',
      commitId: advanceRace.success.value.commitId,
      revision: { kind: 'counter', value: '2' },
    });
    expectNoWriteFailure(deleteRace.failure, 'VERSION_DANGLING_REF', {
      recoverability: 'unsupported',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(createRace.failure, 'scenario/cas-race');
    expectNoDiagnosticLeak(advanceRace.failure, 'scenario/cas-race');
    expectNoDiagnosticLeak(deleteRace.failure, 'scenario/cas-race');

    await expect(wbA.version.readRef('refs/heads/scenario/cas-race' as any)).resolves.toMatchObject(
      {
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_DANGLING_REF',
              data: expect.objectContaining({ redacted: true }),
            }),
          ],
        },
      },
    );
  });

  it('preserves provider tombstones across backend snapshot reloads', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const writer = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE, backend });
    const initialized = await writer.initializeGraph(
      await initializeInput('graph-tombstone-reload'),
    );
    expectInitializeSuccess(initialized);
    const wb = createProviderWorkbook(backend);

    await expect(
      wb.version.createBranch({
        name: 'scenario/reload-tombstone' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      wb.version.deleteRef({
        name: 'scenario/reload-tombstone' as any,
        expectedHead: initialized.rootCommit.id,
        expectedRefRevision: { kind: 'counter', value: '0' },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/reload-tombstone',
        revision: { kind: 'counter', value: '1' },
      },
    });

    const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot(
      await backend.exportSnapshot(),
    );
    const reloadedWb = createProviderWorkbook(reloadedBackend);

    await expect(
      reloadedWb.version.readRef('refs/heads/scenario/reload-tombstone' as any),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_DANGLING_REF',
            data: expect.objectContaining({ redacted: true }),
          }),
        ],
      },
    });
    const listed = await reloadedWb.version.listRefs({ prefix: 'scenario' as any });
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(`expected reloaded listRefs success: ${listed.error.code}`);
    expect(listed.value.items.map((ref) => ref.name)).not.toContain(
      'refs/heads/scenario/reload-tombstone',
    );

    const recreated = await reloadedWb.version.createBranch({
      name: 'scenario/reload-tombstone' as any,
      targetCommitId: initialized.rootCommit.id,
    });
    expectNoWriteFailure(recreated, 'VERSION_DANGLING_REF', {
      recoverability: 'unsupported',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(recreated, 'scenario/reload-tombstone');
  });

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
});
