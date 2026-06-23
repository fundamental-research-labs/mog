import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import {
  AUTHOR,
  DOCUMENT_SCOPE,
  HEAD_COMMIT_ID,
  createReviewInput,
} from './version-review-provider-test-utils';

export function registerReviewProviderCoreWiringScenarios(): void {
  it('auto-attaches provider-backed review metadata through workbook version wiring', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
    attachWorkbookVersioning(ctx, { provider });
    const version = new WorkbookVersionImpl(ctx);

    const created = await version.createReview(createReviewInput('create-1'));
    expect(created).toMatchObject({
      ok: true,
      value: {
        id: expect.stringMatching(/^review:sha256:[0-9a-f]{64}$/),
        revision: 1,
        status: 'open',
      },
    });
    if (!created.ok) throw new Error(`expected create success: ${created.error.code}`);
    const reviewId = created.value.id;

    await expect(version.getReview({ reviewId })).resolves.toMatchObject({
      ok: true,
      value: { id: reviewId, revision: 1 },
    });
    await expect(version.listReviews({ commitId: HEAD_COMMIT_ID })).resolves.toMatchObject({
      ok: true,
      value: { items: [{ id: reviewId }], totalEstimate: 1 },
    });
    await expect(
      version.updateReviewStatus({
        reviewId,
        expectedRevision: 1,
        clientRequestId: 'status-stale-flow-owned',
        status: 'stale',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.updateReviewStatus',
        diagnostics: [expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' })],
      },
    });
    await expect(
      version.appendReviewDecision({
        reviewId,
        expectedRevision: 1,
        clientRequestId: 'decision-1',
        decision: {
          target: { kind: 'proposal', proposalId: 'proposal-1' },
          decision: 'comment',
          reviewer: AUTHOR,
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { revision: 2, decisions: [{ decision: 'comment' }] },
    });
    await expect(
      version.updateReviewStatus({
        reviewId,
        expectedRevision: 2,
        clientRequestId: 'status-1',
        status: 'changes_requested',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { revision: 3, status: 'changes_requested' },
    });
    await expect(
      version.updateReviewStatus({
        reviewId,
        expectedRevision: 2,
        clientRequestId: 'status-stale-revision',
        status: 'rejected',
        actor: AUTHOR,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'stale_revision', expectedRevision: 2, actualRevision: 3 },
    });
    await expect(
      version.updateReviewStatus({
        reviewId,
        expectedRevision: 3,
        clientRequestId: 'status-approve-unavailable',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.updateReviewStatus',
        diagnostics: [expect.objectContaining({ code: 'VERSION_GRAPH_UNINITIALIZED' })],
      },
    });
    await expect(version.getReviewDiff({ reviewId })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getReviewDiff',
        diagnostics: [expect.objectContaining({ code: 'VERSION_GRAPH_UNINITIALIZED' })],
      },
    });

    const surface = await version.getSurfaceStatus();
    expect(surface.capabilities['version:reviewRead']).toEqual({ enabled: true });
    expect(surface.capabilities['version:reviewWrite']).toEqual({ enabled: true });
  });
}
