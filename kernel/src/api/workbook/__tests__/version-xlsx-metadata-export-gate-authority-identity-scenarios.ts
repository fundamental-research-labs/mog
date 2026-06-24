import { maybeAddMogVersionMetadataToXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import {
  blockedMetadataSink,
  COPIED_METADATA_DOCUMENT_ID,
  createSourceXlsx,
  expectAuthorityExportBlocked,
  expectMogMetadataExportBlocked,
  metadataExportAuthorityProvider,
  metadataExportContext,
  METADATA_EXPORT_DOCUMENT_ID,
  METADATA_EXPORT_GRAPH_ID,
  METADATA_EXPORT_WORKSPACE_ID,
  OLD_METADATA_COMMIT_ID,
  OTHER_METADATA_EXPORT_WORKSPACE_ID,
  REF_REVISION,
  versionHead,
} from './version-xlsx-metadata-export-gate-test-helpers';

export function registerAuthorityIdentityScenarios(): void {
  it('blocks Mog version metadata sidecar export when the provider is bound to another document', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });

    await expectMogMetadataExportBlocked(
      maybeAddMogVersionMetadataToXlsx(
        metadataExportContext({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          provider: metadataExportAuthorityProvider({
            documentId: COPIED_METADATA_DOCUMENT_ID,
            head: currentHead,
          }),
        }),
        { getHead: async () => ({ ok: true, value: currentHead }) } as Parameters<
          typeof maybeAddMogVersionMetadataToXlsx
        >[1],
        await createSourceXlsx(),
        { versionMetadata: 'include' },
        blockedMetadataSink(),
      ),
      'head-unverified',
    );
  });

  it('blocks Mog version metadata sidecar export when the provider is bound to another workspace', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });

    await expectAuthorityExportBlocked(
      {
        contextWorkspaceId: METADATA_EXPORT_WORKSPACE_ID,
        provider: {
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          workspaceId: OTHER_METADATA_EXPORT_WORKSPACE_ID,
          head: currentHead,
        },
      },
      'head-unverified',
    );
  });

  it('blocks Mog version metadata sidecar export when the visible registry names another document', async () => {
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
            registryDocumentId: COPIED_METADATA_DOCUMENT_ID,
          }),
        }),
        { getHead: async () => ({ ok: true, value: currentHead }) } as Parameters<
          typeof maybeAddMogVersionMetadataToXlsx
        >[1],
        await createSourceXlsx(),
        { versionMetadata: 'include' },
        blockedMetadataSink(),
      ),
      'head-unverified',
    );
  });

  it.each([
    ['registry', { registryWorkspaceId: OTHER_METADATA_EXPORT_WORKSPACE_ID }],
    ['opened graph', { graphNamespaceWorkspaceId: OTHER_METADATA_EXPORT_WORKSPACE_ID }],
  ])(
    'blocks Mog version metadata sidecar export when the %s workspace is stale',
    async (_case, staleWorkspaceInput) => {
      const currentHead = versionHead({
        id: OLD_METADATA_COMMIT_ID,
        refRevision: REF_REVISION,
      });

      await expectAuthorityExportBlocked(
        {
          provider: {
            documentId: METADATA_EXPORT_DOCUMENT_ID,
            workspaceId: METADATA_EXPORT_WORKSPACE_ID,
            head: currentHead,
            ...staleWorkspaceInput,
          },
        },
        'head-unverified',
      );
    },
  );

  it('blocks Mog version metadata sidecar export when the opened graph identity is not the registry graph', async () => {
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
            graphNamespaceGraphId: `${METADATA_EXPORT_GRAPH_ID}-wrong`,
          }),
        }),
        { getHead: async () => ({ ok: true, value: currentHead }) } as Parameters<
          typeof maybeAddMogVersionMetadataToXlsx
        >[1],
        await createSourceXlsx(),
        { versionMetadata: 'include' },
        blockedMetadataSink(),
      ),
      'head-unverified',
    );
  });
}
