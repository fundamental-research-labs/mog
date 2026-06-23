import { jest } from '@jest/globals';

import { REVIEW_ID, createReviewDiffPage, createVersion } from './version-review-test-utils';

export function registerVersionReviewDiffScenarios(): void {
  it('fails closed when a review diff omits authored upstream changes', async () => {
    const version = createVersion({
      getReviewDiff: jest.fn(async () => ({
        ok: true,
        value: {
          ...createReviewDiffPage(),
          changes: [],
          upstreamDiff: {
            items: [
              {
                structural: {
                  kind: 'metadata',
                  changeId: 'change-hidden-vba',
                  domain: 'macros.vba',
                  entityId: 'module-1',
                  propertyPath: ['source'],
                },
                before: { kind: 'value', value: null },
                after: { kind: 'value', value: 'private macro source' },
              },
            ],
            limit: 50,
            readRevision: { kind: 'counter', value: '1' },
            order: 'semantic-change-order',
          },
        },
      })),
    });

    await expect(version.getReviewDiff({ reviewId: REVIEW_ID })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getReviewDiff',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REVIEW_DIFF_INCOMPLETE',
            data: expect.objectContaining({
              recoverability: 'unsupported',
              redacted: true,
              payload: expect.objectContaining({
                operation: 'getReviewDiff',
              }),
            }),
          }),
        ],
      },
    });
    const result = await version.getReviewDiff({ reviewId: REVIEW_ID });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('macros.vba');
    expect(serialized).not.toContain('private macro source');
    expect(serialized).not.toContain('omittedChangeCount');
  });
}
