import {
  commitProviderGraphChild,
  createProviderGraphFixture,
} from './version-refs-provider-fixtures';
import {
  createWorkbook,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
} from './version-refs-provider-test-utils';

export function registerProviderRefConflictGuardScenarios(): void {
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
}
