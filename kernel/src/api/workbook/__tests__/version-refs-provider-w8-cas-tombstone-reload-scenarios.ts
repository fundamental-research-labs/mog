import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../../../document/version-store/provider';
import {
  DOCUMENT_SCOPE,
  createProviderWorkbook,
  expectInitializeSuccess,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
  initializeInput,
} from './version-refs-provider-w8-test-utils';

export function registerProviderW8CasTombstoneReloadScenarios(): void {
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
}
