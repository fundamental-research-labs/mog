import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import {
  DOCUMENT_SCOPE,
  commitGraphChild,
  createProviderWorkbook,
  expectInitializeSuccess,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
  expectOneSuccessOneFailure,
  initializeInput,
} from './version-refs-provider-w8-test-utils';

export function registerProviderW8CasRaceScenarios(): void {
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
}
