import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  DOCUMENT_SCOPE,
  expectPublicDiagnosticsNotToLeak,
  initializeVersionGraph,
  installProviderLifecycleDocumentFactoryHooks,
  providerWithStaleRegistryRead,
  replaceVisibleRegistryGraph,
} from './version-checkout-provider-lifecycle-test-utils';
import { withVersionManifest } from './version-domain-support-test-utils';
import { InMemoryVersionDocumentProviderBackend } from '../../../document/version-store/provider';

installProviderLifecycleDocumentFactoryHooks();

describe('WorkbookVersion provider-backed checkout stale lifecycle guards', () => {
  it('blocks provider-backed checkout when the checked-out provider ref head is stale', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const checkoutHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await sourceWb.activeSheet.setCell('A1', 'branch-v1');
      const branchBaseResult = await sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!branchBaseResult.ok) {
        throw new Error(`expected branch base commit success: ${branchBaseResult.error.code}`);
      }
      const branchBase = branchBaseResult.value;
      sourceWb.markClean();

      const created = await sourceWb.version.createBranch({
        name: 'scenario/provider-admission' as any,
        targetCommitId: branchBase.id,
      });
      if (!created.ok) throw new Error(`expected branch create success: ${created.error.code}`);

      checkoutWb = await checkoutHandle.workbook({ versioning: withVersionManifest({ provider }) });
      checkoutWb.markClean();
      await expect(
        checkoutWb.version.checkout({
          kind: 'ref',
          name: 'refs/heads/scenario/provider-admission' as any,
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
        },
      });

      await sourceWb.activeSheet.setCell('A2', 'branch-v2');
      const movedResult = await sourceWb.version.commit({
        targetRef: 'refs/heads/scenario/provider-admission' as any,
        expectedHead: {
          commitId: branchBase.id,
          revision: created.value.revision,
        },
      });
      if (!movedResult.ok) {
        throw new Error(`expected moved branch commit success: ${movedResult.error.code}`);
      }
      const moved = movedResult.value;
      sourceWb.markClean();

      await expect(checkoutWb.version.getSurfaceStatus()).resolves.toMatchObject({
        current: {
          checkedOutCommitId: branchBase.id,
          branchName: 'scenario/provider-admission',
          refHeadAtMaterialization: branchBase.id,
          currentRefHeadId: moved.id,
          detached: false,
          stale: true,
          staleReason: 'refMoved',
        },
        dirty: {
          pendingProviderWrites: false,
          checkoutSafe: true,
        },
      });

      const staleCheckout = await checkoutWb.version.checkout({
        kind: 'ref',
        name: 'refs/heads/scenario/provider-admission' as any,
      });
      expect(staleCheckout).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
              data: expect.objectContaining({
                recoverability: 'retry',
                payload: expect.objectContaining({
                  reason: 'staleWorkspaceHead',
                  staleReason: 'refMoved',
                  targetKind: 'ref',
                  refName: 'redacted',
                  branchName: 'redacted',
                  checkedOutCommitId: 'redacted',
                  currentRefHeadId: 'redacted',
                  refHeadAtMaterialization: 'redacted',
                }),
              }),
            }),
          ],
        },
      });
      expectPublicDiagnosticsNotToLeak(staleCheckout, ['providerDocumentScopeKey']);
      await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'branch-v1',
      });
      await expect(checkoutWb.activeSheet.getCell('A2')).resolves.toMatchObject({
        value: null,
      });
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });

  it('leaves runtime head unchanged when the provider graph registry is stale during checkout', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const { provider, initialized } = await initializeVersionGraph({ backend });
    const stale = providerWithStaleRegistryRead(provider, initialized.registry);
    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const checkoutHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await sourceWb.activeSheet.setCell('A1', 'target-before-stale-registry');
      const committedResult = await sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!committedResult.ok) {
        throw new Error(`expected commit success: ${committedResult.error.code}`);
      }
      const committed = committedResult.value;
      sourceWb.markClean();

      checkoutWb = await checkoutHandle.workbook({
        versioning: withVersionManifest({ provider: stale.provider }),
      });
      await checkoutWb.activeSheet.setCell('A1', 'active-before-stale-registry-checkout');
      checkoutWb.markClean();

      await replaceVisibleRegistryGraph(backend, 'graph-2', 'replacement-root');
      stale.useStaleRegistryAfterLiveReads(1);

      const identityResult = await checkoutWb.version.checkout({
        kind: 'commit',
        id: committed.id,
      });
      expect(identityResult).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES',
              data: expect.objectContaining({
                redacted: true,
                payload: expect.objectContaining({
                  reason: 'pendingProviderWrites',
                  targetKind: 'commit',
                  commitId: 'redacted',
                }),
              }),
            }),
          ],
        },
      });
      expect(stale.openGraphCalls()).toBe(0);
      await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-stale-registry-checkout',
      });
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });
});
