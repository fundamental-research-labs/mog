import { WorkbookVersionImpl } from '../version';
import {
  DOCUMENT_SCOPE,
  PRINCIPAL_SECRET,
  PRINCIPAL_OTHER,
  RAW_CELL_VALUE,
  SECRET_DOMAIN,
  SECRET_PATH,
  expectNoDiagnosticLeaks,
} from './version-review-provider-access-test-utils';

export function registerReviewProviderAccessServiceGetReviewScenarios(): void {
  it('redacts principal mismatch and raw value diagnostics from attached review services', async () => {
    const version = new WorkbookVersionImpl({
      documentId: DOCUMENT_SCOPE.documentId,
      versioning: {
        reviewService: {
          getReview: async () => ({
            ok: false,
            error: {
              code: 'target_unavailable',
              target: 'workbook.version.getReview',
              diagnostics: [
                {
                  code: 'VERSION_PERMISSION_DENIED',
                  severity: 'error',
                  message: `Review principal mismatch: expected ${PRINCIPAL_SECRET}, got ${PRINCIPAL_OTHER}.`,
                  data: {
                    payload: {
                      deniedCapabilities: ['version:reviewRead'],
                      principalScope: PRINCIPAL_SECRET,
                      expectedPrincipalScope: PRINCIPAL_SECRET,
                      actualPrincipalScope: PRINCIPAL_OTHER,
                      domain: SECRET_DOMAIN,
                      path: SECRET_PATH,
                      value: RAW_CELL_VALUE,
                      before: RAW_CELL_VALUE,
                      after: RAW_CELL_VALUE,
                      publicReason: 'accessDenied',
                    },
                  },
                },
              ],
            },
          }),
        },
      },
    } as any);

    const result = await version.getReview({ reviewId: `review:sha256:${'a'.repeat(64)}` });

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PERMISSION_DENIED',
            message:
              'Review principal mismatch: expected redacted-principal, got redacted-principal.',
            data: {
              payload: expect.objectContaining({
                deniedCapabilities: ['version:reviewRead'],
                publicReason: 'accessDenied',
              }),
            },
          }),
        ],
      },
    });
    expectNoDiagnosticLeaks(result, [
      PRINCIPAL_SECRET,
      PRINCIPAL_OTHER,
      'principalScope',
      'expectedPrincipalScope',
      'actualPrincipalScope',
      SECRET_DOMAIN,
      SECRET_PATH,
      RAW_CELL_VALUE,
      '"value"',
      '"before"',
      '"after"',
    ]);
  });
}
