import { attachWorkbookVersioning } from '../version-wiring';
import { WorkbookVersionImpl } from '../version';
import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  AUTHOR,
  DOCUMENT_SCOPE,
  HEAD_COMMIT_ID,
  REVIEW_ID,
  SENSITIVE_ACTOR,
  createReviewInput,
  expectDeniedReviewDiagnostic,
  inaccessibleReviewResult,
  versionForProvider,
} from './version-review-provider-test-utils';

describe('WorkbookVersion provider-backed review service', () => {
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

  it('projects provider-backed review read and write records through public-safe access', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
    attachWorkbookVersioning(ctx, { provider });
    const version = new WorkbookVersionImpl(ctx);

    const created = await version.createReview({
      ...createReviewInput('projection-review-1'),
      createdBy: SENSITIVE_ACTOR,
    });
    if (!created.ok) throw new Error(`expected create success: ${created.error.code}`);
    expect(JSON.stringify(created.value)).not.toContain('principal-secret');
    expect(JSON.stringify(created.value)).not.toContain('agent-secret');
    expect(created.value.redaction.redactedFields).toContain('reviewAuthors.principalTrace');

    const listed = await version.listReviews({});
    if (!listed.ok) throw new Error(`expected list success: ${listed.error.code}`);
    expect(JSON.stringify(listed.value)).not.toContain('principal-secret');

    const fetched = await version.getReview({ reviewId: created.value.id });
    if (!fetched.ok) throw new Error(`expected get success: ${fetched.error.code}`);
    expect(JSON.stringify(fetched.value)).not.toContain('principal-secret');

    const decision = await version.appendReviewDecision({
      reviewId: created.value.id,
      expectedRevision: 1,
      clientRequestId: 'projection-decision-1',
      decision: {
        target: { kind: 'proposal', proposalId: 'proposal-1' },
        decision: 'comment',
        reviewer: SENSITIVE_ACTOR,
        body: 'Please review with principal-secret.',
        metadata: { principalId: 'principal-secret', publicNote: 'kept' },
      },
    });
    if (!decision.ok) throw new Error(`expected decision success: ${decision.error.code}`);
    expect(JSON.stringify(decision.value)).not.toContain('principal-secret');
    expect(JSON.stringify(decision.value)).not.toContain('agent-secret');
    expect(JSON.stringify(decision.value)).toContain('publicNote');

    const status = await version.updateReviewStatus({
      reviewId: created.value.id,
      expectedRevision: 2,
      clientRequestId: 'projection-status-1',
      status: 'changes_requested',
      actor: SENSITIVE_ACTOR,
      reason: 'Blocked for principal-secret.',
    });
    if (!status.ok) throw new Error(`expected status success: ${status.error.code}`);
    expect(JSON.stringify(status.value)).not.toContain('principal-secret');
    expect(JSON.stringify(status.value)).toContain('redacted-principal');
  });

  it('redacts inaccessible provider review read and write diagnostics', async () => {
    const store = {
      documentScope: DOCUMENT_SCOPE,
      getReview: async () => inaccessibleReviewResult('getReview', 'version:reviewRead'),
      createReview: async () => inaccessibleReviewResult('createReview', 'version:reviewWrite'),
    };
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE }) as any;
    provider.openWorkbookVersionReviewRecordStore = async () => store;
    const version = versionForProvider(provider);

    const read = await version.getReview({ reviewId: REVIEW_ID });
    const write = await version.createReview(createReviewInput('inaccessible-write-review'));
    expectDeniedReviewDiagnostic(read, 'getReview', 'version:reviewRead');
    expectDeniedReviewDiagnostic(write, 'createReview', 'version:reviewWrite');
  });
});
