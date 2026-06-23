import { jest } from '@jest/globals';

import {
  commitProviderGraphChild,
  createProviderGraphFixture,
} from './version-refs-provider-fixtures';
import {
  createWorkbook,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
  resetWorkbookProviderTestMocks,
} from './version-refs-provider-test-utils';

describe('WorkbookVersion provider-backed ref guard scenarios', () => {
  beforeEach(() => {
    resetWorkbookProviderTestMocks();
  });

  it('rejects symbolic HEAD, immutable main, and tag-shaped refs before provider write attempts', async () => {
    const fixture = await createProviderGraphFixture();
    const { initialized, provider } = fixture;
    const child = await commitProviderGraphChild(fixture, 'immutable-target');
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });
    const readGraphRegistry = jest.spyOn(provider, 'readGraphRegistry');
    const openGraph = jest.spyOn(provider, 'openGraph');
    const tagRef = 'refs/tags/release-secret' as any;

    const protectedHeadCreate = await wb.version.createBranch({
      name: 'HEAD' as any,
      targetCommitId: initialized.rootCommit.id,
    });
    expectNoWriteFailure(protectedHeadCreate, 'VERSION_PERMISSION_DENIED');

    const protectedHeadAdvance = await wb.version.fastForwardBranch({
      name: 'HEAD' as any,
      nextCommitId: child.commit.id,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(protectedHeadAdvance, 'VERSION_PERMISSION_DENIED');

    const protectedHeadDelete = await wb.version.deleteBranch({
      name: 'HEAD' as any,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(protectedHeadDelete, 'VERSION_PERMISSION_DENIED');

    const protectedCreate = await wb.version.createBranch({
      name: 'refs/heads/main' as any,
      targetCommitId: initialized.rootCommit.id,
    });
    expectNoWriteFailure(protectedCreate, 'VERSION_PERMISSION_DENIED', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });

    const protectedAdvance = await wb.version.fastForwardBranch({
      name: 'main' as any,
      nextCommitId: child.commit.id,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(protectedAdvance, 'VERSION_PERMISSION_DENIED', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });

    const protectedDelete = await wb.version.deleteRef({
      name: 'refs/heads/main' as any,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(protectedDelete, 'VERSION_PERMISSION_DENIED', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });

    const protectedDeleteBranch = await wb.version.deleteBranch({
      name: 'main' as any,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(protectedDeleteBranch, 'VERSION_PERMISSION_DENIED', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });

    const tagCreate = await wb.version.createBranch({
      name: tagRef,
      targetCommitId: initialized.rootCommit.id,
    });
    expectNoWriteFailure(tagCreate, 'VERSION_INVALID_OPTIONS', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });
    expectNoDiagnosticLeak(tagCreate, 'refs/tags/release-secret', 'release-secret');

    const tagAdvance = await wb.version.fastForwardBranch({
      name: tagRef,
      nextCommitId: child.commit.id,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(tagAdvance, 'VERSION_INVALID_OPTIONS', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });
    expectNoDiagnosticLeak(tagAdvance, 'refs/tags/release-secret', 'release-secret');

    const tagDelete = await wb.version.deleteRef({
      name: tagRef,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(tagDelete, 'VERSION_INVALID_OPTIONS', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });
    expectNoDiagnosticLeak(tagDelete, 'refs/tags/release-secret', 'release-secret');

    expect(readGraphRegistry).not.toHaveBeenCalled();
    expect(openGraph).not.toHaveBeenCalled();
  });

  it('surfaces duplicate provider branch names as redacted no-write conflicts', async () => {
    const { initialized, provider } = await createProviderGraphFixture();
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(
      wb.version.createBranch({
        name: 'scenario/duplicate' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/duplicate',
        commitId: initialized.rootCommit.id,
        revision: { kind: 'counter', value: '0' },
      },
    });

    const duplicate = await wb.version.createBranch({
      name: 'refs/heads/scenario/duplicate' as any,
      targetCommitId: initialized.rootCommit.id,
    });
    expectNoWriteFailure(duplicate, 'VERSION_REF_CONFLICT', {
      recoverability: 'retry',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(duplicate, 'scenario/duplicate');

    await expect(wb.version.readRef('refs/heads/scenario/duplicate' as any)).resolves.toMatchObject(
      {
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'refs/heads/scenario/duplicate',
            commitId: initialized.rootCommit.id,
            revision: { kind: 'counter', value: '0' },
          },
        },
      },
    );
    await expect(wb.version.listRefs({ prefix: 'scenario' as any })).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({
            name: 'refs/heads/scenario/duplicate',
            commitId: initialized.rootCommit.id,
          }),
        ],
        limit: 50,
      },
    });
  });

  it('keeps provider branches unchanged on stale fast-forward CAS failures', async () => {
    const fixture = await createProviderGraphFixture();
    const { initialized, provider } = fixture;
    const child = await commitProviderGraphChild(fixture, 'stale-cas-child');
    const next = await commitProviderGraphChild(fixture, 'stale-cas-next', {
      parentCommitId: child.commit.id,
      expectedMainRefVersion: child.ref.revision,
    });
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(
      wb.version.createBranch({
        name: 'scenario/stale-cas' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/stale-cas',
        commitId: initialized.rootCommit.id,
        revision: { kind: 'counter', value: '0' },
      },
    });

    await expect(
      wb.version.fastForwardBranch({
        name: 'scenario/stale-cas' as any,
        nextCommitId: child.commit.id,
        expectedHead: initialized.rootCommit.id,
        expectedRefRevision: { kind: 'counter', value: '0' },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/stale-cas',
        commitId: child.commit.id,
        revision: { kind: 'counter', value: '1' },
      },
    });

    const stale = await wb.version.fastForwardBranch({
      name: 'refs/heads/scenario/stale-cas' as any,
      nextCommitId: next.commit.id,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(stale, 'VERSION_REF_CONFLICT', {
      recoverability: 'retry',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
        conflict: 'expectedHeadMismatch',
      }),
    });
    expectNoDiagnosticLeak(stale, 'scenario/stale-cas');

    await expect(wb.version.readRef('refs/heads/scenario/stale-cas' as any)).resolves.toMatchObject(
      {
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'refs/heads/scenario/stale-cas',
            commitId: child.commit.id,
            revision: { kind: 'counter', value: '1' },
          },
        },
      },
    );
  });

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
});
