import type {
  AgentProposal,
  AgentProposalSummary as PublicAgentProposalSummary,
  CreateAgentProposalInput,
  FailAgentProposalInput,
  GetAgentProposalInput,
  ListAgentProposalsInput,
  MarkAgentProposalVerifiedInput,
  Paged,
  RejectAgentProposalInput,
  SupersedeAgentProposalInput,
  VersionResult,
} from '@mog-sdk/contracts/api';

import type { ProviderBackedAgentProposalServiceContext } from './proposal-provider-service-context';
import {
  invalidState,
  ok,
  sanitizeProposalProviderDiagnostics,
  sanitizeProposalProviderValue,
  storeFailure,
} from './proposal-provider-service-diagnostics';
import {
  isWorkbookCommitId,
  proposalBranchNameFor,
  publicProposal,
  publicProposalSummary,
} from './proposal-provider-service-utils';
import {
  proposalStoreResult,
  proposalStoreUpdateResult,
} from './proposal-provider-service-store-results';

export async function createProviderBackedAgentProposal(
  context: ProviderBackedAgentProposalServiceContext,
  input: CreateAgentProposalInput,
): Promise<VersionResult<AgentProposal>> {
  const store = await context.openProposalStore('createProposal');
  if (!store.ok) return store.result;

  const target = await context.resolveTargetHead(input.targetRef, 'createProposal');
  if (!target.ok) return target.result;

  const baseCommitId = input.baseCommitId ?? target.head.commitId;
  if (!isWorkbookCommitId(baseCommitId)) {
    return invalidState(
      'invalid_proposal_base_commit',
      ['valid_baseCommitId', 'omitted_baseCommitId'],
      'Proposal baseCommitId must be a public workbook commit id.',
    );
  }
  if (baseCommitId !== target.head.commitId) {
    return invalidState(
      'proposal_base_mismatch',
      ['current_target_head'],
      'Proposal baseCommitId must match the current target ref head.',
    );
  }

  const proposalBranchName = await proposalBranchNameFor(input);
  if (!proposalBranchName.ok) return proposalBranchName.result;

  const existingBranch = await context.readOptionalProposalBranch(
    proposalBranchName.branchName,
    baseCommitId,
    'createProposal',
  );
  if (!existingBranch.ok) return existingBranch.result;

  if (!existingBranch.exists) {
    const branchCreated = await context.createProposalBranch(
      proposalBranchName.branchName,
      baseCommitId,
      'createProposal',
    );
    if (!branchCreated.ok) return branchCreated.result;
  }

  const created = await store.value.createProposal({
    clientRequestId: input.clientRequestId,
    title: input.title,
    targetRef: target.head.refName,
    baseCommitId,
    targetHeadIdAtCreation: target.head.commitId,
    targetRefVersionAtCreation: target.head.refVersion,
    proposalBranchName: proposalBranchName.branchName,
    redactionPolicy: input.redactionPolicy,
    trustedIdentity: {
      actor: input.agent,
      agent: input.agent,
      agentRunId: input.agentRunId,
    },
  });
  if (!created.ok) return storeFailure(created);

  return ok(publicProposal(created.value));
}

export async function failProviderBackedAgentProposal(
  context: ProviderBackedAgentProposalServiceContext,
  input: FailAgentProposalInput,
): Promise<VersionResult<AgentProposal>> {
  const store = await context.openProposalStore('failProposal');
  if (!store.ok) return store.result;
  return proposalStoreUpdateResult(
    await store.value.updateProposal({
      clientRequestId: input.clientRequestId,
      proposalId: input.proposalId,
      expectedRevision: input.expectedRevision,
      status: 'failed',
      trustedActor: input.actor,
      diagnostics: sanitizeProposalProviderDiagnostics(input.diagnostics),
    }),
  );
}

export async function getProviderBackedAgentProposal(
  context: ProviderBackedAgentProposalServiceContext,
  input: GetAgentProposalInput,
): Promise<VersionResult<AgentProposal>> {
  const store = await context.openProposalStore('getProposal');
  if (!store.ok) return store.result;
  return proposalStoreResult(await store.value.getProposal(input.proposalId));
}

export async function listProviderBackedAgentProposals(
  context: ProviderBackedAgentProposalServiceContext,
  input: ListAgentProposalsInput = {},
): Promise<VersionResult<Paged<PublicAgentProposalSummary>>> {
  const store = await context.openProposalStore('listProposals');
  if (!store.ok) return store.result;
  const listed = await store.value.listProposals(input);
  if (!listed.ok) return storeFailure(listed);
  return {
    ok: true,
    value: {
      items: listed.value.items.map(publicProposalSummary),
      ...(listed.value.nextCursor ? { nextCursor: listed.value.nextCursor } : {}),
      limit: listed.value.limit,
      ...(listed.value.totalEstimate === undefined
        ? {}
        : { totalEstimate: listed.value.totalEstimate }),
    },
  };
}

export async function markProviderBackedAgentProposalVerified(
  context: ProviderBackedAgentProposalServiceContext,
  input: MarkAgentProposalVerifiedInput,
): Promise<VersionResult<AgentProposal>> {
  const store = await context.openProposalStore('markProposalVerified');
  if (!store.ok) return store.result;
  return proposalStoreUpdateResult(
    await store.value.updateProposal({
      clientRequestId: input.clientRequestId,
      proposalId: input.proposalId,
      expectedRevision: input.expectedRevision,
      status: 'verified',
      trustedActor: input.actor,
      verification: sanitizeProposalProviderValue(input.verification),
    }),
  );
}

export async function rejectProviderBackedAgentProposal(
  context: ProviderBackedAgentProposalServiceContext,
  input: RejectAgentProposalInput,
): Promise<VersionResult<AgentProposal>> {
  const store = await context.openProposalStore('rejectProposal');
  if (!store.ok) return store.result;
  return proposalStoreUpdateResult(
    await store.value.updateProposal({
      clientRequestId: input.clientRequestId,
      proposalId: input.proposalId,
      expectedRevision: input.expectedRevision,
      status: 'rejected',
      trustedActor: input.actor,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    }),
  );
}

export async function supersedeProviderBackedAgentProposal(
  context: ProviderBackedAgentProposalServiceContext,
  input: SupersedeAgentProposalInput,
): Promise<VersionResult<AgentProposal>> {
  const store = await context.openProposalStore('supersedeProposal');
  if (!store.ok) return store.result;
  return proposalStoreUpdateResult(
    await store.value.updateProposal({
      clientRequestId: input.clientRequestId,
      proposalId: input.proposalId,
      expectedRevision: input.expectedRevision,
      status: 'superseded',
      trustedActor: input.actor,
      ...(input.supersededByProposalId === undefined
        ? {}
        : { supersededByProposalId: input.supersededByProposalId }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    }),
  );
}
