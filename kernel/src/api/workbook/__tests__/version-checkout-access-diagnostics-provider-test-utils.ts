import type { VersionGraphReadRefResult } from '../../../document/version-store/graph';
import type { VersionStoreProvider } from '../../../document/version-store/provider';

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
