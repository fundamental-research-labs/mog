import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  DOCUMENT_SCOPE,
  expectPublicDiagnosticsNotToLeak,
  initializeVersionGraph,
  installProviderLifecycleDocumentFactoryHooks,
} from './version-checkout-provider-lifecycle-test-utils';
import { withVersionManifest } from './version-domain-support-test-utils';

const providerLifecycle = installProviderLifecycleDocumentFactoryHooks();

describe('WorkbookVersion provider-backed checkout materialization identity lifecycle guards', () => {
  it.each([
    ['workspace', { ...DOCUMENT_SCOPE, workspaceId: 'workspace-2' }, ['workspace-2']],
    [
      'document',
      { ...DOCUMENT_SCOPE, documentId: 'checkout-provider-lifecycle-stale-materialized-doc' },
      ['checkout-provider-lifecycle-stale-materialized-doc'],
    ],
    ['principal', { ...DOCUMENT_SCOPE, principalScope: 'principal-2' }, ['principal-2']],
  ] as const)(
    'fails closed when a fresh checkout reload carries stale %s materializer identity',
    async (providerIdentityClass, materializationScope, forbiddenRawIds) => {
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
        await sourceWb.activeSheet.setCell('A1', 'target-materialization-identity');
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
          versioning: withVersionManifest({ provider }),
        });
        await checkoutWb.activeSheet.setCell('A1', 'active-before-materialization-identity-fence');
        checkoutWb.markClean();
        providerLifecycle.setStaleMaterializationVersioningScope(materializationScope);

        const checkoutResult = await checkoutWb.version.checkout({
          kind: 'commit',
          id: committed.id,
        });
        expect(checkoutResult).toMatchObject({
          ok: false,
          error: {
            diagnostics: [
              expect.objectContaining({
                code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
                data: expect.objectContaining({
                  redacted: true,
                  payload: expect.objectContaining({
                    commitId: 'redacted',
                    cause: 'VersionCheckoutRebindMaterializationIdentityError',
                    identityFenceReason: 'materializationIdentityStale',
                    providerIdentityClass:
                      providerIdentityClass === 'principal' ? 'redacted' : providerIdentityClass,
                    mutationGuarantee: 'unknown-after-partial-mutation',
                    rollbackSafe: false,
                    partialSnapshot: true,
                  }),
                }),
              }),
            ],
          },
        });
        expectPublicDiagnosticsNotToLeak(checkoutResult, [
          ...forbiddenRawIds,
          'providerDocumentScopeKey',
        ]);
        expect(providerLifecycle.internalMaterializationCreateCount()).toBeGreaterThan(0);
        await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({
          value: 'active-before-materialization-identity-fence',
        });
      } finally {
        if (checkoutWb) await checkoutWb.close('skipSave');
        if (sourceWb) await sourceWb.close('skipSave');
        await checkoutHandle.dispose();
        await sourceHandle.dispose();
      }
    },
  );
});
