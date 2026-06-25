import type {
  AgentProposal,
  AgentProposalWorkspaceHandle,
  CommitProposalWorkspaceInput,
  DisposeProposalWorkspaceInput,
  GetProposalWorkspaceInput,
  StartProposalWorkspaceInput,
  VersionResult,
} from '@mog-sdk/contracts/api';

import { ensureProposalBranchHead } from './proposal-provider-branch-head-validation';
import type { ProviderBackedAgentProposalServiceContext } from './proposal-provider-service-context';
import { ensureProposalTargetBinding } from './proposal-provider-target-binding';
import {
  invalidState,
  sanitizeProposalProviderDiagnostics,
  sanitizeProposalProviderResult,
  sanitizeProposalProviderValue,
  staleRevision,
  storeFailure,
  workspaceUnavailable,
} from './proposal-provider-service-diagnostics';
import { proposalStoreUpdateResult } from './proposal-provider-service-store-results';
import { isWorkbookCommitId, publicProposal } from './proposal-provider-service-utils';
import {
  proposalWorkspaceHandleWithTargetBinding,
  validateProposalWorkspaceCommitResult,
  validateProposalWorkspaceHandle,
} from './proposal-provider-workspace-binding';
import {
  disposeProviderBackedProposalWorkspace,
  getProviderBackedProposalWorkspace as readProviderBackedProposalWorkspace,
} from './proposal-provider-workspace-access-service';

export async function startProviderBackedProposalWorkspace(
  context: ProviderBackedAgentProposalServiceContext,
  input: StartProposalWorkspaceInput,
): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
  const store = await context.openProposalStore('startProposalWorkspace');
  if (!store.ok) return store.result;
  const proposal = await store.value.getProposal(input.proposalId);
  if (!proposal.ok) return storeFailure(proposal);
  if (proposal.value.revision !== input.expectedRevision) {
    return staleRevision(input.expectedRevision, proposal.value.revision);
  }
  if (proposal.value.status !== 'draft') {
    return invalidState(
      'proposal_workspace_not_draft',
      ['draft'],
      'Only draft proposals can open a proposal workspace.',
    );
  }

  const targetBinding = await ensureProposalTargetBinding({
    proposal: proposal.value,
    operation: 'startProposalWorkspace',
    expected: input,
    resolveTargetHead: context.resolveTargetHead,
  });
  if (!targetBinding.ok) return sanitizeProposalProviderResult(targetBinding.result);

  const branchReady = await context.ensureProposalBranch(proposal.value, 'startProposalWorkspace');
  if (!branchReady.ok) return sanitizeProposalProviderResult(branchReady.result);

  if (!context.workspaceService) return workspaceUnavailable('startProposalWorkspace');
  const started = await context.callWorkspaceService('startProposalWorkspace', () =>
    context.workspaceService!.startProposalWorkspace({
      ...input,
      proposal: publicProposal(proposal.value),
      proposalRecord: proposal.value,
    }),
  );
  if (!started.ok) return started;
  const workspaceBinding = validateProposalWorkspaceHandle({
    proposal: proposal.value,
    handle: started.value,
  });
  if (!workspaceBinding.ok) return sanitizeProposalProviderResult(workspaceBinding.result);
  const handle = proposalWorkspaceHandleWithTargetBinding(proposal.value, started.value);

  const updated = await store.value.updateProposal({
    clientRequestId: input.clientRequestId,
    proposalId: input.proposalId,
    expectedRevision: input.expectedRevision,
    status: 'workspace_open',
    trustedActor: input.actor,
    workspaceId: handle.workspaceId,
  });
  if (!updated.ok) return storeFailure(updated);
  return { ok: true, value: handle };
}

export async function getProviderBackedProposalWorkspace(
  context: ProviderBackedAgentProposalServiceContext,
  input: GetProposalWorkspaceInput,
): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
  return sanitizeProposalProviderResult(
    await readProviderBackedProposalWorkspace({
      input,
      openStore: context.openStore,
      ...(context.workspaceService ? { workspaceService: context.workspaceService } : {}),
      resolveTargetHead: context.resolveTargetHead,
    }),
  );
}

export async function disposeProviderBackedAgentProposalWorkspace(
  context: ProviderBackedAgentProposalServiceContext,
  input: DisposeProposalWorkspaceInput,
): Promise<VersionResult<{ readonly disposed: true }>> {
  return sanitizeProposalProviderResult(
    await disposeProviderBackedProposalWorkspace({
      input,
      openStore: context.openStore,
      ...(context.workspaceService ? { workspaceService: context.workspaceService } : {}),
      resolveTargetHead: context.resolveTargetHead,
    }),
  );
}

