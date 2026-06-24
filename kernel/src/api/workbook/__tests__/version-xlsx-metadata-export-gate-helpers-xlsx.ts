import { createWorkbook } from '../create-workbook';
import {
  addMogVersionMetadataToXlsx,
  maybeAddMogVersionMetadataToXlsx,
  readAndValidateMogVersionMetadataFromXlsx,
} from '../version/xlsx-metadata/xlsx-version-metadata';

import {
  CLEAN_EXPORT_DOCUMENT_ID,
  OTHER_METADATA_COMMIT_ID,
  SOURCE_DOCUMENT_ID,
  STALE_IMPORTED_DOCUMENT_ID,
  STALE_IMPORTED_REF_REVISION,
  STALE_IMPORTED_WORKSPACE_ID,
} from './version-xlsx-metadata-export-gate-helpers-constants';
import { metadataExportContext } from './version-xlsx-metadata-export-gate-helpers-context';
import { testVersionMetadata } from './version-xlsx-metadata-export-gate-helpers-metadata';
import { blockedMetadataSink } from './version-xlsx-metadata-export-gate-helpers-sinks';

export async function expectCleanExportOmitsImportedMetadata(
  options: Parameters<typeof maybeAddMogVersionMetadataToXlsx>[3],
): Promise<void> {
  const xlsxBytes = addMogVersionMetadataToXlsx(
    await createSourceXlsx(),
    testVersionMetadata({
      documentId: STALE_IMPORTED_DOCUMENT_ID,
      workspaceId: STALE_IMPORTED_WORKSPACE_ID,
      commitId: OTHER_METADATA_COMMIT_ID,
      refRevision: STALE_IMPORTED_REF_REVISION,
    }),
  );
  const staleMetadataArchiveText = decodeUtf8(xlsxBytes);
  expect(staleMetadataArchiveText).toContain(STALE_IMPORTED_DOCUMENT_ID);
  expect(staleMetadataArchiveText).toContain(STALE_IMPORTED_WORKSPACE_ID);
  expect(staleMetadataArchiveText).toContain(OTHER_METADATA_COMMIT_ID);
  expect(staleMetadataArchiveText).toContain(STALE_IMPORTED_REF_REVISION.value);

  const exported = await maybeAddMogVersionMetadataToXlsx(
    metadataExportContext({ documentId: CLEAN_EXPORT_DOCUMENT_ID }),
    {
      getHead: async () => {
        throw new Error('clean metadata export must not read the version head without opt-in');
      },
    } as Parameters<typeof maybeAddMogVersionMetadataToXlsx>[1],
    xlsxBytes,
    options,
    blockedMetadataSink(),
  );
  expect(
    readAndValidateMogVersionMetadataFromXlsx(exported, {
      expectedDocumentId: CLEAN_EXPORT_DOCUMENT_ID,
    }),
  ).toMatchObject({ status: 'absent' });
  const cleanArchiveText = decodeUtf8(exported);
  expect(cleanArchiveText).not.toContain(STALE_IMPORTED_DOCUMENT_ID);
  expect(cleanArchiveText).not.toContain(STALE_IMPORTED_WORKSPACE_ID);
  expect(cleanArchiveText).not.toContain(OTHER_METADATA_COMMIT_ID);
  expect(cleanArchiveText).not.toContain(STALE_IMPORTED_REF_REVISION.value);
}

export async function createSourceXlsx(): Promise<Uint8Array> {
  const wb = await createWorkbook({ documentId: SOURCE_DOCUMENT_ID, userTimezone: 'UTC' });
  try {
    await wb.activeSheet.setCell('A1', 'Metadata export gate');
    await wb.activeSheet.setCell('B1', 42);
    return wb.toXlsx();
  } finally {
    await wb.close('skipSave').catch(() => {
      wb.dispose();
    });
  }
}

export function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}
