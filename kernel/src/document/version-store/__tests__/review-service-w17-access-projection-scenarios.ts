import { projectReviewAccessDiffPage } from '../review-access-projection';
import { expectNoLeak, unsupportedDiffPage } from './review-service-w17-test-helpers';

export function registerReviewServiceW17AccessProjectionScenarios(): void {
  it('fails review access projection closed for unsupported semantic targets', () => {
    const result = projectReviewAccessDiffPage(unsupportedDiffPage());

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_REVIEW_DIFF_INCOMPLETE',
          severity: 'error',
        }),
      ],
    });
    expectNoLeak(result);
  });
}