export async function commitProviderBackedProposalWorkspace(
  context: ProviderBackedAgentProposalServiceContext,
  input: CommitProposalWorkspaceInput,
): Promise<VersionResult<AgentProposal>> {
  const store = await context.openProposalStore('commitProposalWorkspace');
  if (!store.ok) return store.result;
  const proposal = await store.value.getProposal(input.proposalId);
  if (!proposal.ok) return storeFailure(proposal);
  if (proposal.value.revision !== input.expectedRevision) {
    return staleRevision(input.expectedRevision, proposal.value.revision);
  }
  if (proposal.value.status !== 'workspace_open') {
    return invalidState(
      'proposal_workspace_not_open',
      ['workspace_open'],
      'Only workspace-open proposals can be committed.',
    );
  }
  if (proposal.value.workspaceId !== input.workspaceId) {
    return invalidState(
      'proposal_workspace_mismatch',
      ['matching_workspace_id'],
      'Proposal workspace commits must use the workspace opened for the proposal.',
    );
  }
  const workspaceProposal = await store.value.getProposalByWorkspaceId(input.workspaceId);
  if (!workspaceProposal.ok) return storeFailure(workspaceProposal);
  if (workspaceProposal.value.id !== proposal.value.id) {
    return invalidState(
      'proposal_workspace_mismatch',
      ['matching_workspace_id'],
      'Proposal workspace commits must use the workspace opened for the proposal.',
    );
  }
  if (workspaceProposal.value.revision !== input.expectedRevision) {
    return staleRevision(input.expectedRevision, workspaceProposal.value.revision);
  }
  if (workspaceProposal.value.status !== 'workspace_open') {
    return invalidState(
      'proposal_workspace_not_open',
      ['workspace_open'],
      'Only workspace-open proposals can be committed.',
    );
  }
  if (
    workspaceProposal.value.proposalBranchName !== proposal.value.proposalBranchName ||
    workspaceProposal.value.baseCommitId !== proposal.value.baseCommitId
  ) {
    return invalidState(
      'proposal_workspace_branch_mismatch',
      ['matching_proposal_workspace'],
      'Proposal workspace commits must use the stored proposal branch opened for the workspace.',
    );
  }

  const targetBinding = await ensureProposalTargetBinding({
    proposal: proposal.value,
    operation: 'commitProposalWorkspace',
    expected: input,
    resolveTargetHead: context.resolveTargetHead,
  });
  if (!targetBinding.ok) return sanitizeProposalProviderResult(targetBinding.result);

  if (!context.workspaceService) return workspaceUnavailable('commitProposalWorkspace');
  const committed = await context.callWorkspaceService('commitProposalWorkspace', () =>
    context.workspaceService!.commitProposalWorkspace({
      ...input,
      proposal: publicProposal(proposal.value),
      proposalRecord: proposal.value,
    }),
  );
  if (!committed.ok) return committed;
  const workspaceBinding = validateProposalWorkspaceCommitResult({
    proposal: proposal.value,
    workspaceId: input.workspaceId,
    result: committed.value,
  });
  if (!workspaceBinding.ok) return sanitizeProposalProviderResult(workspaceBinding.result);
  if (!isWorkbookCommitId(committed.value.proposalCommitId)) {
    return invalidState(
      'invalid_proposal_commit',
      ['valid_proposalCommitId'],
      'Proposal workspace commits must return a public workbook commit id.',
    );
  }
  const commitExists = await context.ensureCommitExists(
    committed.value.proposalCommitId,
    'commitProposalWorkspace',
  );
  if (!commitExists.ok) return sanitizeProposalProviderResult(commitExists.result);
  const branchHead = await ensureProposalBranchHead({
    branchService: context.branchService,
    operation: 'commitProposalWorkspace',
    proposalBranchName: proposal.value.proposalBranchName,
    expectedHeadCommitId: committed.value.proposalCommitId,
  });
  if (!branchHead.ok) return sanitizeProposalProviderResult(branchHead.result);

  return proposalStoreUpdateResult(
    await store.value.updateProposal({
      clientRequestId: input.clientRequestId,
      proposalId: input.proposalId,
      expectedRevision: input.expectedRevision,
      status: 'committed',
      trustedActor: input.actor,
      proposalCommitId: committed.value.proposalCommitId,
      ...(input.verification === undefined
        ? {}
        : { verification: sanitizeProposalProviderValue(input.verification) }),
      ...(committed.value.diagnostics === undefined
        ? {}
        : { diagnostics: sanitizeProposalProviderDiagnostics(committed.value.diagnostics) }),
    }),
  );
}
