import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { checkoutWorkbookVersion } from '../version-checkout';
import {
  historyDenialClassForCheckoutIssue,
  recoverabilityForCheckoutIssue,
  safeMessageForCheckoutIssue,
} from '../version-checkout-diagnostics';
import { createProviderBackedCheckoutMaterializationService } from '../../../document/version-store/checkout-provider-service';
import type { VersionGraphReadRefResult } from '../../../document/version-store/graph-store';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionStoreProvider,
} from '../../../document/version-store/provider';
import { withVersionManifest } from './version-domain-support-test-utils';

const CREATED_AT = '2026-06-20T00:00:00.000Z';
const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'checkout-access-diagnostics-doc',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('WorkbookVersion checkout access diagnostics', () => {
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
});

function createCtx(versioning: Record<string, unknown>) {
  return { versioning: withVersionManifest(versioning) } as any;
}

async function initializeVersionGraph(): Promise<{
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  initialized: Extract<VersionGraphInitializeResult, { status: 'success' }>;
}> {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  return { provider, initialized };
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

function providerWithDeniedRef<T extends VersionStoreProvider>(
  provider: T,
  deniedRefName: string,
): T {
  return new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'openGraph') {
        return async (...args: Parameters<VersionStoreProvider['openGraph']>) => {
          const graph = await target.openGraph(...args);
          return new Proxy(graph, {
            get(graphTarget, graphProp, graphReceiver) {
              if (graphProp === 'readRef') {
                return async (name: string): Promise<VersionGraphReadRefResult> => {
                  if (name === deniedRefName) {
                    return {
                      status: 'degraded',
                      ref: null,
                      diagnostics: [
                        {
                          code: 'VERSION_PERMISSION_DENIED',
                          severity: 'error',
                          message: 'Cannot read hidden-sheet-42 for principal-secret-7.',
                          details: {
                            category: 'subset-hidden',
                            deniedPrincipalId: 'principal-secret-7',
                          },
                        } as any,
                      ],
                    };
                  }
                  return graph.readRef(name);
                };
              }
              const value = Reflect.get(graphTarget, graphProp, graphReceiver);
              return typeof value === 'function' ? value.bind(graphTarget) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as T;
}

function providerWithDeniedOpenGraph<T extends VersionStoreProvider>(provider: T): T {
  return new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'openGraph') {
        return async () => {
          throw Object.assign(new Error('workspace-secret-9 open denied'), {
            diagnostics: [
              {
                code: 'VERSION_PERMISSION_DENIED',
                issueCode: 'VERSION_PERMISSION_DENIED',
                severity: 'error',
                recoverability: 'unsupported',
                messageTemplateId: 'version.checkout.accessDenied',
                safeMessage: 'Version graph access is denied for this caller.',
                redacted: true,
                details: {
                  category: 'permission-denied',
                  providerDocumentScopeKey: 'providerDocumentScopeKey',
                },
              },
            ],
          });
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as T;
}

function expectNoDiagnosticLeaks(result: unknown, forbidden: readonly string[]): void {
  const serialized = JSON.stringify(result);
  for (const value of forbidden) {
    expect(serialized).not.toContain(value);
  }
}
