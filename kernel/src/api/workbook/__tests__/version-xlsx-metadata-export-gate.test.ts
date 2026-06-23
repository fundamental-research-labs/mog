import 'fake-indexeddb/auto';

import {
  addMogVersionMetadataToXlsx,
  maybeAddMogVersionMetadataToXlsx,
  MOG_VERSION_METADATA_PART,
  readAndValidateMogVersionMetadataFromXlsx,
} from '../xlsx-version-metadata';
import { REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS } from '../version-xlsx-metadata-export-gate';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import {
  blockedMetadataSink,
  CLEAN_EXPORT_DOCUMENT_ID,
  createSourceXlsx,
  decodeUtf8,
  expectCleanExportOmitsImportedMetadata,
  expectedMetadataHead,
  metadataExportAuthorityProvider,
  metadataExportContext,
  METADATA_EXPORT_DOCUMENT_ID,
  OLD_METADATA_COMMIT_ID,
  OTHER_METADATA_COMMIT_ID,
  REF_REVISION,
  SEMANTIC_CHANGE_SET_DIGEST,
  SNAPSHOT_ROOT_DIGEST,
  STALE_IMPORTED_DOCUMENT_ID,
  testVersionMetadata,
  versionHead,
} from './version-xlsx-metadata-export-gate-test-helpers';

beforeEach(deleteVersionStoreIndexedDbForTesting);
afterEach(deleteVersionStoreIndexedDbForTesting);

describe('VC-10 XLSX metadata export gating - clean and authorized flows', () => {
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

  it('writes trusted Mog version metadata sidecar when export explicitly opts in', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });

    const exported = await maybeAddMogVersionMetadataToXlsx(
      metadataExportContext({
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        provider: metadataExportAuthorityProvider({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          head: currentHead,
        }),
      }),
      { getHead: async () => ({ ok: true, value: currentHead }) } as Parameters<
        typeof maybeAddMogVersionMetadataToXlsx
      >[1],
      await createSourceXlsx(),
      { versionMetadata: 'include' },
    );

    const metadata = readAndValidateMogVersionMetadataFromXlsx(exported, {
      expectedDocumentId: METADATA_EXPORT_DOCUMENT_ID,
      expectedHead: expectedMetadataHead(currentHead),
      currentHead: expectedMetadataHead(currentHead),
    });
    expect(metadata).toMatchObject({
      status: 'trusted',
      metadata: {
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        diagnostics: [],
        head: {
          commitId: OLD_METADATA_COMMIT_ID,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
        redaction: {
          policy: 'commit-document-and-object-digests-only',
          omitted: expect.arrayContaining(REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS),
        },
      },
      trust: {
        status: 'trusted',
        sidecarPart: MOG_VERSION_METADATA_PART,
        redacted: true,
      },
      diagnostics: [],
    });
  });

  it('replaces a stale imported Mog version metadata sidecar when opt-in export is authorized', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });
    const xlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: STALE_IMPORTED_DOCUMENT_ID,
        commitId: OTHER_METADATA_COMMIT_ID,
      }),
    );

    const exported = await maybeAddMogVersionMetadataToXlsx(
      metadataExportContext({
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        provider: metadataExportAuthorityProvider({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          head: currentHead,
        }),
      }),
      { getHead: async () => ({ ok: true, value: currentHead }) } as Parameters<
        typeof maybeAddMogVersionMetadataToXlsx
      >[1],
      xlsxBytes,
      { versionMetadata: 'include' },
    );

    const metadata = readAndValidateMogVersionMetadataFromXlsx(exported, {
      expectedDocumentId: METADATA_EXPORT_DOCUMENT_ID,
      expectedHead: expectedMetadataHead(currentHead),
      currentHead: expectedMetadataHead(currentHead),
    });
    expect(metadata).toMatchObject({
      status: 'trusted',
      metadata: {
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        head: {
          commitId: OLD_METADATA_COMMIT_ID,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      },
    });
    expect(JSON.stringify(metadata)).not.toContain(STALE_IMPORTED_DOCUMENT_ID);
    expect(JSON.stringify(metadata)).not.toContain(OTHER_METADATA_COMMIT_ID);
  });
});
