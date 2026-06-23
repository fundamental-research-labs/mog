export async function expectContractedXlsxExportBlocked(
  exportAttempt: Promise<Uint8Array>,
): Promise<void> {
  await expect(exportAttempt).rejects.toMatchObject({
    name: 'MogSdkError',
    code: 'EXPORT_ERROR',
    operation: 'workbook.toXlsx',
    diagnostics: {
      domain: 'VERSION',
      issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
      severity: 'error',
    },
    details: {
      issue: 'export-domain-support-manifest-blocked',
      operation: 'workbook.toXlsx',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'export',
          }),
        }),
      ]),
    },
  });
}
