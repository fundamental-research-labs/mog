import {
  PRINCIPAL_SECRET,
  SECRET_REF,
  SECRET_TABLE_ID,
  SECRET_TABLE_NAME,
  createReviewInput,
  expectNoDiagnosticLeaks,
  providerWithRootAndChildReviewChanges,
  tableDefinitionValue,
  versionForProvider,
} from './version-review-provider-access-test-utils';

export function registerReviewProviderAccessProviderDiffScenarios(): void {
  it('fails provider-backed review diffs closed when denied projections hide detail values', async () => {
    const graph = await providerWithRootAndChildReviewChanges(
      'denied-review-diff-detail-projection',
      [
        {
          changeId: 'change:w10-09-secret-table',
          domain: 'tables',
          entityId: SECRET_TABLE_ID,
          propertyPath: ['definition'],
          before: tableDefinitionValue('before'),
          after: { kind: 'redacted', reason: 'permission-denied' },
          hiddenRef: SECRET_REF,
          hiddenPrincipal: PRINCIPAL_SECRET,
        },
      ],
    );
    const version = versionForProvider(graph.provider);
    const review = await version.createReview(
      createReviewInput(
        'denied-review-diff-detail-projection',
        graph.rootCommitId,
        graph.childCommitId,
      ),
    );
    if (!review.ok) throw new Error(`expected review create success: ${review.error.code}`);

    const result = await version.getReviewDiff({ reviewId: review.value.id });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getReviewDiff',
      },
    });
    expect(result).not.toHaveProperty('value');
    expectNoDiagnosticLeaks(result, [
      SECRET_TABLE_ID,
      SECRET_TABLE_NAME,
      SECRET_REF,
      PRINCIPAL_SECRET,
      'change:w10-09-secret-table',
      'hiddenRef',
      'hiddenPrincipal',
    ]);
  });
}
