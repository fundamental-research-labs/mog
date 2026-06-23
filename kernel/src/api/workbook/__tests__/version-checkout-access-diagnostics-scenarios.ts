import { expect, it } from '@jest/globals';

import { checkoutWorkbookVersion } from '../version-checkout';
import {
  historyDenialClassForCheckoutIssue,
  recoverabilityForCheckoutIssue,
  safeMessageForCheckoutIssue,
} from '../version-checkout-diagnostics';
import { createProviderBackedCheckoutMaterializationService } from '../../../document/version-store/checkout-provider-service';
import {
  createCtx,
  expectNoDiagnosticLeaks,
  initializeVersionGraph,
  providerWithDeniedOpenGraph,
  providerWithDeniedRef,
} from './version-checkout-access-diagnostics-test-utils';

export function registerCheckoutAccessDiagnosticsScenarios(): void {
  it('classifies access, stale, and corrupt checkout history denials deterministically', () => {
    expect(
      [
        'VERSION_PERMISSION_DENIED',
        'VERSION_STALE_PAGE_CURSOR',
        'VERSION_REF_CONFLICT',
        'VERSION_DANGLING_REF',
        'VERSION_MISSING_OBJECT',
        'VERSION_OBJECT_STORE_FAILURE',
      ].map((issueCode) => ({
        issueCode,
        historyDenialClass: historyDenialClassForCheckoutIssue(issueCode),
        recoverability: recoverabilityForCheckoutIssue(issueCode),
        safeMessage: safeMessageForCheckoutIssue(issueCode),
      })),
    ).toEqual([
      {
        issueCode: 'VERSION_PERMISSION_DENIED',
        historyDenialClass: 'access-denied',
        recoverability: 'unsupported',
        safeMessage: 'Checkout is not authorized for the requested version target.',
      },
      {
        issueCode: 'VERSION_STALE_PAGE_CURSOR',
        historyDenialClass: 'stale-history',
        recoverability: 'retry',
        safeMessage: 'Checkout history metadata is stale and must be refreshed before checkout.',
      },
      {
        issueCode: 'VERSION_REF_CONFLICT',
        historyDenialClass: 'stale-history',
        recoverability: 'retry',
        safeMessage:
          'Checkout is blocked because the version ref changed during checkout planning.',
      },
      {
        issueCode: 'VERSION_DANGLING_REF',
        historyDenialClass: 'missing-graph-state',
        recoverability: 'repair',
        safeMessage:
          'Checkout cannot resolve the target because version history points at missing graph state.',
      },
      {
        issueCode: 'VERSION_MISSING_OBJECT',
        historyDenialClass: 'missing-graph-state',
        recoverability: 'repair',
        safeMessage:
          'Checkout cannot resolve the target because required version graph state is missing.',
      },
      {
        issueCode: 'VERSION_OBJECT_STORE_FAILURE',
        historyDenialClass: 'corrupt-graph-state',
        recoverability: 'repair',
        safeMessage:
          'Checkout cannot materialize the target because version graph state is corrupt or unsupported.',
      },
    ]);
  });

  it('redacts provider-backed access-denied subset ref diagnostics', async () => {
    const { provider } = await initializeVersionGraph();
    const deniedProvider = providerWithDeniedRef(
      provider,
      'refs/heads/scenario/subset-hidden',
    );
    const checkoutService = createProviderBackedCheckoutMaterializationService({
      provider: deniedProvider,
    });

    const result = await checkoutWorkbookVersion(
      createCtx({ checkoutService }),
      { kind: 'ref', name: 'refs/heads/scenario/subset-hidden' as any },
    );

    expect(result).toMatchObject({
      status: 'degraded',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_PERMISSION_DENIED',
          recoverability: 'unsupported',
          redacted: true,
          payload: expect.objectContaining({
            operation: 'checkout',
            targetKind: 'ref',
            refName: 'refs/heads/scenario/subset-hidden',
            cause: 'VERSION_PERMISSION_DENIED',
            accessCategory: 'subset-hidden',
          }),
        }),
      ],
      mutationGuarantee: 'no-workbook-mutation',
    });
    expectNoDiagnosticLeaks(result, ['principal-secret-7', 'hidden-sheet-42']);
  });

  it('redacts provider identity details when visible graph access is denied', async () => {
    const { provider } = await initializeVersionGraph();
    const checkoutService = createProviderBackedCheckoutMaterializationService({
      provider: providerWithDeniedOpenGraph(provider),
    });

    const result = await checkoutWorkbookVersion(createCtx({ checkoutService }), {
      kind: 'head',
    });

    expect(result).toMatchObject({
      status: 'degraded',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_PERMISSION_DENIED',
          recoverability: 'unsupported',
          payload: expect.objectContaining({
            operation: 'checkout',
            targetKind: 'head',
            refName: 'HEAD',
            cause: 'VERSION_PERMISSION_DENIED',
            accessCategory: 'permission-denied',
          }),
        }),
      ],
    });
    expectNoDiagnosticLeaks(result, ['workspace-secret-9', 'providerDocumentScopeKey']);
  });

  it('reports materializer failures after a partial snapshot as non-rollback-safe', async () => {
    const commitId = `commit:sha256:${'7'.repeat(64)}` as const;
    const checkoutService = {
      checkout: async () => ({
        ok: false as const,
        error: {
          code: 'checkoutSnapshotApplyFailed' as const,
          message: 'snapshot publish failed',
        },
        diagnostics: [
          {
            code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED' as const,
            severity: 'error' as const,
            message: 'raw providerDocumentScopeKey=provider-secret-doc',
            commitId,
            details: {
              cause: 'publishFailed',
              partialSnapshot: true,
              providerDocumentScopeKey: 'provider-secret-doc',
            },
          },
        ],
        mutationGuarantee: 'unknown-after-partial-mutation' as const,
      }),
    };

    const result = await checkoutWorkbookVersion(
      createCtx({ checkoutService }),
      { kind: 'commit', id: commitId },
    );

    expect(result).toMatchObject({
      status: 'degraded',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
          recoverability: 'repair',
          payload: expect.objectContaining({
            commitId,
            cause: 'publishFailed',
            partialSnapshot: true,
            mutationGuarantee: 'unknown-after-partial-mutation',
            rollbackSafe: false,
          }),
        }),
      ],
      mutationGuarantee: 'unknown-after-partial-mutation',
    });
    expectNoDiagnosticLeaks(result, ['provider-secret-doc', 'providerDocumentScopeKey']);
  });

  it('keeps access-filtered and corrupt graph checkout denials distinct and redacted', async () => {
    const commitId = `commit:sha256:${'8'.repeat(64)}` as const;
    const checkoutService = {
      checkout: async () => ({
        ok: false as const,
        error: {
          code: 'checkoutProviderUnavailable' as const,
          message: 'history read denied',
        },
        diagnostics: [
          {
            code: 'VERSION_STALE_PAGE_CURSOR' as const,
            severity: 'error' as const,
            message: 'stale cursor contains raw-ref-secret',
            refName: 'provider/raw-ref-secret',
            details: {
              cause: 'VERSION_STALE_PAGE_CURSOR',
            },
            sourceDiagnostics: [
              {
                code: 'VERSION_PERMISSION_DENIED',
                severity: 'error',
                message: 'principal-secret-stale cannot read raw-ref-secret',
              },
            ],
          },
          {
            code: 'VERSION_DANGLING_REF' as const,
            severity: 'corruption' as const,
            message: 'dangling ref raw-ref-secret',
            refName: 'provider/raw-ref-secret',
            commitId,
            details: {
              cause: 'VERSION_MISSING_OBJECT',
            },
          },
          {
            code: 'VERSION_PERMISSION_DENIED' as const,
            severity: 'error' as const,
            message: 'principal-secret-denied cannot read raw-ref-secret',
            refName: 'provider/raw-ref-secret',
            details: {
              cause: 'VERSION_PERMISSION_DENIED',
              accessCategory: 'historical-acl-unavailable',
              deniedPrincipalId: 'principal-secret-denied',
            },
          },
        ],
        mutationGuarantee: 'no-workbook-mutation' as const,
      }),
    };

    const result = await checkoutWorkbookVersion(
      createCtx({ checkoutService }),
      { kind: 'commit', id: commitId },
    );

    expect(result).toMatchObject({
      status: 'degraded',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_STALE_PAGE_CURSOR',
          recoverability: 'retry',
          severity: 'error',
          redacted: true,
          payload: expect.objectContaining({
            operation: 'checkout',
            targetKind: 'commit',
            commitId,
            refName: 'redacted',
            cause: 'VERSION_STALE_PAGE_CURSOR',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_DANGLING_REF',
          recoverability: 'repair',
          severity: 'error',
          redacted: true,
          payload: expect.objectContaining({
            operation: 'checkout',
            targetKind: 'commit',
            commitId,
            refName: 'redacted',
            cause: 'VERSION_MISSING_OBJECT',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_PERMISSION_DENIED',
          recoverability: 'unsupported',
          severity: 'error',
          redacted: true,
          payload: expect.objectContaining({
            operation: 'checkout',
            targetKind: 'commit',
            commitId,
            refName: 'redacted',
            cause: 'VERSION_PERMISSION_DENIED',
            accessCategory: 'historical-acl-unavailable',
          }),
        }),
      ],
      mutationGuarantee: 'no-workbook-mutation',
    });
    expect(result.diagnostics.map((diagnostic) => diagnostic.issueCode)).toEqual([
      'VERSION_STALE_PAGE_CURSOR',
      'VERSION_DANGLING_REF',
      'VERSION_PERMISSION_DENIED',
    ]);
    expectNoDiagnosticLeaks(result, [
      'raw-ref-secret',
      'principal-secret-stale',
      'principal-secret-denied',
    ]);
  });
}
