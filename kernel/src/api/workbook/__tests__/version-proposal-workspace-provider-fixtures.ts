import { expect } from '@jest/globals';
import type {
  AgentProposalWorkspaceHandle,
  VersionCreateReviewInput,
  VersionGetReviewInput,
  VersionUpdateReviewStatusInput,
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor as GraphVersionAuthor } from '@mog-sdk/contracts/versioning';

import type { CommitVersionGraphInput } from '../../../document/version-store/graph-store';
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
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
} from '../../../document/version-store/provider';
import type { RefVersion } from '../../../document/version-store/ref-store';
import {
  proposalWorkspaceStaleHeadResult,
  type ProposalWorkspaceLifecycleService,
} from '../../../document/version-store/proposal-workspace-lifecycle-service';
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
const PASSED_VERIFICATION = {
  status: 'passed',
  checks: [],
  createdAt: '2026-06-22T00:00:02.000Z',
} as const;

export type InMemoryVersionStoreProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;
export type ProposalWorkspaceGraph = Awaited<ReturnType<typeof graphWithRoot>>;

export function versionForProvider(
  provider: InMemoryVersionStoreProvider,
  proposalWorkspaceService: ProposalWorkspaceLifecycleService,
  versioning: Partial<Parameters<typeof attachWorkbookVersioning>[1]> = {},
): WorkbookVersionImpl {
  const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
  const mergeCap = async () => undefined as never;
  attachWorkbookVersioning(ctx, {
    provider,
    captureMergeCommit: mergeCap,
    proposalWorkspaceService,
    ...versioning,
  });
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

export async function openProposalWorkspace(
  version: WorkbookVersionImpl,
  suffix: string,
): Promise<AgentProposalWorkspaceHandle> {
  const created = await version.createProposal(createProposalInput(`proposal-create-${suffix}`));
  if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);
  const opened = await version.startProposalWorkspace({
    clientRequestId: `workspace-open-${suffix}`,
    proposalId: created.value.id,
    expectedRevision: 1,
    actor: ACTOR,
  });
  if (!opened.ok) throw new Error(`expected workspace open success: ${opened.error.code}`);
  return opened.value;
}

export async function createReadyReviewedProposal(
  version: WorkbookVersionImpl,
  graph: ProposalWorkspaceGraph,
  suffix: string,
  approve = true,
) {
  const opened = await openProposalWorkspace(version, suffix);
  const committed = await version.commitProposalWorkspace({
    clientRequestId: `workspace-commit-${suffix}`,
    proposalId: opened.proposalId,
    workspaceId: opened.workspaceId,
    expectedRevision: 2,
    actor: ACTOR,
    message: 'Agent proposal commit',
  });
  if (!committed.ok) throw new Error(`expected proposal commit success: ${committed.error.code}`);
  const verified = await version.markProposalVerified({
    clientRequestId: `proposal-verify-${suffix}`,
    proposalId: opened.proposalId,
    expectedRevision: 3,
    actor: ACTOR,
    verification: PASSED_VERIFICATION,
  });
  if (!verified.ok) throw new Error(`expected proposal verify success: ${verified.error.code}`);
  const review = await version.openProposalReview({
    clientRequestId: `proposal-review-${suffix}`,
    proposalId: opened.proposalId,
    expectedRevision: 4,
    actor: ACTOR,
  });
  if (!review.ok) throw new Error(`expected proposal review success: ${review.error.code}`);
  if (approve) {
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
    proposalId: opened.proposalId,
    proposalCommitId: committed.value.proposalCommitId,
    reviewId: review.value.id,
  };
}

function approveReview(
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

export function workspaceLookupService(): ProposalWorkspaceLifecycleService {
  const handles = new Map<string, AgentProposalWorkspaceHandle>();
  return {
    async startProposalWorkspace(input) {
      const handle: AgentProposalWorkspaceHandle = {
        workspaceId: `workspace:${input.proposal.id}`,
        proposalId: input.proposal.id,
        proposalBranchName: input.proposal.proposalBranchName,
        baseCommitId: input.proposal.baseCommitId,
        providerIdentity: 'in-memory-test-provider',
        workbookSessionId: `session:${input.proposal.id}`,
      };
      handles.set(handle.workspaceId, handle);
      return { ok: true, value: handle };
    },
    async getProposalWorkspace(input) {
      const handle = handles.get(input.workspaceId);
      return handle
        ? ({ ok: true, value: handle } as const)
        : ({
            ok: false,
            error: {
              code: 'target_unavailable',
              target: 'workbook.version.getProposalWorkspace',
              diagnostics: [
                {
                  code: 'TEST_WORKSPACE_NOT_FOUND',
                  severity: 'error',
                  message: 'Workspace handle was not found.',
                },
              ],
            },
          } as const);
    },
    async disposeProposalWorkspace(input) {
      handles.delete(input.workspaceId);
      return { ok: true, value: { disposed: true } };
    },
    async commitProposalWorkspace() {
      return {
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.commitProposalWorkspace',
          diagnostics: [
            {
              code: 'TEST_COMMIT_UNAVAILABLE',
              severity: 'error',
              message: 'This test service only supports lookup and disposal.',
            },
          ],
        },
      };
    },
  };
}

