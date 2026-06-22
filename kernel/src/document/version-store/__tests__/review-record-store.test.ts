import 'fake-indexeddb/auto';

import type {
  VersionCreateReviewInput,
  VersionAppendReviewDecisionInput,
  VersionUpdateReviewStatusInput,
} from '@mog-sdk/contracts/api';

import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  type VersionDocumentScope,
} from '../provider';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb-backend';
import { deleteVersionStoreIndexedDbForTesting } from '../provider-indexeddb-schema';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const OTHER_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-2',
  principalScope: 'principal-1',
};
const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}` as const;
const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}` as const;
const OTHER_COMMIT_ID = `commit:sha256:${'3'.repeat(64)}` as const;
const AUTHOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('WorkbookVersionReviewRecordStore', () => {
  it('persists in-memory review records with idempotent mutations, CAS, paging, and snapshots', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
      durability: 'snapshot-test-double',
    });
    const store = await provider.openWorkbookVersionReviewRecordStore();
    const createInput = createReviewInput('create-1');

    const created = await store.createReview(createInput);
    expect(created).toMatchObject({
      ok: true,
      value: {
        id: expect.stringMatching(/^review:sha256:[0-9a-f]{64}$/),
        documentId: DOCUMENT_SCOPE.documentId,
        revision: 1,
        status: 'open',
        baseCommitId: BASE_COMMIT_ID,
        headCommitId: HEAD_COMMIT_ID,
      },
    });
    if (!created.ok) throw new Error(`expected create success: ${created.error.code}`);
    const reviewId = created.value.id;

    await expect(store.createReview(createInput)).resolves.toEqual(created);
    await expect(
      store.createReview({ ...createInput, title: 'Different title' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'review_client_request_reused' },
    });
    await expect(store.createReview(createReviewInput('create-duplicate'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'active_review_exists' },
    });

    const decisionInput = appendDecisionInput(reviewId, 1, 'decision-1');
    const decided = await store.appendReviewDecision(decisionInput);
    expect(decided).toMatchObject({
      ok: true,
      value: {
        revision: 2,
        decisions: [
          {
            id: expect.stringMatching(/^review-decision:sha256:[0-9a-f]{64}$/),
            decision: 'comment',
          },
        ],
      },
    });
    await expect(store.appendReviewDecision(decisionInput)).resolves.toEqual(decided);
    await expect(
      store.appendReviewDecision({
        ...decisionInput,
        decision: { ...decisionInput.decision, body: 'different' },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'review_client_request_reused' },
    });
    await expect(
      store.appendReviewDecision(appendDecisionInput(reviewId, 1, 'decision-2')),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'stale_revision', expectedRevision: 1, actualRevision: 2 },
    });
    await expect(
      store.appendReviewDecision({
        reviewId,
        expectedRevision: 2,
        clientRequestId: 'decision-derived-resolved',
        decision: {
          target: {
            kind: 'semanticChange',
            changeSetDigest: { algorithm: 'sha256', digest: '4'.repeat(64) },
            changeId: 'derived-impact-1',
            entityKind: 'formula',
            entityId: 'sheet-1!B1',
            propertyPath: ['value'],
            derived: true,
          },
          decision: 'mark_resolved',
          reviewer: AUTHOR,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'derived_target_not_resolvable' },
    });
    await expect(
      store.appendReviewDecision({
        reviewId,
        expectedRevision: 2,
        clientRequestId: 'decision-conflict-resolved',
        decision: {
          target: {
            kind: 'conflict',
            mergePreviewId: 'merge-preview-1',
            conflictId: 'conflict-1',
            entityKind: 'cell',
            entityId: 'sheet-1!A1',
            propertyPath: ['value'],
          },
          decision: 'mark_resolved',
          reviewer: AUTHOR,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'conflict_target_resolution_unavailable' },
    });

    const statusInput = updateStatusInput(reviewId, 2, 'status-1');
    const statusUpdated = await store.updateReviewStatus(statusInput);
    expect(statusUpdated).toMatchObject({
      ok: true,
      value: { revision: 3, status: 'changes_requested' },
    });
    await expect(store.updateReviewStatus(statusInput)).resolves.toEqual(statusUpdated);
    await expect(
      store.updateReviewStatus({ ...updateStatusInput(reviewId, 3, 'status-2'), status: 'approved' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'approval_requires_review_diff' },
    });
    for (const status of ['applied', 'superseded', 'stale'] as const) {
      await expect(
        store.updateReviewStatus({
          ...updateStatusInput(reviewId, 3, `status-flow-owned-${status}`),
          status,
        }),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid_state', state: 'flow_owned_review_status' },
      });
    }

    await expect(store.getReview({ reviewId })).resolves.toMatchObject({
      ok: true,
      value: { revision: 3, status: 'changes_requested' },
    });
    await expect(store.listReviews({ status: 'changes_requested', commitId: HEAD_COMMIT_ID })).resolves.toMatchObject({
      ok: true,
      value: { items: [{ id: reviewId }], limit: 50, totalEstimate: 1 },
    });

    const second = await store.createReview(createReviewInput('create-2', {
      kind: 'commit',
      commitId: OTHER_COMMIT_ID,
    }));
    expect(second.ok).toBe(true);
    const firstPage = await store.listReviews({ limit: 1 });
    expect(firstPage).toMatchObject({ ok: true, value: { items: [expect.any(Object)], limit: 1 } });
    if (!firstPage.ok || !firstPage.value.nextCursor) {
      throw new Error('expected review list cursor');
    }
    await expect(store.listReviews({ limit: 1, cursor: firstPage.value.nextCursor })).resolves.toMatchObject({
      ok: true,
      value: { items: [expect.any(Object)], limit: 1 },
    });

    const snapshot = await backend.exportSnapshot();
    const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot(snapshot);
    const reloadedProvider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: reloadedBackend,
      durability: 'snapshot-test-double',
    });
    await expect(
      (await reloadedProvider.openWorkbookVersionReviewRecordStore()).getReview({ reviewId }),
    ).resolves.toMatchObject({
      ok: true,
      value: { revision: 3, status: 'changes_requested' },
    });

    const isolatedProvider = createInMemoryVersionStoreProvider({
      documentScope: OTHER_DOCUMENT_SCOPE,
      backend: reloadedBackend,
    });
    await expect(
      (await isolatedProvider.openWorkbookVersionReviewRecordStore()).listReviews({}),
    ).resolves.toMatchObject({
      ok: true,
      value: { items: [], totalEstimate: 0 },
    });
  });

  it('persists IndexedDB review records across provider reloads', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const store = await provider.openWorkbookVersionReviewRecordStore();
    const created = await store.createReview(createReviewInput('indexed-create-1'));
    if (!created.ok) throw new Error(`expected create success: ${created.error.code}`);
    const reviewId = created.value.id;

    await expect(
      store.appendReviewDecision(appendDecisionInput(reviewId, 1, 'indexed-decision-1')),
    ).resolves.toMatchObject({ ok: true, value: { revision: 2 } });

    const reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloadedStore = await reloadedProvider.openWorkbookVersionReviewRecordStore();
    await expect(reloadedStore.getReview({ reviewId })).resolves.toMatchObject({
      ok: true,
      value: { id: reviewId, revision: 2, decisions: [{ decision: 'comment' }] },
    });
    await expect(reloadedStore.createReview(createReviewInput('indexed-create-1'))).resolves.toMatchObject({
      ok: true,
      value: { id: reviewId, revision: 1 },
    });
    await expect(
      reloadedStore.appendReviewDecision(appendDecisionInput(reviewId, 1, 'indexed-decision-1')),
    ).resolves.toMatchObject({
      ok: true,
      value: { revision: 2 },
    });
  });
});

function createReviewInput(
  clientRequestId: string,
  subject: VersionCreateReviewInput['subject'] = {
    kind: 'commitRange',
    baseCommitId: BASE_COMMIT_ID,
    headCommitId: HEAD_COMMIT_ID,
  },
): VersionCreateReviewInput {
  return {
    clientRequestId,
    subject,
    title: `Review ${clientRequestId}`,
    createdBy: AUTHOR,
    redactionPolicy: REDACTION_POLICY,
  };
}

function appendDecisionInput(
  reviewId: string,
  expectedRevision: number,
  clientRequestId: string,
): VersionAppendReviewDecisionInput {
  return {
    reviewId,
    expectedRevision,
    clientRequestId,
    decision: {
      target: { kind: 'proposal', proposalId: 'proposal-1' },
      decision: 'comment',
      reviewer: AUTHOR,
      body: 'Looks good.',
    },
  };
}

function updateStatusInput(
  reviewId: string,
  expectedRevision: number,
  clientRequestId: string,
): VersionUpdateReviewStatusInput {
  return {
    reviewId,
    expectedRevision,
    clientRequestId,
    status: 'changes_requested',
    actor: AUTHOR,
    reason: 'Needs a follow-up.',
  };
}
