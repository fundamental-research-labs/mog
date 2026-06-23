import type { VersionDependencyRef } from './object-digest';
import { VersionObjectStoreError, type VersionObjectStore } from './object-store';
import type { VersionGraphStore } from './provider';
import { diagnostic, type DiffServiceDiagnostic } from './diff-service-diagnostics';

export type VersionObjectRecordReader = Pick<VersionObjectStore, 'getObjectRecord'>;

export function objectStoreFromGraph(graph: VersionGraphStore): VersionObjectRecordReader | null {
  if (typeof graph.getObjectRecord === 'function') return graph;

  const candidate = (graph as { readonly objectStore?: unknown }).objectStore;
  if (!candidate || typeof candidate !== 'object') return null;
  const maybe = candidate as Partial<VersionObjectStore>;
  return typeof maybe.getObjectRecord === 'function'
    ? (candidate as VersionObjectRecordReader)
    : null;
}

export async function readSemanticChangeSet(
  objectStore: VersionObjectRecordReader,
  digest: VersionDependencyRef['digest'],
): Promise<
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly diagnostics: readonly DiffServiceDiagnostic[] }
> {
  try {
    const record = await objectStore.getObjectRecord<unknown>({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest,
    });
    return { ok: true, payload: record.preimage.payload };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          error instanceof VersionObjectStoreError &&
            error.diagnostic.code === 'VERSION_OBJECT_NOT_FOUND'
            ? 'VERSION_UNMATERIALIZABLE_COMMIT'
            : 'VERSION_PROVIDER_ERROR',
          'Target commit semantic change-set object could not be read.',
          {
            recoverability: error instanceof VersionObjectStoreError ? 'repair' : 'retry',
          },
        ),
      ],
    };
  }
}
