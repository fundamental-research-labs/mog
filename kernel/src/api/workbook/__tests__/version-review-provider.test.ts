import type {
  VersionCreateReviewInput,
  WorkbookVersionReviewDecisionTarget,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor as GraphVersionAuthor } from '@mog-sdk/contracts/versioning';

import { attachWorkbookVersioning } from '../version-wiring';
import { WorkbookVersionImpl } from '../version';
import type {
  CommitVersionGraphInput,
  VersionGraphInitializeResult,
} from '../../../document/version-store/graph-store';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import type {
  VersionObjectType,
  WorkbookCommitId,
} from '../../../document/version-store/object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionGraphInitializeInput,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import type { RefVersion } from '../../../document/version-store/ref-store';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}` as const;
const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}` as const;
const AUTHOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
const GRAPH_AUTHOR: GraphVersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'Reviewer',
};
const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;

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

  it('projects provider-backed semantic diffs into review diff pages by review id and commit range', async () => {
    const graph = await graphWithRootAndChild([
      {
        changeId: 'change-cell-a1',
        domain: 'cell',
        entityId: 'sheet-1!A1',
        propertyPath: ['value'],
        before: { kind: 'value', value: null },
        after: { kind: 'value', value: 42 },
        display: { address: { kind: 'value', value: 'A1' } },
      },
      {
        changeId: 'change-sheet-order',
        domain: 'sheet',
        entityId: 'sheet-2',
        propertyPath: ['order'],
        before: { kind: 'value', value: 1 },
        after: { kind: 'value', value: 2 },
        display: { entityLabel: { kind: 'value', value: 'Sheet 2' } },
      },
    ]);
    const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
    attachWorkbookVersioning(ctx, { provider: graph.provider });
    const version = new WorkbookVersionImpl(ctx);
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
        nextCursor: expect.stringContaining(graph.childCommitId),
        limit: 1,
        upstreamDiff: {
          items: [{ structural: { changeId: 'change-cell-a1' } }],
          nextCursor: expect.stringContaining(graph.childCommitId),
          limit: 1,
          order: 'semantic-change-order',
        },
      },
    });
    if (!firstPage.ok || !firstPage.value.nextCursor) {
      throw new Error('expected review diff page cursor');
    }

    await expect(version.getReviewDiff({
      baseCommitId: graph.rootCommitId,
      headCommitId: graph.childCommitId,
      limit: 1,
    })).resolves.toMatchObject({
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

  it('approves commit-range reviews with diff-backed evidence and idempotent retry', async () => {
    const graph = await graphWithRootAndChild([
      {
        changeId: 'change-cell-a1',
        domain: 'cell',
        entityId: 'sheet-1!A1',
        propertyPath: ['value'],
        before: { kind: 'value', value: null },
        after: { kind: 'value', value: 42 },
        display: { address: { kind: 'value', value: 'A1' } },
      },
    ]);
    const version = versionForProvider(graph.provider);
    const review = await version.createReview({
      ...createReviewInput('approval-review-1'),
      subject: {
        kind: 'commitRange',
        baseCommitId: graph.rootCommitId,
        headCommitId: graph.childCommitId,
      },
    });
    if (!review.ok) throw new Error(`expected review create success: ${review.error.code}`);

    const approved = await version.updateReviewStatus({
      reviewId: review.value.id,
      expectedRevision: 1,
      clientRequestId: 'approve-status-1',
      status: 'approved',
      actor: AUTHOR,
    });
    expect(approved).toMatchObject({
      ok: true,
      value: {
        revision: 2,
        status: 'approved',
        approval: {
          schemaVersion: 1,
          baseCommitId: graph.rootCommitId,
          headCommitId: graph.childCommitId,
          changeSetDigest: { algorithm: 'sha256', digest: expect.stringMatching(/^[0-9a-f]{64}$/) },
          approvedBy: AUTHOR,
          reviewRevision: 2,
          requiredTargets: [
            {
              targetKey: expect.any(String),
              target: {
                kind: 'semanticChange',
                changeId: 'change-cell-a1',
                entityKind: 'cell',
                entityId: 'sheet-1!A1',
                propertyPath: ['value'],
                derived: false,
              },
            },
          ],
        },
      },
    });
    if (!approved.ok) throw new Error(`expected approval success: ${approved.error.code}`);
    expect(approved.value.approval?.approvedAt).toBe(approved.value.updatedAt);
    await expect(
      version.updateReviewStatus({
        reviewId: review.value.id,
        expectedRevision: 1,
        clientRequestId: 'approve-status-1',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toEqual(approved);
  });

  it('requires same-target trusted approve decisions to resolve request changes before approval', async () => {
    const graph = await graphWithRootAndChild([
      {
        changeId: 'change-cell-a1',
        domain: 'cell',
        entityId: 'sheet-1!A1',
        propertyPath: ['value'],
        before: { kind: 'value', value: null },
        after: { kind: 'value', value: 42 },
        display: { address: { kind: 'value', value: 'A1' } },
      },
    ]);
    const version = versionForProvider(graph.provider);
    const review = await version.createReview({
      ...createReviewInput('approval-request-change-1'),
      subject: {
        kind: 'commitRange',
        baseCommitId: graph.rootCommitId,
        headCommitId: graph.childCommitId,
      },
    });
    if (!review.ok) throw new Error(`expected review create success: ${review.error.code}`);
    const target = await firstReviewDiffTarget(version, review.value.id);

    const requested = await version.appendReviewDecision({
      reviewId: review.value.id,
      expectedRevision: 1,
      clientRequestId: 'request-change-1',
      decision: { target, decision: 'request_change', reviewer: AUTHOR },
    });
    if (!requested.ok) throw new Error(`expected request-change success: ${requested.error.code}`);
    const requestDecisionId = requested.value.decisions[0].id;

    await expect(
      version.updateReviewStatus({
        reviewId: review.value.id,
        expectedRevision: 2,
        clientRequestId: 'approve-with-unresolved-request',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'unresolved_request_change' },
    });

    const unresolvedApprove = await version.appendReviewDecision({
      reviewId: review.value.id,
      expectedRevision: 2,
      clientRequestId: 'approve-decision-missing-supersede',
      decision: { target, decision: 'approve', reviewer: AUTHOR },
    });
    expect(unresolvedApprove).toMatchObject({ ok: true, value: { revision: 3 } });
    await expect(
      version.updateReviewStatus({
        reviewId: review.value.id,
        expectedRevision: 3,
        clientRequestId: 'approve-with-missing-supersede',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'unresolved_request_change' },
    });

    const resolved = await version.appendReviewDecision({
      reviewId: review.value.id,
      expectedRevision: 3,
      clientRequestId: 'approve-decision-with-supersede',
      decision: {
        target,
        decision: 'approve',
        reviewer: AUTHOR,
        supersedesDecisionId: requestDecisionId,
      },
    });
    expect(resolved).toMatchObject({ ok: true, value: { revision: 4 } });
    await expect(
      version.updateReviewStatus({
        reviewId: review.value.id,
        expectedRevision: 4,
        clientRequestId: 'approve-after-request-resolved',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({ ok: true, value: { revision: 5, status: 'approved' } });
  });

  it('requires mark_resolved decisions to supersede a same-target request change', async () => {
    const graph = await graphWithRootAndChild([
      {
        changeId: 'change-cell-a1',
        domain: 'cell',
        entityId: 'sheet-1!A1',
        propertyPath: ['value'],
        before: { kind: 'value', value: null },
        after: { kind: 'value', value: 42 },
        display: { address: { kind: 'value', value: 'A1' } },
      },
      {
        changeId: 'change-sheet-order',
        domain: 'sheet',
        entityId: 'sheet-2',
        propertyPath: ['order'],
        before: { kind: 'value', value: 1 },
        after: { kind: 'value', value: 2 },
        display: { entityLabel: { kind: 'value', value: 'Sheet 2' } },
      },
    ]);
    const version = versionForProvider(graph.provider);
    const review = await version.createReview({
      ...createReviewInput('approval-mark-resolved-1'),
      subject: {
        kind: 'commitRange',
        baseCommitId: graph.rootCommitId,
        headCommitId: graph.childCommitId,
      },
    });
    if (!review.ok) throw new Error(`expected review create success: ${review.error.code}`);
    const diff = await version.getReviewDiff({ reviewId: review.value.id, limit: 2 });
    if (!diff.ok) throw new Error(`expected review diff success: ${diff.error.code}`);
    const target = diff.value.changes[0].target;
    const otherTarget = diff.value.changes[1].target;

    const requested = await version.appendReviewDecision({
      reviewId: review.value.id,
      expectedRevision: 1,
      clientRequestId: 'request-change-for-mark-resolved',
      decision: { target, decision: 'request_change', reviewer: AUTHOR },
    });
    if (!requested.ok) throw new Error(`expected request-change success: ${requested.error.code}`);
    const requestDecisionId = requested.value.decisions[0].id;

    const wrongTargetResolution = await version.appendReviewDecision({
      reviewId: review.value.id,
      expectedRevision: 2,
      clientRequestId: 'mark-resolved-wrong-target',
      decision: {
        target: otherTarget,
        decision: 'mark_resolved',
        reviewer: AUTHOR,
        supersedesDecisionId: requestDecisionId,
      },
    });
    expect(wrongTargetResolution).toMatchObject({ ok: true, value: { revision: 3 } });
    await expect(
      version.updateReviewStatus({
        reviewId: review.value.id,
        expectedRevision: 3,
        clientRequestId: 'approve-after-wrong-target-resolution',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'unresolved_request_change' },
    });

    const missingSupersede = await version.appendReviewDecision({
      reviewId: review.value.id,
      expectedRevision: 3,
      clientRequestId: 'mark-resolved-missing-supersede',
      decision: { target, decision: 'mark_resolved', reviewer: AUTHOR },
    });
    expect(missingSupersede).toMatchObject({ ok: true, value: { revision: 4 } });
    await expect(
      version.updateReviewStatus({
        reviewId: review.value.id,
        expectedRevision: 4,
        clientRequestId: 'approve-after-missing-supersede',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'unresolved_request_change' },
    });

    const resolved = await version.appendReviewDecision({
      reviewId: review.value.id,
      expectedRevision: 4,
      clientRequestId: 'mark-resolved-with-supersede',
      decision: {
        target,
        decision: 'mark_resolved',
        reviewer: AUTHOR,
        supersedesDecisionId: requestDecisionId,
      },
    });
    expect(resolved).toMatchObject({ ok: true, value: { revision: 5 } });
    await expect(
      version.updateReviewStatus({
        reviewId: review.value.id,
        expectedRevision: 5,
        clientRequestId: 'approve-after-mark-resolved',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({ ok: true, value: { revision: 6, status: 'approved' } });
  });
});

function createReviewInput(clientRequestId: string): VersionCreateReviewInput {
  return {
    clientRequestId,
    subject: {
      kind: 'commitRange',
      baseCommitId: BASE_COMMIT_ID,
      headCommitId: HEAD_COMMIT_ID,
    },
    createdBy: AUTHOR,
    redactionPolicy: REDACTION_POLICY,
  };
}

function versionForProvider(provider: ReturnType<typeof createInMemoryVersionStoreProvider>): WorkbookVersionImpl {
  const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
  attachWorkbookVersioning(ctx, { provider });
  return new WorkbookVersionImpl(ctx);
}

async function firstReviewDiffTarget(
  version: WorkbookVersionImpl,
  reviewId: string,
): Promise<WorkbookVersionReviewDecisionTarget> {
  const diff = await version.getReviewDiff({ reviewId });
  if (!diff.ok) throw new Error(`expected review diff success: ${diff.error.code}`);
  return diff.value.changes[0].target;
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.issueCode}`);
  }
}

