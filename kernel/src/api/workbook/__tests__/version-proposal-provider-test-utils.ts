import { expect } from '@jest/globals';
import type {
  VersionCreateReviewInput,
  VersionGetReviewInput,
  VersionUpdateReviewStatusInput,
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor as GraphVersionAuthor } from '@mog-sdk/contracts/versioning';

import type {
  CommitVersionGraphInput,
  VersionGraphInitializeResult,
} from '../../../document/version-store/graph-store';
import type {
  VersionObjectType,
  WorkbookCommitId,
} from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import type { ProposalWorkspaceLifecycleService } from '../../../document/version-store/proposal-workspace-lifecycle-service';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
} from '../../../document/version-store/provider';
import type { RefVersion } from '../../../document/version-store/ref-store';
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
export const ACTOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
const AGENT = {
  kind: 'agent',
  trust: 'trusted',
  displayName: 'Agent One',
  agentRunId: 'agent-run-1',
} as const;
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
export const PASSED_VERIFICATION = {
  status: 'passed',
  checks: [],
  createdAt: '2026-06-22T00:00:02.000Z',
} as const;

export function versionForProvider(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
  versioning: Partial<Parameters<typeof attachWorkbookVersioning>[1]> = {},
): WorkbookVersionImpl {
  const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
  const mergeCap = async () => undefined as never;
  attachWorkbookVersioning(ctx, { provider, captureMergeCommit: mergeCap, ...versioning });
  return new WorkbookVersionImpl(ctx);
}

export function createProposalInput(clientRequestId: string) {
  return {
    clientRequestId,
    title: 'Proposal One',
    targetRef: 'refs/heads/main' as const,
    agentRunId: 'agent-run-1',
    agent: AGENT,
    redactionPolicy: REDACTION_POLICY,
  };
}

export async function createReadyReviewedProposal(
  version: WorkbookVersionImpl,
  graph: Awaited<ReturnType<typeof graphWithRoot>>,
  suffix: string,
  options: { readonly approveReview?: boolean } = {},
) {
  const created = await version.createProposal(createProposalInput(`proposal-create-${suffix}`));
  if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);
  const opened = await version.startProposalWorkspace({
    clientRequestId: `workspace-open-${suffix}`,
    proposalId: created.value.id,
    expectedRevision: 1,
    actor: ACTOR,
  });
  if (!opened.ok) throw new Error(`expected workspace open success: ${opened.error.code}`);
  const committed = await version.commitProposalWorkspace({
    clientRequestId: `workspace-commit-${suffix}`,
    proposalId: created.value.id,
    workspaceId: opened.value.workspaceId,
    expectedRevision: 2,
    actor: ACTOR,
    message: 'Agent proposal commit',
  });
  if (!committed.ok) throw new Error(`expected proposal commit success: ${committed.error.code}`);
  const verified = await version.markProposalVerified({
    clientRequestId: `proposal-verify-${suffix}`,
    proposalId: created.value.id,
    expectedRevision: 3,
    actor: ACTOR,
    verification: PASSED_VERIFICATION,
  });
  if (!verified.ok) throw new Error(`expected proposal verify success: ${verified.error.code}`);
  const review = await version.openProposalReview({
    clientRequestId: `proposal-review-${suffix}`,
    proposalId: created.value.id,
    expectedRevision: 4,
    actor: ACTOR,
  });
  if (!review.ok) throw new Error(`expected proposal review success: ${review.error.code}`);
  if (options.approveReview !== false) {
    const approved = await approveReview(
      version,
      review.value.id,
      review.value.revision,
      `proposal-review-approve-${suffix}`,
    );
    if (!approved.ok) throw new Error(`expected review approval success: ${approved.error.code}`);
  }

  expect(committed.value.baseCommitId).toBe(graph.rootCommitId);
  return {
    proposalId: created.value.id,
    proposalCommitId: committed.value.proposalCommitId,
    reviewId: review.value.id,
  };
}

export function approveReview(
  version: WorkbookVersionImpl,
  reviewId: VersionUpdateReviewStatusInput['reviewId'],
  expectedRevision: number,
  clientRequestId: string,
) {
  return version.updateReviewStatus({
    reviewId,
    expectedRevision,
    clientRequestId,
    status: 'approved',
    actor: ACTOR,
  });
}

export function approvedReviewServiceWithoutFinalizer() {
  const reviews = new Map<string, WorkbookVersionReviewRecord>();
  return {
    async createReview(input: VersionCreateReviewInput) {
      const review: WorkbookVersionReviewRecord = {
        schemaVersion: 1,
        id: `review:${input.clientRequestId}`,
        documentId: DOCUMENT_SCOPE.documentId,
        subject: input.subject,
        status: 'approved',
        baseCommitId: input.baseCommitId,
        headCommitId: input.headCommitId,
        revision: 1,
        createdBy: input.createdBy,
        createdAt: '2026-06-22T00:00:00.000Z',
        updatedAt: '2026-06-22T00:00:00.000Z',
        decisions: [],
        redaction: {
          policy: input.redactionPolicy,
          redactedFields: [],
          diagnostics: [],
        },
        diagnostics: [],
      };
      reviews.set(review.id, review);
      return { ok: true, value: review } as const;
    },
    async getReview(input: VersionGetReviewInput) {
      const review = reviews.get(input.reviewId);
      return review
        ? ({ ok: true, value: review } as const)
        : ({
            ok: false,
            error: {
              code: 'not_found',
              id: input.reviewId,
            },
          } as const);
    },
  };
}

