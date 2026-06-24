import { jest } from '@jest/globals';

import { VERSION_GRAPH_MAIN_REF } from '../../../document/version-store/graph';
import { createProviderBackedCheckoutMaterializationService } from '../../../document/version-store/checkout-provider-service';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import {
  AUTHOR,
  DOCUMENT_SCOPE,
  createWorkbook,
  expectGraphWriteSuccess,
  expectInitializeSuccess,
  initializeInput,
} from './version-checkout-test-utils';

describe('WorkbookVersion checkout provider planning', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes checkout planning through the provider-backed workbook versioning service', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(
      wb.version.checkout({ kind: 'commit', id: initialized.rootCommit.id }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        mutationGuarantee: 'no-workbook-mutation',
        plan: {
          strategy: 'fullSnapshot',
          commitId: initialized.rootCommit.id,
          parentCommitIds: [],
          target: {
            kind: 'commit',
            commitId: initialized.rootCommit.id,
          },
          requiredDependencies: [
            { role: 'snapshotRoot', objectType: 'workbook.snapshotRoot.v1' },
            { role: 'semanticChangeSet', objectType: 'workbook.semanticChangeSet.v1' },
          ],
          requiredDependencyCount: 2,
        },
        diagnostics: [],
      },
    });

    await expect(wb.version.getHead()).resolves.toMatchObject({
      ok: true,
      value: {
        id: initialized.rootCommit.id,
        refName: VERSION_GRAPH_MAIN_REF,
        resolvedFrom: 'HEAD',
        refRevision: initialized.initialHead.revision,
      },
    });
  });

  it('resolves provider-backed checkout planning for a non-main live branch ref', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    const childInput = await initializeInput('graph-1', 'scenario-target');
    const child = await graph.commit({
      ...childInput.rootWrite,
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
    });
    expectGraphWriteSuccess(child);
    const branch = graph.refStore.createBranch({
      name: 'scenario/checkout',
      targetCommitId: child.commit.id,
      expectedAbsent: true,
      baseCommitId: initialized.rootCommit.id,
      createdBy: AUTHOR,
    });
    expect(branch.ok).toBe(true);
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(
      wb.version.checkout({ kind: 'ref', name: 'refs/heads/scenario/checkout' as any }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        mutationGuarantee: 'no-workbook-mutation',
        plan: {
          strategy: 'fullSnapshot',
          commitId: child.commit.id,
          parentCommitIds: [initialized.rootCommit.id],
          target: {
            kind: 'ref',
            refName: 'refs/heads/scenario/checkout',
            commitId: child.commit.id,
            refRevision: branch.ref.refVersion,
            refIncarnationId: branch.ref.refIncarnationId,
          },
          requiredDependencyCount: 2,
        },
        diagnostics: [],
      },
    });
  });

  it('resolves provider-backed checkout service HEAD planning through an injected active branch reader', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    const childInput = await initializeInput('graph-1', 'scenario-target');
    const child = await graph.commit({
      ...childInput.rootWrite,
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
    });
    expectGraphWriteSuccess(child);
    const branch = graph.refStore.createBranch({
      name: 'scenario/checkout',
      targetCommitId: child.commit.id,
      expectedAbsent: true,
      baseCommitId: initialized.rootCommit.id,
      createdBy: AUTHOR,
    });
    expect(branch.ok).toBe(true);
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);
    const checkoutService = createProviderBackedCheckoutMaterializationService({
      provider,
      checkoutHeadReaderFactory: () => ({
        readHead: async () => ({
          ok: true,
          head: {
            mode: 'attached',
            refName: 'scenario/checkout',
            commitId: child.commit.id,
            refVersion: branch.ref.refVersion,
            refIncarnationId: branch.ref.refIncarnationId,
          },
          diagnostics: [],
        }),
      }),
    });

    await expect(
      checkoutService.planCheckout({ target: 'ref', refName: 'HEAD' }),
    ).resolves.toMatchObject({
      ok: true,
      materialization: 'planned',
      mutationGuarantee: 'no-workbook-mutation',
      plan: {
        strategy: 'fullSnapshot',
        commitId: child.commit.id,
        parentCommitIds: [initialized.rootCommit.id],
        resolvedTarget: {
          kind: 'head',
          refName: 'scenario/checkout',
          commitId: child.commit.id,
          refVersion: branch.ref.refVersion,
          refIncarnationId: branch.ref.refIncarnationId,
        },
      },
      diagnostics: [],
    });
  });
});
