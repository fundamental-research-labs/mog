import { jest } from '@jest/globals';

import {
  commitProviderGraphChild,
  createProviderGraphFixture,
} from './version-refs-provider-fixtures';
import {
  createWorkbook,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
} from './version-refs-provider-test-utils';

export function registerProviderRefTombstoneGuardScenarios(): void {
  it('keeps tombstoned provider branches deleted on stale fast-forward and delete attempts', async () => {
    const fixture = await createProviderGraphFixture();
    const { initialized, provider } = fixture;
    const child = await commitProviderGraphChild(fixture, 'deleted-stale-child');
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(
      wb.version.createBranch({
        name: 'scenario/deleted-stale' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/deleted-stale',
        commitId: initialized.rootCommit.id,
        revision: { kind: 'counter', value: '0' },
      },
    });

    await expect(
      wb.version.deleteRef({
        name: 'scenario/deleted-stale' as any,
        expectedHead: initialized.rootCommit.id,
        expectedRefRevision: { kind: 'counter', value: '0' },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/deleted-stale',
        commitId: initialized.rootCommit.id,
        revision: { kind: 'counter', value: '1' },
      },
    });

    const staleAdvance = await wb.version.fastForwardBranch({
      name: 'refs/heads/scenario/deleted-stale' as any,
      nextCommitId: child.commit.id,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(staleAdvance, 'VERSION_DANGLING_REF', {
      recoverability: 'unsupported',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(staleAdvance, 'scenario/deleted-stale');

    const staleDelete = await wb.version.deleteRef({
      name: 'scenario/deleted-stale' as any,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(staleDelete, 'VERSION_DANGLING_REF', {
      recoverability: 'unsupported',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(staleDelete, 'scenario/deleted-stale');

    await expect(
      wb.version.readRef('refs/heads/scenario/deleted-stale' as any),
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
    const listed = await wb.version.listRefs({ prefix: 'scenario' as any });
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(`expected listRefs success: ${listed.error.code}`);
    expect(listed.value.items.map((ref) => ref.name)).not.toContain(
      'refs/heads/scenario/deleted-stale',
    );
  });

  it('preflights provider delete current and stale revisions before tombstone writes', async () => {
    const fixture = await createProviderGraphFixture();
    const { graph, initialized, provider } = fixture;
    const child = await commitProviderGraphChild(fixture, 'delete-preflight-child');
    const deleteBranch = jest.spyOn(graph, 'deleteBranch');
    const wb = createWorkbook({ versioning: { provider } });

    await wb.version.createBranch({
      name: 'scenario/delete-preflight' as any,
      targetCommitId: initialized.rootCommit.id,
    });
    await wb.version.fastForwardBranch({
      name: 'scenario/delete-preflight' as any,
      nextCommitId: child.commit.id,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });

    const stale = await wb.version.deleteRef({
      name: 'scenario/delete-preflight' as any,
      expectedHead: child.commit.id,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(stale, 'VERSION_REF_CONFLICT', {
      recoverability: 'retry',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
        conflict: 'expectedRefVersionMismatch',
      }),
    });
    expectNoDiagnosticLeak(stale, 'scenario/delete-preflight');

    const readActiveCheckoutSession = jest.fn(() => ({
      checkedOutCommitId: child.commit.id,
      branchName: 'refs/heads/scenario/delete-preflight',
      refHeadAtMaterialization: child.commit.id,
      detached: false,
    }));
    const versioning = (wb.version as any).ctx.versioning as Record<string, unknown>;
    const surfaceStatusService = { readActiveCheckoutSession };
    versioning.surfaceStatusService = surfaceStatusService;
    versioning.versionSurfaceStatusService = surfaceStatusService;

    const active = await wb.version.deleteRef({
      name: 'scenario/delete-preflight' as any,
      expectedHead: child.commit.id,
      expectedRefRevision: { kind: 'counter', value: '1' },
    });
    expectNoWriteFailure(active, 'VERSION_REF_WRITE_UNAVAILABLE', {
      payload: expect.objectContaining({ issue: 'activeBranchDelete' }),
    });
    expectNoDiagnosticLeak(active, 'scenario/delete-preflight');
    expect(readActiveCheckoutSession).toHaveBeenCalled();
    expect(deleteBranch).not.toHaveBeenCalled();
  });
}
