import { expect } from '@jest/globals';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

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

export function createCtx(versioning: Record<string, unknown>) {
  return { versioning: withVersionManifest(versioning) } as any;
}

export async function initializeVersionGraph(): Promise<{
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

export function providerWithDeniedRef<T extends VersionStoreProvider>(
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

export function providerWithDeniedOpenGraph<T extends VersionStoreProvider>(provider: T): T {
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

export function expectNoDiagnosticLeaks(result: unknown, forbidden: readonly string[]): void {
  const serialized = JSON.stringify(result);
  for (const value of forbidden) {
    expect(serialized).not.toContain(value);
  }
}
