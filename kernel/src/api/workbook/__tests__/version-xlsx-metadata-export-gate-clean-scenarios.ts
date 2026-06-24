import {
  addMogVersionMetadataToXlsx,
  maybeAddMogVersionMetadataToXlsx,
  readAndValidateMogVersionMetadataFromXlsx,
} from '../version/xlsx-metadata/xlsx-version-metadata';
import {
  blockedMetadataSink,
  CLEAN_EXPORT_DOCUMENT_ID,
  createSourceXlsx,
  decodeUtf8,
  expectCleanExportOmitsImportedMetadata,
  metadataExportAuthorityProvider,
  metadataExportContext,
  OLD_METADATA_COMMIT_ID,
  REF_REVISION,
  SEMANTIC_CHANGE_SET_DIGEST,
  SNAPSHOT_ROOT_DIGEST,
  testVersionMetadata,
  versionHead,
} from './version-xlsx-metadata-export-gate-test-helpers';

export function registerCleanExportScenarios(): void {
  it('omits Mog version metadata by default on clean XLSX export', async () => {
    await expectCleanExportOmitsImportedMetadata(undefined);
  });

  it('omits Mog version metadata when clean XLSX export explicitly requests omit', async () => {
    await expectCleanExportOmitsImportedMetadata({ versionMetadata: 'omit' });
  });

  it('strips trusted-looking same-document Mog metadata on clean XLSX export without reading authority', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });
    const xlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: CLEAN_EXPORT_DOCUMENT_ID,
        commitId: OLD_METADATA_COMMIT_ID,
      }),
    );
    const dirtyArchiveText = decodeUtf8(xlsxBytes);
    expect(dirtyArchiveText).toContain(CLEAN_EXPORT_DOCUMENT_ID);
    expect(dirtyArchiveText).toContain(OLD_METADATA_COMMIT_ID);
    expect(dirtyArchiveText).toContain(SEMANTIC_CHANGE_SET_DIGEST.digest);
    expect(dirtyArchiveText).toContain(SNAPSHOT_ROOT_DIGEST.digest);

    const sinkWrites = { count: 0 };
    const exported = await maybeAddMogVersionMetadataToXlsx(
      metadataExportContext({
        documentId: CLEAN_EXPORT_DOCUMENT_ID,
        provider: metadataExportAuthorityProvider({
          documentId: CLEAN_EXPORT_DOCUMENT_ID,
          head: currentHead,
        }),
      }),
      {
        getHead: async () => {
          throw new Error('clean metadata export must not read the version head without opt-in');
        },
      } as Parameters<typeof maybeAddMogVersionMetadataToXlsx>[1],
      xlsxBytes,
      { versionMetadata: 'omit' },
      blockedMetadataSink(sinkWrites),
    );

    expect(sinkWrites.count).toBe(0);
    expect(
      readAndValidateMogVersionMetadataFromXlsx(exported, {
        expectedDocumentId: CLEAN_EXPORT_DOCUMENT_ID,
      }),
    ).toMatchObject({ status: 'absent' });
    const cleanArchiveText = decodeUtf8(exported);
    expect(cleanArchiveText).not.toContain(OLD_METADATA_COMMIT_ID);
    expect(cleanArchiveText).not.toContain(SEMANTIC_CHANGE_SET_DIGEST.digest);
    expect(cleanArchiveText).not.toContain(SNAPSHOT_ROOT_DIGEST.digest);
  });
}
