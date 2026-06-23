import { expect } from '@jest/globals';
import type { VersionUpdateReviewStatusInput } from '@mog-sdk/contracts/api';

import type { ProposalWorkspaceLifecycleService } from '../../../document/version-store/proposal-workspace-lifecycle-service';
import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import {
  ACTOR,
  AGENT,
  DOCUMENT_SCOPE,
  PASSED_VERIFICATION,
  REDACTION_POLICY,
} from './version-proposal-accept-provider-helpers-fixtures';
import { commitInput } from './version-proposal-accept-provider-helpers-graph';
import type {
  graphWithRoot,
  InMemoryVersionStoreProvider,
} from './version-proposal-accept-provider-helpers-graph';

export function versionForProvider(
  provider: InMemoryVersionStoreProvider,
  proposalWorkspaceService: ProposalWorkspaceLifecycleService,
  options: { readonly proposalAcceptMergeApplyCapability?: boolean } = {},
): WorkbookVersionImpl {
  const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
  attachWorkbookVersioning(ctx, {
    provider,
    proposalWorkspaceService,
    ...(options.proposalAcceptMergeApplyCapability === false
      ? {}
      : { captureMergeCommit: unexpectedMergeCommitCapture }),
  });
  return new WorkbookVersionImpl(ctx);
}

export async function createReadyReviewedProposal(
  version: WorkbookVersionImpl,
  graph: Awaited<ReturnType<typeof graphWithRoot>>,
  suffix: string,
) {
  const created = await version.createProposal({
    clientRequestId: `proposal-create-${suffix}`,
    title: 'Proposal One',
    targetRef: 'refs/heads/main',
    agentRunId: 'agent-run-1',
    agent: AGENT,
    redactionPolicy: REDACTION_POLICY,
  });
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
  const approved = await approveReview(
    version,
    review.value.id,
    review.value.revision,
    `proposal-review-approve-${suffix}`,
  );
  if (!approved.ok) throw new Error(`expected review approval success: ${approved.error.code}`);

  expect(committed.value.baseCommitId).toBe(graph.rootCommitId);
  return {
    proposalId: created.value.id,
    proposalCommitId: committed.value.proposalCommitId,
    proposalBranchName: created.value.proposalBranchName,
    reviewId: review.value.id,
  };
}

export function graphCommittingWorkspaceService(
  provider: InMemoryVersionStoreProvider,
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
    },
  };
}

async function unexpectedMergeCommitCapture(): Promise<never> {
  throw new Error('proposal accept capability fixture must not materialize merge commits');
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
