import type { VersionGraphNamespace } from '../object-store';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
import type { VersionDocumentScope, VersionStoreDiagnostic } from '../provider';

export async function openGraphDiagnostic(
  documentScope: VersionDocumentScope,
  namespace: VersionGraphNamespace,
): Promise<VersionStoreDiagnostic> {
  const provider = createIndexedDbVersionStoreProvider({ documentScope });
  try {
    await provider.openGraph(namespace);
  } catch (error) {
    await provider.close('test-teardown');
    const diagnostic = (error as { readonly diagnostic?: VersionStoreDiagnostic }).diagnostic;
    if (diagnostic) return diagnostic;
    throw error;
  }
  await provider.close('test-teardown');
  throw new Error('expected openGraph to fail');
}
