import { expect, it } from '@jest/globals';

import { expectUnsupportedAuthoredDomainDetailsRedacted } from './version-review-provider-diff-assertions';
import {
  hiddenUnsupportedMacroChange,
  reviewCellA1ValueChange,
} from './version-review-provider-fixtures';
import {
  AUTHOR,
  createReviewInput,
  graphWithRootAndChild,
  versionForProvider,
} from './version-review-provider-test-utils';

export function registerReviewProviderDiffCompletenessScenarios(): void {
  it('blocks review diffs when completeness diagnostics would hide unsupported authored domains', async () => {
    const visibleChange = reviewCellA1ValueChange();
    const hiddenUnsupportedChange = hiddenUnsupportedMacroChange();
    const graph = await graphWithRootAndChild([visibleChange, hiddenUnsupportedChange], {
      reviewChanges: [visibleChange],
      completenessDiagnostics: [
        {
          code: 'VERSION_UNSUPPORTED_AUTHORED_DOMAIN',
          severity: 'error',
          message: 'Unsupported authored domain omitted for principal-secret.',
          path: 'changes[1]',
          details: {
            domain: 'macros.vba',
            deniedPrincipalId: 'principal-secret',
            principalScope: 'principal-secret',
            hiddenAuthoredChanges: 1,
          },
        },
      ],
    });
    const version = versionForProvider(graph.provider);
    const review = await version.createReview({
      ...createReviewInput('hidden-unsupported-domain-review'),
      subject: {
        kind: 'commitRange',
        baseCommitId: graph.rootCommitId,
        headCommitId: graph.childCommitId,
      },
    });
    if (!review.ok) throw new Error(`expected review create success: ${review.error.code}`);

    const diff = await version.getReviewDiff({ reviewId: review.value.id });

    expect(diff).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getReviewDiff',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_UNSUPPORTED_AUTHORED_DOMAIN',
            message: 'The requested version diff includes unsupported semantic state.',
            severity: 'error',
          }),
        ],
      },
    });
    expectUnsupportedAuthoredDomainDetailsRedacted(JSON.stringify(diff));

    const approved = await version.updateReviewStatus({
      reviewId: review.value.id,
      expectedRevision: 1,
      clientRequestId: 'hidden-unsupported-domain-approve',
      status: 'approved',
      actor: AUTHOR,
    });
    expect(approved).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.updateReviewStatus',
        diagnostics: [expect.objectContaining({ code: 'VERSION_UNSUPPORTED_AUTHORED_DOMAIN' })],
      },
    });
    const approvalJson = JSON.stringify(approved);
    expectUnsupportedAuthoredDomainDetailsRedacted(approvalJson);
    expect(approvalJson).not.toContain('upstreamDiff');
  });
}
