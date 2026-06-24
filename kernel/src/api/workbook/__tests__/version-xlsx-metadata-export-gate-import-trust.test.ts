import 'fake-indexeddb/auto';

import {
  addMogVersionMetadataToXlsx,
  MOG_VERSION_METADATA_PART,
  readAndValidateMogVersionMetadataFromXlsx,
} from '../version/xlsx-metadata/xlsx-version-metadata';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import {
  COPIED_METADATA_DOCUMENT_ID,
  createSourceXlsx,
  expectedMetadataHead,
  METADATA_EXPORT_DOCUMENT_ID,
  OLD_METADATA_COMMIT_ID,
  REF_REVISION,
  testVersionMetadata,
  versionHead,
} from './version-xlsx-metadata-export-gate-test-helpers';

beforeEach(deleteVersionStoreIndexedDbForTesting);
afterEach(deleteVersionStoreIndexedDbForTesting);

describe('VC-10 XLSX metadata export gating - imported metadata trust', () => {
  it('rejects imported Mog version metadata sidecars that name the wrong document', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });
    const xlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: COPIED_METADATA_DOCUMENT_ID,
        commitId: OLD_METADATA_COMMIT_ID,
      }),
    );

    const metadata = readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
      expectedDocumentId: METADATA_EXPORT_DOCUMENT_ID,
      expectedHead: expectedMetadataHead(currentHead),
      currentHead: expectedMetadataHead(currentHead),
    });

    expect(metadata).toMatchObject({
      status: 'untrusted',
      reason: 'wrong-document',
      trust: {
        status: 'untrusted',
        sidecarPart: MOG_VERSION_METADATA_PART,
        reason: 'wrong-document',
        redacted: true,
      },
      diagnostics: [
        expect.objectContaining({
          code: 'mogVersionMetadataUntrusted',
          reason: 'wrong-document',
          details: expect.objectContaining({
            reason: 'wrong-document',
            sidecarPart: MOG_VERSION_METADATA_PART,
            trusted: false,
            redacted: true,
          }),
        }),
      ],
    });
    expect(JSON.stringify(metadata)).not.toContain(COPIED_METADATA_DOCUMENT_ID);
  });
});
