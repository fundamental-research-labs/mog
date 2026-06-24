import type { VersionAuthor, VersionResult } from '@mog-sdk/contracts/api';

import { isRecord } from './codec';
import { invalidCreate, invalidUpdate } from './results';
import { AGENT_PROPOSAL_STATUSES, isAgentProposalStatus } from './status';
import type {
  AgentProposalRecord,
  AgentProposalStatus,
  CreateAgentProposalStoreInput,
  UpdateAgentProposalStoreInput,
} from './types';

export function validateCreateProposalInput(
  input: CreateAgentProposalStoreInput,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<AgentProposalRecord> } {
  if (!input.clientRequestId) {
    return invalidCreate(
      'missing_client_request_id',
      ['clientRequestId'],
      'clientRequestId is required.',
    );
  }
  if (!input.title) return invalidCreate('missing_title', ['title'], 'Proposal title is required.');
  if (!input.targetRef) {
    return invalidCreate('missing_target_ref', ['targetRef'], 'Proposal target ref is required.');
  }
  if (!input.baseCommitId) {
    return invalidCreate(
      'missing_base_commit',
      ['baseCommitId'],
      'Proposal base commit is required.',
    );
  }
  if (!input.targetHeadIdAtCreation) {
    return invalidCreate(
      'missing_target_head',
      ['targetHeadIdAtCreation'],
      'Proposal target head at creation is required.',
    );
  }
  if (!isRefVersion(input.targetRefVersionAtCreation)) {
    return invalidCreate(
      'missing_target_ref_revision',
      ['targetRefVersionAtCreation'],
      'Proposal target ref revision at creation is required.',
    );
  }
  if (!input.proposalBranchName) {
    return invalidCreate(
      'missing_proposal_branch',
      ['proposalBranchName'],
      'Proposal branch name is required.',
    );
  }
  if (!isRecord(input.trustedIdentity)) {
    return invalidCreate(
      'invalid_trusted_identity',
      ['trustedIdentity'],
      'Trusted proposal identity must be supplied by the proposal service.',
    );
  }
  if (!input.trustedIdentity.agentRunId) {
    return invalidCreate(
      'missing_agent_run_id',
      ['trustedIdentity.agentRunId'],
      'Trusted proposal identity must include an agent run id.',
    );
  }
  if (
    !isVersionAuthor(input.trustedIdentity.actor) ||
    !isVersionAuthor(input.trustedIdentity.agent)
  ) {
    return invalidCreate(
      'invalid_trusted_identity',
      ['trustedIdentity'],
      'Trusted proposal identity must include actor and agent authors.',
    );
  }
  return { ok: true };
}

export function validateStatusUpdate(
  record: AgentProposalRecord,
  input: UpdateAgentProposalStoreInput,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<AgentProposalRecord> } {
  if (!isAgentProposalStatus(input.status)) {
    return invalidUpdate(
      'invalid_proposal_status',
      [...AGENT_PROPOSAL_STATUSES],
      'Proposal status is not supported.',
    );
  }
  if (input.status === 'draft') {
    return invalidUpdate(
      'proposal_already_created',
      ['workspace_open', 'rejected', 'failed', 'superseded'],
      'Draft proposals are created, not updated back to draft.',
    );
  }
  const allowed = allowedProposalTransitions(record.status);
  if (!allowed.includes(input.status)) {
    return invalidUpdate(
      'proposal_status_transition',
      allowed,
      `Cannot update proposal status from ${record.status} to ${input.status}.`,
    );
  }
  if (input.status === 'workspace_open' && !input.workspaceId) {
    return invalidUpdate(
      'proposal_workspace_required',
      ['workspaceId'],
      'Workspace-open proposals require a workspace id.',
    );
  }
  if (input.status === 'committed' && !input.proposalCommitId) {
    return invalidUpdate(
      'proposal_commit_required',
      ['proposalCommitId'],
      'Committed proposals require a proposal commit id.',
    );
  }
  if (
    input.status === 'verified' &&
    (!input.verification || input.verification.status !== 'passed')
  ) {
    return invalidUpdate(
      'proposal_verification_required',
      ['passed_verification'],
      'Verified proposals require passed verification.',
    );
  }
  if (input.status === 'ready_for_review' && !input.reviewId) {
    return invalidUpdate(
      'proposal_review_required',
      ['reviewId'],
      'Ready-for-review proposals require a review id.',
    );
  }
  if (input.status === 'applied' && !input.accepted) {
    return invalidUpdate(
      'proposal_acceptance_required',
      ['accepted'],
      'Applied proposals require acceptance metadata.',
    );
  }
  if (
    input.status === 'failed' &&
    (!input.diagnostics || input.diagnostics.length === 0) &&
    !input.reason &&
    input.verification?.status !== 'failed' &&
    input.verification?.status !== 'blocked'
  ) {
    return invalidUpdate(
      'proposal_failure_required',
      ['diagnostics', 'reason', 'failed_verification'],
      'Failed proposals require failure evidence.',
    );
  }
  return { ok: true };
}

function allowedProposalTransitions(status: AgentProposalStatus): readonly AgentProposalStatus[] {
  switch (status) {
    case 'draft':
      return ['workspace_open', 'rejected', 'failed', 'superseded'];
    case 'workspace_open':
      return ['committed', 'rejected', 'failed', 'superseded'];
    case 'committed':
      return ['verified', 'rejected', 'failed', 'superseded'];
    case 'verified':
      return ['ready_for_review', 'rejected', 'failed', 'superseded'];
    case 'ready_for_review':
      return ['applied', 'merge_conflicted', 'stale', 'rejected', 'failed', 'superseded'];
    case 'merge_conflicted':
    case 'stale':
    case 'rejected':
    case 'failed':
      return ['superseded'];
    case 'applied':
    case 'superseded':
      return [];
  }
}

function isRefVersion(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.kind === 'counter' &&
    typeof value.value === 'string' &&
    /^(0|[1-9][0-9]*)$/.test(value.value)
  );
}

function isVersionAuthor(value: unknown): value is VersionAuthor {
  return (
    isRecord(value) &&
    typeof value.kind === 'string' &&
    typeof value.trust === 'string' &&
    (value.displayName === undefined || typeof value.displayName === 'string') &&
    (value.principalId === undefined || typeof value.principalId === 'string') &&
    (value.agentRunId === undefined || typeof value.agentRunId === 'string')
  );
}