async function graphWithRootAndChild(changes: readonly unknown[]) {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
  const opened = await provider.openGraph(namespace);
  const head = await opened.readHead();
  if (head.status !== 'success') throw new Error('expected graph head before append');
  const committed = await opened.commit(
    await commitInput(namespace, head.head.id, head.head.refRevision as RefVersion, changes),
  );
  if (committed.status !== 'success') {
    throw new Error(`expected commit success: ${committed.diagnostics[0]?.code}`);
  }
  return {
    provider,
    rootCommitId: initialized.rootCommit.id,
    childCommitId: committed.commit.id,
  };
}

async function initializeInput(graphId: string): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label: 'root',
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        changes: [],
      }),
      author: GRAPH_AUTHOR,
      createdAt: '2026-06-22T00:00:00.000Z',
      completenessDiagnostics: [],
    },
  };
}

async function commitInput(
  namespace: VersionGraphNamespace,
  expectedHeadCommitId: WorkbookCommitId,
  expectedMainRefVersion: RefVersion,
  changes: readonly unknown[],
): Promise<CommitVersionGraphInput> {
  return {
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label: 'child',
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes,
    }),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: 'child-segment-1',
      }),
    ],
    author: GRAPH_AUTHOR,
    createdAt: '2026-06-22T00:00:01.000Z',
    completenessDiagnostics: [],
    expectedHeadCommitId,
    expectedMainRefVersion,
  };
}

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}
