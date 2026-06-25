import { expect, it } from '@jest/globals';

import {
  reviewCellA1ValueChange,
  reviewSheetOrderChange,
} from './version-review-provider-fixtures';
import {
  DOCUMENT_SCOPE,
  createReviewInput,
  graphWithRootAndChild,
  versionForProvider,
} from './version-review-provider-test-utils';

export function registerReviewProviderDiffPaginationScenarios(): void {
  it('projects provider-backed semantic diffs into review diff pages by review id and commit range', async () => {
    const graph = await graphWithRootAndChild([
      reviewCellA1ValueChange(),
      reviewSheetOrderChange(),
    ]);
    const version = versionForProvider(graph.provider);
    const review = await version.createReview({
      ...createReviewInput('diff-review-1'),
      subject: {
        kind: 'commitRange',
        baseCommitId: graph.rootCommitId,
        headCommitId: graph.childCommitId,
      },
    });
    if (!review.ok) throw new Error(`expected review create success: ${review.error.code}`);

    const firstPage = await version.getReviewDiff({ reviewId: review.value.id, limit: 1 });
    expect(firstPage).toMatchObject({
      ok: true,
      value: {
        schemaVersion: 1,
        source: 'semantic-diff',
        reviewId: review.value.id,
        baseCommitId: graph.rootCommitId,
        headCommitId: graph.childCommitId,
        changeSetDigest: { algorithm: 'sha256', digest: expect.stringMatching(/^[0-9a-f]{64}$/) },
        changes: [
          {
            target: {
              kind: 'semanticChange',
              changeId: 'change-cell-a1',
              entityKind: 'cell',
              entityId: 'sheet-1!A1',
              propertyPath: ['value'],
              derived: false,
            },
            owner: 'cell',
            entity: {
              kind: 'cell',
              workbookId: DOCUMENT_SCOPE.documentId,
              sheetId: 'sheet-1',
              id: 'sheet-1!A1',
              displayRef: 'A1',
            },
            kind: 'create',
            derived: false,
          },
        ],
        summary: {
          authoredChanges: 1,
          derivedChanges: 0,
          redactedChanges: 0,
        },
        nextCursor: expect.stringMatching(/^mog-vdiff-v1\.semantic-change-order\./),
        limit: 1,
      },
    });
    if (!firstPage.ok || !firstPage.value.nextCursor) {
      throw new Error('expected review diff page cursor');
    }
    expect(firstPage.value).not.toHaveProperty('upstreamDiff');

    await expect(
      version.getReviewDiff({
        baseCommitId: graph.rootCommitId,
        headCommitId: graph.childCommitId,
        limit: 1,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { changes: [{ target: { changeId: 'change-cell-a1' } }], limit: 1 },
    });
    await expect(
      version.getReviewDiff({
        baseCommitId: graph.rootCommitId,
        headCommitId: graph.childCommitId,
        limit: 1,
        cursor: firstPage.value.nextCursor,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        changes: [
          {
            target: { changeId: 'change-sheet-order' },
            entity: { displayRef: 'Sheet 2' },
            kind: 'reorder',
          },
        ],
      },
    });
    await expect(
      version.getReviewDiff({
        baseCommitId: graph.childCommitId,
        headCommitId: graph.rootCommitId,
        limit: 1,
        cursor: firstPage.value.nextCursor,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_STALE_PAGE_CURSOR' })],
      },
    });
  });
}
