import 'fake-indexeddb/auto';

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
import { createIndexedDbVersionStoreProvider } from '../../../document/version-store/provider-indexeddb-backend';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import type { RefVersion } from '../../../document/version-store/ref-store';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}` as const;
const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}` as const;
const REVIEW_ID = `review:sha256:${'a'.repeat(64)}` as const;
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
const SENSITIVE_ACTOR = {
  kind: 'agent',
  trust: 'trusted',
  displayName: 'Reviewer',
  principalId: 'principal-secret',
  agentRunId: 'agent-secret',
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

  it('keeps review access projection fields after IndexedDB provider reopen', async () => {
    await deleteVersionStoreIndexedDbForTesting();
    let provider: ReturnType<typeof createIndexedDbVersionStoreProvider> | undefined;
    let reloadedProvider: ReturnType<typeof createIndexedDbVersionStoreProvider> | undefined;

    try {
      provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const version = versionForProvider(provider);
      const created = await version.createReview({
        ...createReviewInput('indexed-projection-review-1'),
        createdBy: SENSITIVE_ACTOR,
      });
      if (!created.ok) throw new Error(`expected create success: ${created.error.code}`);

      const decision = await version.appendReviewDecision({
        reviewId: created.value.id,
        expectedRevision: 1,
        clientRequestId: 'indexed-projection-decision-1',
        decision: {
          target: { kind: 'proposal', proposalId: 'proposal-1' },
          decision: 'comment',
          reviewer: SENSITIVE_ACTOR,
          body: 'Please review with principal-secret.',
          metadata: { principalId: 'principal-secret', publicNote: 'kept-after-reopen' },
        },
      });
      if (!decision.ok) throw new Error(`expected decision success: ${decision.error.code}`);

      const status = await version.updateReviewStatus({
        reviewId: created.value.id,
        expectedRevision: 2,
        clientRequestId: 'indexed-projection-status-1',
        status: 'changes_requested',
        actor: SENSITIVE_ACTOR,
        reason: 'Blocked for principal-secret.',
      });
      if (!status.ok) throw new Error(`expected status success: ${status.error.code}`);

      await provider.close();
      reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const reloadedVersion = versionForProvider(reloadedProvider);
      const fetched = await reloadedVersion.getReview({ reviewId: created.value.id });
      if (!fetched.ok) throw new Error(`expected get success: ${fetched.error.code}`);

      expect(fetched.value).toMatchObject({
        id: created.value.id,
        revision: 3,
        status: 'changes_requested',
        redaction: { redactedFields: expect.arrayContaining(['reviewAuthors.principalTrace']) },
        decisions: [
          expect.objectContaining({
            body: 'Please review with redacted-principal.',
            metadata: { publicNote: 'kept-after-reopen' },
          }),
        ],
        diagnostics: [
          expect.objectContaining({
            message: 'Blocked for redacted-principal.',
          }),
        ],
      });
      const serialized = JSON.stringify(fetched.value);
      expect(serialized).not.toContain('principal-secret');
      expect(serialized).not.toContain('agent-secret');
      expect(serialized).toContain('redacted-principal');
    } finally {
      await provider?.close();
      await reloadedProvider?.close();
      await deleteVersionStoreIndexedDbForTesting();
    }
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
    const visibleChange = {
      changeId: 'change-cell-a1',
      domain: 'cell',
      entityId: 'sheet-1!A1',
      propertyPath: ['value'],
      before: { kind: 'value', value: null },
      after: { kind: 'value', value: 42 },
      display: { address: { kind: 'value', value: 'A1' } },
    };
    const hiddenUnsupportedChange = {
      changeId: 'change-vba-module',
      domain: 'macros.vba',
      entityId: 'module-1',
      propertyPath: ['source'],
      before: { kind: 'value', value: null },
      after: { kind: 'value', value: 'private macro source' },
    };
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

function versionForProvider(provider: unknown): WorkbookVersionImpl {
  const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
  attachWorkbookVersioning(ctx, { provider: provider as any });
  return new WorkbookVersionImpl(ctx);
}

function inaccessibleReviewResult(operation: string, capability: string) {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [
        {
          code: 'VERSION_PERMISSION_DENIED',
          severity: 'error',
          message: `${operation} denied for principal-secret.`,
          data: {
            payload: {
              deniedCapabilities: [capability],
              deniedPrincipal: 'principal-secret',
              principalScope: 'principal-secret',
            },
          },
        },
      ],
    },
  } as const;
}

function expectDeniedReviewDiagnostic(
  result: unknown,
  operation: string,
  capability: string,
): void {
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_PERMISSION_DENIED',
          message: `${operation} denied for redacted-principal.`,
          data: {
            payload: expect.objectContaining({
              deniedCapabilities: [capability],
            }),
          },
        }),
      ],
    },
  });
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain('principal-secret');
  expect(serialized).not.toContain('deniedPrincipal');
  expect(serialized).not.toContain('principalScope');
  expect(serialized).toContain('redacted-principal');
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

type GraphWithRootAndChildOptions = {
  readonly reviewChanges?: readonly unknown[];
  readonly completenessDiagnostics?: NonNullable<
    CommitVersionGraphInput['completenessDiagnostics']
  >;
};

async function graphWithRootAndChild(
  changes: readonly unknown[],
  options: GraphWithRootAndChildOptions = {},
) {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
  const opened = await provider.openGraph(namespace);
  const head = await opened.readHead();
  if (head.status !== 'success') throw new Error('expected graph head before append');
  const committed = await opened.commit(
    await commitInput(
      namespace,
      head.head.id,
      head.head.refRevision as RefVersion,
      changes,
      options,
    ),
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
  options: GraphWithRootAndChildOptions = {},
): Promise<CommitVersionGraphInput> {
  return {
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label: 'child',
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes,
      ...(options.reviewChanges === undefined ? {} : { reviewChanges: options.reviewChanges }),
    }),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: 'child-segment-1',
      }),
    ],
    author: GRAPH_AUTHOR,
    createdAt: '2026-06-22T00:00:01.000Z',
    completenessDiagnostics: options.completenessDiagnostics ?? [],
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
