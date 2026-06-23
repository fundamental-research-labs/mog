import {
  hiddenUnsupportedMacroChange,
  reviewCellA1ValueChange,
  reviewSheetOrderChange,
} from './version-review-provider-fixtures';
import {
  AUTHOR,
  DOCUMENT_SCOPE,
  createReviewInput,
  graphWithRootAndChild,
  versionForProvider,
} from './version-review-provider-test-utils';

describe('WorkbookVersion provider-backed review diffs', () => {
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
    const serialized = JSON.stringify(diff);
    expect(serialized).not.toContain('principal-secret');
    expect(serialized).not.toContain('deniedPrincipal');
    expect(serialized).not.toContain('macros.vba');
    expect(serialized).not.toContain('module-1');
    expect(serialized).not.toContain('private macro source');
    expect(serialized).not.toContain('changes[1]');

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
    expect(approvalJson).not.toContain('principal-secret');
    expect(approvalJson).not.toContain('deniedPrincipal');
    expect(approvalJson).not.toContain('macros.vba');
    expect(approvalJson).not.toContain('module-1');
    expect(approvalJson).not.toContain('private macro source');
    expect(approvalJson).not.toContain('changes[1]');
    expect(approvalJson).not.toContain('upstreamDiff');
  });
});
