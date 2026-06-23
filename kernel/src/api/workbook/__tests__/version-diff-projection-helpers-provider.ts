import type { VersionStoreProvider } from '../../../document/version-store/provider';

export function providerWithPermutedSemanticReads(
  provider: VersionStoreProvider,
  permutations: readonly (readonly number[])[],
): VersionStoreProvider {
  let readCount = 0;
  return {
    documentScope: provider.documentScope,
    accessContext: provider.accessContext,
    capabilities: provider.capabilities,
    readGraphRegistry: () => provider.readGraphRegistry(),
    initializeGraph: (input) => provider.initializeGraph(input),
    scanDocumentIntegrity: (options) => provider.scanDocumentIntegrity(options),
    close: (reason) => provider.close(reason),
    dispose: (reason) => provider.dispose(reason),
    openGraph: async (namespace, accessContext) => {
      const graph = await provider.openGraph(namespace, accessContext);
      return new Proxy(graph, {
        get(target, property, receiver) {
          if (property === 'getObjectRecord') {
            return async <TPayload>(ref: Parameters<typeof graph.getObjectRecord<TPayload>>[0]) => {
              const record = await graph.getObjectRecord<TPayload>(ref);
              if (record.preimage.objectType !== 'workbook.semanticChangeSet.v1') return record;
              const payload = record.preimage.payload;
              if (!isRecord(payload)) return record;
              const permutation = permutations[readCount++ % permutations.length] ?? [];
              return {
                ...record,
                preimage: {
                  ...record.preimage,
                  payload: {
                    ...payload,
                    ...(Array.isArray(payload.changes)
                      ? { changes: permute(payload.changes, permutation) }
                      : {}),
                    ...(Array.isArray(payload.reviewChanges)
                      ? { reviewChanges: permute(payload.reviewChanges, permutation) }
                      : {}),
                  } as TPayload,
                },
              };
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
}

function permute<T>(values: readonly T[], permutation: readonly number[]): readonly T[] {
  if (permutation.length !== values.length) return values;
  return permutation.map((index) => values[index]).filter((value) => value !== undefined);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
