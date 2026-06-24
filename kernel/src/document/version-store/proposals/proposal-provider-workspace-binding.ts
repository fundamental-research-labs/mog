import type { AgentProposalWorkspaceHandle, VersionResult } from '@mog-sdk/contracts/api';

import type { AgentProposalRecord } from './proposal-store';
import type { ProviderBackedProposalWorkspaceCommitResult } from './proposal-workspace-lifecycle-service';
import { publicRefVersion } from './proposal-provider-service-utils';

export function validateProposalWorkspaceHandle(input: {
  readonly proposal: AgentProposalRecord;
  readonly handle: AgentProposalWorkspaceHandle;
}): { readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> } {
  const mismatch = workspaceBindingMismatch(input.proposal, input.handle);
  if (mismatch) {
    return {
      ok: false,
      result: invalidState(
        mismatch,
        ['matching_proposal_workspace'],
        'Proposal workspace handle must match the stored proposal binding.',
      ),
    };
  }
  if (
    !input.handle.workspaceId ||
    !input.handle.providerIdentity ||
    !input.handle.workbookSessionId
  ) {
    return {
      ok: false,
      result: invalidState(
        'proposal_workspace_identity_incomplete',
        ['complete_workspace_identity'],
        'Proposal workspace handles must include stable workspace, provider, and session identities.',
      ),
    };
  }
  return { ok: true };
}

export function validateProposalWorkspaceCommitResult(input: {
  readonly workspaceId: string;
  readonly result: ProviderBackedProposalWorkspaceCommitResult;
}): { readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> } {
  if (input.result.workspaceId === input.workspaceId) return { ok: true };
  return {
    ok: false,
    result: invalidState(
      'proposal_workspace_commit_mismatch',
      ['matching_workspace_id'],
      'Proposal workspace commit results must echo the committed workspace id.',
    ),
  };
}

function workspaceBindingMismatch(
  proposal: AgentProposalRecord,
  handle: AgentProposalWorkspaceHandle,
): string | null {
  if (handle.proposalId !== proposal.id) return 'proposal_workspace_proposal_mismatch';
  if (handle.proposalBranchName !== proposal.proposalBranchName) {
    return 'proposal_workspace_branch_mismatch';
  }
  if (handle.baseCommitId !== proposal.baseCommitId) return 'proposal_workspace_base_mismatch';
  if (handle.targetRef !== undefined && handle.targetRef !== proposal.targetRef) {
    return 'proposal_workspace_target_ref_mismatch';
  }
  if (
    handle.targetHeadIdAtCreation !== undefined &&
    handle.targetHeadIdAtCreation !== proposal.targetHeadIdAtCreation
  ) {
    return 'proposal_workspace_target_head_mismatch';
  }
  if (
    handle.targetRefRevisionAtCreation !== undefined &&
    proposal.targetRefVersionAtCreation !== undefined &&
    (handle.targetRefRevisionAtCreation.kind !== proposal.targetRefVersionAtCreation.kind ||
      handle.targetRefRevisionAtCreation.value !== proposal.targetRefVersionAtCreation.value)
  ) {
    return 'proposal_workspace_target_ref_revision_mismatch';
  }
  return null;
}

export function proposalWorkspaceHandleWithTargetBinding(
  proposal: AgentProposalRecord,
  handle: AgentProposalWorkspaceHandle,
): AgentProposalWorkspaceHandle {
  return {
    ...handle,
    targetRef: proposal.targetRef as AgentProposalWorkspaceHandle['targetRef'],
    targetHeadIdAtCreation:
      proposal.targetHeadIdAtCreation as AgentProposalWorkspaceHandle['targetHeadIdAtCreation'],
    ...(proposal.targetRefVersionAtCreation === undefined
      ? {}
      : { targetRefRevisionAtCreation: publicRefVersion(proposal.targetRefVersionAtCreation) }),
  };
}

function invalidState<T>(
  state: string,
  allowed: readonly string[],
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_state', state, allowed, reason } };
}