export function misboundLookupService(): ProposalWorkspaceLifecycleService {
  const base = workspaceLookupService();
  return {
    ...base,
    async getProposalWorkspace(input) {
      const workspace = await base.getProposalWorkspace(input);
      if (!workspace.ok) return workspace;
      return {
        ok: true,
        value: {
          ...workspace.value,
          proposalBranchName: `${workspace.value.proposalBranchName}-other` as never,
        },
      };
    },
  };
}

export function misbasedLookupService(): ProposalWorkspaceLifecycleService {
  const base = workspaceLookupService();
  return {
    ...base,
    async getProposalWorkspace(input) {
      const workspace = await base.getProposalWorkspace(input);
      if (!workspace.ok) return workspace;
      return {
        ok: true,
        value: {
          ...workspace.value,
          baseCommitId: `commit:sha256:${'f'.repeat(64)}` as never,
        },
      };
    },
  };
}

export function unsafeStartDiagnosticWorkspaceService(): ProposalWorkspaceLifecycleService {
  return {
    ...workspaceLookupService(),
    async startProposalWorkspace() {
      return {
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.startProposalWorkspace',
          diagnostics: [
            {
              code: 'TEST_UNSAFE_WORKSPACE_DIAGNOSTIC',
              severity: 'error',
              message: 'Workspace denied principal-secret for agent-run-1.',
              data: {
                principalId: 'principal-secret',
                agentRunId: 'agent-run-1',
                safeWorkspaceId: 'workspace:redaction',
                workspaceId: 'workspace-secret',
                providerId: 'provider-secret',
                providerIdentity: 'provider-secret-identity',
                safeNote: 'agent-run-1',
                safeTokens: ['principal-secret', 'agent-run-1'],
                workspace: {
                  workspaceId: 'workspace-secret',
                  principalScope: 'principal-secret',
                },
                nested: {
                  actorId: 'actor-secret',
                  safeStatus: 'kept',
                  safeNote: 'agent-run-1',
                },
              },
            },
          ],
        },
      };
    },
  };
}

export function missingLinkedReviewService() {
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
      return { ok: true, value: review } as const;
    },
    async getReview(input: VersionGetReviewInput) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          target: 'workbook.version.review',
          reason: `Review record ${input.reviewId} was not found.`,
        },
      } as const;
    },
  };
}

export function staleHeadCheckingWorkspaceService(
  provider: InMemoryVersionStoreProvider,
): ProposalWorkspaceLifecycleService {
  const base = workspaceLookupService();
  return {
    ...base,
    async commitProposalWorkspace(input) {
      const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
      const graph = await provider.openGraph(namespace);
      const proposalRefName = `refs/heads/${input.proposal.proposalBranchName}`;
      const branch = await graph.readRef(proposalRefName);
      if (branch.status !== 'success' || branch.ref.name === 'HEAD') {
        throw new Error('expected proposal branch ref before workspace commit');
      }
      if (branch.ref.commitId !== input.proposal.baseCommitId) {
        return proposalWorkspaceStaleHeadResult({
          operation: 'commitProposalWorkspace',
          proposalId: input.proposal.id,
          workspaceId: input.workspaceId,
          proposalBranchName: input.proposal.proposalBranchName,
          expectedWorkspaceHeadId: input.proposal.baseCommitId,
          actualProposalBranchHeadId: branch.ref.commitId,
        });
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
          proposalBranchName: input.proposal.proposalBranchName,
          committedFromHeadId: input.proposal.baseCommitId,
        },
      };
    },
  };
}

export async function graphWithRoot() {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1'));
  expect(initialized.status).toBe('success');
  if (initialized.status !== 'success') throw new Error('expected graph initialize success');
  return {
    provider,
    rootCommitId: initialized.rootCommit.id,
  };
}

export async function commitRef(
  provider: InMemoryVersionStoreProvider,
  targetRef: string,
  expectedHeadCommitId: WorkbookCommitId,
): Promise<WorkbookCommitId> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
  const graph = await provider.openGraph(namespace);
  const ref = await graph.readRef(targetRef);
  if (ref.status !== 'success' || ref.ref.name === 'HEAD') {
    throw new Error(`expected ${targetRef} before workspace stale-head test`);
  }
  const committed = await graph.commit(
    await commitInput(namespace, expectedHeadCommitId, ref.ref.revision, targetRef),
  );
  if (committed.status !== 'success') {
    throw new Error(`expected ${targetRef} move success: ${committed.diagnostics[0]?.code}`);
  }
  return committed.commit.id;
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
      label: 'proposal-workspace-stale-head',
      sheets: [{ id: 'sheet-1', cells: { A1: 'branch-move' } }],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes: [
        {
          changeId: 'proposal-workspace-stale-head-change',
          domain: 'cell',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
          before: { kind: 'value', value: null },
          after: { kind: 'value', value: 'branch-move' },
        },
      ],
    }),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: 'proposal-workspace-stale-head-segment',
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
