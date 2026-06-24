import { maybeAddMogVersionMetadataToXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import {
  blockedMetadataSink,
  createSourceXlsx,
  expectAuthorityExportBlocked,
  metadataExportContext,
  METADATA_EXPORT_DOCUMENT_ID,
  OLD_METADATA_COMMIT_ID,
  REF_REVISION,
  UNSAFE_AUTHORITY_DIAGNOSTICS,
  versionHead,
} from './version-xlsx-metadata-export-gate-test-helpers';

export function registerAuthorityRedactionScenarios(): void {
  it.each([
    ['registry', { registryDiagnostics: UNSAFE_AUTHORITY_DIAGNOSTICS }],
    ['current head', { headDiagnostics: UNSAFE_AUTHORITY_DIAGNOSTICS }],
    ['commit closure', { closureDiagnostics: UNSAFE_AUTHORITY_DIAGNOSTICS }],
  ])(
    'blocks Mog version metadata sidecar export when %s authority has diagnostics',
    async (_case, diagnosticInput) => {
      const currentHead = versionHead({
        id: OLD_METADATA_COMMIT_ID,
        refRevision: REF_REVISION,
      });

      await expectAuthorityExportBlocked(
        {
          provider: {
            documentId: METADATA_EXPORT_DOCUMENT_ID,
            head: currentHead,
            ...diagnosticInput,
          },
        },
        'redaction-failed',
      );
    },
  );

  it('blocks Mog version metadata sidecar export instead of serializing failed-head diagnostics', async () => {
    const leakSentinel = 'vc10-metadata-export-redaction-leak';
    const externalPackageRef =
      'https://example.invalid/vc10-metadata-export-private-package-ref.xlsx?token=secret';
    const sinkWrites = { count: 0 };

    try {
      await maybeAddMogVersionMetadataToXlsx(
        metadataExportContext({ documentId: METADATA_EXPORT_DOCUMENT_ID }),
        {
          getHead: async () => ({
            ok: false,
            error: {
              code: 'target_unavailable',
              target: 'HEAD',
              diagnostics: [
                {
                  code: 'VERSION_TEST_HEAD_FAILURE',
                  severity: 'error',
                  message: leakSentinel,
                  dependency: externalPackageRef,
                },
              ],
            },
          }),
        } as Parameters<typeof maybeAddMogVersionMetadataToXlsx>[1],
        await createSourceXlsx(),
        { versionMetadata: 'include' },
        blockedMetadataSink(sinkWrites),
      );
      throw new Error('expected metadata export to be blocked');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'MogSdkError',
        code: 'EXPORT_ERROR',
        operation: 'workbook.toXlsx',
        details: expect.objectContaining({ metadataIssue: 'redaction-failed' }),
      });
      expect(JSON.stringify(error)).not.toContain(leakSentinel);
      expect(JSON.stringify(error)).not.toContain(externalPackageRef);
      expect(JSON.stringify(error)).not.toContain('VERSION_TEST_HEAD_FAILURE');
      expect(JSON.stringify(error)).not.toContain('target_unavailable');
      expect(error).toMatchObject({
        details: {
          diagnostics: [
            expect.objectContaining({
              issueCode: 'VERSION_XLSX_METADATA_EXPORT_BLOCKED',
              safeMessage:
                'Mog version metadata export is blocked because the sidecar cannot be proven current and redacted.',
              redacted: true,
              payload: expect.objectContaining({
                reason: 'redaction-failed',
                redacted: true,
              }),
            }),
          ],
        },
      });
    }
    expect(sinkWrites.count).toBe(0);
  });
}
