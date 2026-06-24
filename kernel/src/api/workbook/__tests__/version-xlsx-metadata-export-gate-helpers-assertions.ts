import { MOG_VERSION_METADATA_PART } from '../version/xlsx-metadata/xlsx-version-metadata';

export async function expectMogMetadataExportBlocked(
  exportAttempt: Promise<Uint8Array>,
  metadataIssue: string,
): Promise<void> {
  await expect(exportAttempt).rejects.toMatchObject({
    name: 'MogSdkError',
    code: 'EXPORT_ERROR',
    operation: 'workbook.toXlsx',
    diagnostics: {
      domain: 'VERSION',
      issueCode: 'VERSION_XLSX_METADATA_EXPORT_BLOCKED',
      severity: 'error',
    },
    details: {
      issue: 'metadata-export-blocked',
      operation: 'workbook.toXlsx',
      metadataIssue,
      sidecarPart: MOG_VERSION_METADATA_PART,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_XLSX_METADATA_EXPORT_BLOCKED',
          mutationGuarantee: 'no-write-attempted',
          redacted: true,
          payload: expect.objectContaining({
            operation: 'export',
            phase: 'export-sidecar',
            reason: metadataIssue,
            sidecarPart: MOG_VERSION_METADATA_PART,
            redacted: true,
          }),
        }),
      ]),
    },
  });
}
