import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../../../document/version-store/provider';
import {
  commitProviderGraphChild,
  createProviderGraphFixture,
} from './version-refs-provider-fixtures';
import {
  DOCUMENT_SCOPE,
  createWorkbook,
  expectInitializeSuccess,
  initializeInput,
} from './version-refs-provider-test-utils';

export function registerProviderRefLifecycleFacadeScenarios(): void {
  it('routes public branch refs through the provider-attached lifecycle service', async () => {
    const fixture = await createProviderGraphFixture();
    const { initialized, provider } = fixture;
    const child = await commitProviderGraphChild(fixture, 'branch-target');

    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(
      wb.version.createBranch({
        name: 'scenario/provider/ref' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/provider/ref',
        commitId: initialized.rootCommit.id,
        revision: { kind: 'counter', value: '0' },
      },
    });

    await expect(
      wb.version.readRef('refs/heads/scenario/provider/ref' as any),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'refs/heads/scenario/provider/ref',
          commitId: initialized.rootCommit.id,
          revision: { kind: 'counter', value: '0' },
        },
        diagnostics: [],
      },
    });

    await expect(wb.version.listRefs({ prefix: 'scenario' as any })).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({
            name: 'refs/heads/scenario/provider/ref',
            commitId: initialized.rootCommit.id,
          }),
        ],
        limit: 50,
      },
    });

    await expect(
      wb.version.listRefs({ prefix: 'refs/heads/scenario/provider' as any }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({
            name: 'refs/heads/scenario/provider/ref',
            commitId: initialized.rootCommit.id,
          }),
        ],
        limit: 50,
      },
    });

    await expect(
      wb.version.fastForwardBranch({
        name: 'scenario/provider/ref' as any,
        nextCommitId: child.commit.id,
        expectedHead: initialized.rootCommit.id,
        expectedRefRevision: { kind: 'counter', value: '0' },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/provider/ref',
        commitId: child.commit.id,
        revision: { kind: 'counter', value: '1' },
      },
    });

    const status = await wb.version.getStatus();
    expect(status.refLifecycleFoundation).toMatchObject({
      stage: 'present',
      available: true,
      diagnostics: [expect.objectContaining({ code: 'version.refLifecycle.foundationPresent' })],
    });
  });

  it('fails closed for branch writes when the provider is read-only', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const writer = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
    });
    const initialized = await writer.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
      readOnly: true,
    });
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(wb.version.listRefs()).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({
            name: 'refs/heads/main',
            commitId: initialized.rootCommit.id,
          }),
        ],
        limit: 50,
      },
    });

    await expect(
      wb.version.createBranch({
        name: 'scenario/read-only' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REF_WRITE_UNAVAILABLE',
            data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
          }),
        ],
      },
    });

    await expect(wb.version.listRefs({ prefix: 'scenario' as any })).resolves.toMatchObject({
      ok: true,
      value: {
        items: [],
        limit: 50,
      },
    });
  });
}
