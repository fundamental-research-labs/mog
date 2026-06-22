import type { VersionResult } from '@mog-sdk/contracts/api';

import type { AgentProposalMetadataStore, AgentProposalRecord } from './proposal-store';

export async function getOpenProposalForWorkspace(input: {
  readonly store: AgentProposalMetadataStore;
  readonly workspaceId: string;
}): Promise<
  | { readonly ok: true; readonly proposal: AgentProposalRecord }
  | { readonly ok: false; readonly result: VersionResult<never> }
> {
  const proposal = await input.store.getProposalByWorkspaceId(input.workspaceId);
  if (!proposal.ok) return { ok: false, result: proposal };
  if (proposal.value.status !== 'workspace_open') {
    return {
      ok: false,
      result: invalidState(
        'proposal_workspace_not_open',
        ['workspace_open'],
        'Only workspace-open proposals can use proposal workspace handles.',
      ),
    };
  }
  return { ok: true, proposal: proposal.value };
}

function invalidState<T>(
  state: string,
  allowed: readonly string[],
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_state', state, allowed, reason } };
}
