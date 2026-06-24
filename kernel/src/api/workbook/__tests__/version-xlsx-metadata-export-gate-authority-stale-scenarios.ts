import { maybeAddMogVersionMetadataToXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import {
  blockedMetadataSink,
  createSourceXlsx,
  expectAuthorityExportBlocked,
  expectMogMetadataExportBlocked,
  metadataExportAuthorityProvider,
  metadataExportContext,
  METADATA_EXPORT_DOCUMENT_ID,
  OLD_METADATA_COMMIT_ID,
  OTHER_METADATA_COMMIT_ID,
  OTHER_REF_REVISION,
  REF_REVISION,
  STALE_SOURCE_ROOT_COMMIT_ID,
  versionHead,
} from './version-xlsx-metadata-export-gate-test-helpers';

export function registerAuthorityStaleScenarios(): void {
  it('blocks Mog version metadata sidecar export when current head authority is stale', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });
    const staleAuthorityHead = versionHead({
      id: OTHER_METADATA_COMMIT_ID,
      refRevision: OTHER_REF_REVISION,
    });

    await expectMogMetadataExportBlocked(
      maybeAddMogVersionMetadataToXlsx(
        metadataExportContext({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          provider: metadataExportAuthorityProvider({
            documentId: METADATA_EXPORT_DOCUMENT_ID,
            head: staleAuthorityHead,
          }),
        }),
        { getHead: async () => ({ ok: true, value: currentHead }) } as Parameters<
          typeof maybeAddMogVersionMetadataToXlsx
        >[1],
        await createSourceXlsx(),
        { versionMetadata: 'include' },
        blockedMetadataSink(),
      ),
      'stale-head',
    );
  });

  it('blocks Mog version metadata sidecar export when the exported ref revision is stale', async () => {
    const staleExportedHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: OTHER_REF_REVISION,
    });
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });

    await expectAuthorityExportBlocked(
      {
        exportedHead: staleExportedHead,
        provider: { documentId: METADATA_EXPORT_DOCUMENT_ID, head: currentHead },
      },
      'stale-head',
    );
  });

  it('blocks Mog version metadata sidecar export when the registry source root is stale', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });

    await expectMogMetadataExportBlocked(
      maybeAddMogVersionMetadataToXlsx(
        metadataExportContext({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          provider: metadataExportAuthorityProvider({
            documentId: METADATA_EXPORT_DOCUMENT_ID,
            head: currentHead,
            registryRootCommitId: STALE_SOURCE_ROOT_COMMIT_ID,
            sourceRootInClosure: false,
          }),
        }),
        { getHead: async () => ({ ok: true, value: currentHead }) } as Parameters<
          typeof maybeAddMogVersionMetadataToXlsx
        >[1],
        await createSourceXlsx(),
        { versionMetadata: 'include' },
        blockedMetadataSink(),
      ),
      'stale-head',
    );
  });
}