export async function commitMain(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
  expectedHeadCommitId: WorkbookCommitId,
): Promise<WorkbookCommitId> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
  const graph = await provider.openGraph(namespace);
  const main = await graph.readRef('refs/heads/main');
  if (main.status !== 'success' || main.ref.name === 'HEAD') {
    throw new Error('expected main ref before stale proposal test');
  }
  const committed = await graph.commit(
    await commitInput(namespace, expectedHeadCommitId, main.ref.revision, 'refs/heads/main'),
  );
  if (committed.status !== 'success') {
    throw new Error(`expected main move success: ${committed.diagnostics[0]?.code}`);
  }
  return committed.commit.id;
}

export function graphCommittingWorkspaceService(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
): ProposalWorkspaceLifecycleService {
  return {
    async startProposalWorkspace(input) {
      return {
        ok: true,
        value: {
          workspaceId: `workspace:${input.proposal.id}`,
          proposalId: input.proposal.id,
          proposalBranchName: input.proposal.proposalBranchName,
          baseCommitId: input.proposal.baseCommitId,
          providerIdentity: 'in-memory-test-provider',
          workbookSessionId: `session:${input.proposal.id}`,
        },
      };
    },
    async getProposalWorkspace(input) {
      return {
        ok: true,
        value: {
          workspaceId: input.workspaceId,
          proposalId: 'proposal:sha256:lookup' as never,
          proposalBranchName: 'agent/lookup' as never,
          baseCommitId: `commit:sha256:${'0'.repeat(64)}` as never,
          providerIdentity: 'in-memory-test-provider',
          workbookSessionId: `session:${input.workspaceId}`,
        },
      };
    },
    async disposeProposalWorkspace() {
      return { ok: true, value: { disposed: true } };
    },
    async commitProposalWorkspace(input) {
      try {
        const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
        const graph = await provider.openGraph(namespace);
        const proposalRefName = `refs/heads/${input.proposal.proposalBranchName}`;
        const branch = await graph.readRef(proposalRefName);
        if (branch.status !== 'success' || branch.ref.name === 'HEAD') {
          throw new Error('expected proposal branch ref before workspace commit');
        }
        const committed = await graph.commit(
          await commitInput(namespace, branch.ref.commitId, branch.ref.revision, proposalRefName),
        );
        if (committed.status !== 'success') {
          throw new Error(
            `expected proposal graph commit success: ${committed.diagnostics[0]?.code}`,
          );
        }
        return {
          ok: true,
          value: {
            workspaceId: input.workspaceId,
            proposalCommitId: committed.commit.id,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'target_unavailable',
            target: 'workbook.version.commitProposalWorkspace',
            diagnostics: [
              {
                code: 'TEST_WORKSPACE_COMMIT_FAILED',
                severity: 'error',
                message: error instanceof Error ? error.message : 'Workspace commit failed.',
              },
            ],
          },
        };
      }
    },
  };
}

export function misboundStartWorkspaceService(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
): ProposalWorkspaceLifecycleService {
  return {
    ...graphCommittingWorkspaceService(provider),
    async startProposalWorkspace(input) {
      const started = await graphCommittingWorkspaceService(provider).startProposalWorkspace(input);
      if (!started.ok) return started;
      return {
        ok: true,
        value: {
          ...started.value,
          proposalId: `${started.value.proposalId}:other` as never,
        },
      };
    },
  };
}

export function mismatchedCommitWorkspaceService(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
): ProposalWorkspaceLifecycleService {
  return {
    ...graphCommittingWorkspaceService(provider),
    async commitProposalWorkspace(input) {
      const committed =
        await graphCommittingWorkspaceService(provider).commitProposalWorkspace(input);
      if (!committed.ok) return committed;
      return {
        ok: true,
        value: {
          ...committed.value,
          workspaceId: `${committed.value.workspaceId}:other`,
        },
      };
    },
  };
}

export function wrongBranchCommittingWorkspaceService(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
  mainHeadCommitId: WorkbookCommitId,
): ProposalWorkspaceLifecycleService {
  return {
    ...graphCommittingWorkspaceService(provider),
    async commitProposalWorkspace(input) {
      const wrongBranchCommitId = await commitMain(provider, mainHeadCommitId);
      return {
        ok: true,
        value: {
          workspaceId: input.workspaceId,
          proposalCommitId: wrongBranchCommitId,
        },
      };
    },
  };
}

export async function graphWithRoot() {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1'));
  expectInitializeSuccess(initialized);
  return {
    provider,
    rootCommitId: initialized.rootCommit.id,
  };
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.issueCode}`);
  }
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
  expectedTargetRefVersion: RefVersion,
  targetRef: string,
): Promise<CommitVersionGraphInput> {
  return {
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label: 'proposal',
      sheets: [{ id: 'sheet-1', cells: { B1: 'proposal-edit' } }],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes: [
        {
          changeId: 'proposal-change-b1',
          domain: 'cell',
          entityId: 'sheet-1!B1',
          propertyPath: ['value'],
          before: { kind: 'value', value: null },
          after: { kind: 'value', value: 'proposal-edit' },
        },
      ],
    }),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: 'proposal-segment-1',
      }),
    ],
    author: GRAPH_AUTHOR,
    createdAt: '2026-06-22T00:00:01.000Z',
    completenessDiagnostics: [],
    targetRef,
    expectedHeadCommitId,
    expectedTargetRefVersion,
    parentCommitIds: [expectedHeadCommitId],
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
