import { jest } from '@jest/globals';

import { REVIEW_ID, createVersion } from './version-review-test-utils';

export function registerVersionReviewDiagnosticsScenarios(): void {
  it('maps thrown provider errors into redacted diagnostics', async () => {
    const version = createVersion({
      getReview: jest.fn(async () => {
        throw new Error('internal backend detail');
      }),
    });

    await expect(version.getReview({ reviewId: REVIEW_ID })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getReview',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PROVIDER_ERROR',
            data: expect.objectContaining({
              redacted: true,
              recoverability: 'retry',
            }),
          }),
        ],
      },
    });
  });

  it('redacts denied principals from review read diagnostics', async () => {
    const version = createVersion({
      getReview: jest.fn(async () => ({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.getReview',
          diagnostics: [
            {
              code: 'VERSION_REVIEW_ACCESS_DENIED',
              severity: 'error',
              message: 'Review read denied for principal-secret.',
              data: {
                deniedPrincipalId: 'principal-secret',
                payload: {
                  deniedCapabilities: ['version:reviewRead'],
                  deniedPrincipal: 'principal-secret',
                  principalScope: 'principal-secret',
                },
              },
            },
          ],
        },
      })),
    });

    const result = await version.getReview({ reviewId: REVIEW_ID });

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REVIEW_ACCESS_DENIED',
            message: 'Review read denied for redacted-principal.',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                deniedCapabilities: ['version:reviewRead'],
              }),
            }),
          }),
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('principal-secret');
    expect(serialized).not.toContain('deniedPrincipal');
    expect(serialized).toContain('version:reviewRead');
  });
}
