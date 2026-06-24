import {
  captureNormalCommit,
  openLifecycleWorkbook,
  putRegistryEnvelope,
  resetIndexedDbVersionStoreForTesting,
} from './provider-indexeddb-lifecycle-test-utils';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../provider-indexeddb/backend';
import { createVersionGraphRegistry, type VersionDocumentScope } from '../provider';

describe('IndexedDB version provider document/workbook lifecycle registry failures', () => {
  it('fails closed for corrupt and unsupported registries through wb.version reads', async () => {
    const documentId = 'vc04-lifecycle-corrupt';
    const documentScope: VersionDocumentScope = { documentId };
    const corrupt = await createVersionGraphRegistry({
      documentScope,
      graphId: 'graph-corrupt',
      rootCommitId: `commit:sha256:${'a'.repeat(64)}`,
      createdAt: '2026-06-20T00:00:00.000Z',
    });
    await putRegistryEnvelope(documentScope, {
      schemaVersion: 1,
      registry: {
        ...corrupt,
        registryChecksum: { ...corrupt.registryChecksum, digest: '0'.repeat(64) },
      },
    });

    const corruptWorkbook = await openLifecycleWorkbook(documentId, {
      providerSelection: { kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND },
      captureNormalCommit,
    });
    await expect(corruptWorkbook.wb.version.getHead()).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_CORRUPT_REGISTRY' })],
      },
    });
    await expect(corruptWorkbook.wb.version.listCommits()).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_CORRUPT_REGISTRY' })],
      },
    });
    await corruptWorkbook.handle.dispose();

    await resetIndexedDbVersionStoreForTesting();
    await putRegistryEnvelope(documentScope, { schemaVersion: 99, registry: null });
    const unsupportedWorkbook = await openLifecycleWorkbook(documentId, {
      providerSelection: { kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND },
      captureNormalCommit,
    });
    await expect(unsupportedWorkbook.wb.version.getHead()).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_UNSUPPORTED_REGISTRY' })],
      },
    });
    await unsupportedWorkbook.handle.dispose();
  });
});
