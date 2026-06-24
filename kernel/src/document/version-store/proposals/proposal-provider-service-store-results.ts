import type { AgentProposal, VersionResult } from '@mog-sdk/contracts/api';

import { ok, storeFailure } from './proposal-provider-service-diagnostics';
import { publicProposal } from './proposal-provider-service-utils';
import type { AgentProposalRecord } from './proposal-store';

export function proposalStoreResult(
  result: VersionResult<AgentProposalRecord>,
): VersionResult<AgentProposal> {
  return result.ok ? ok(publicProposal(result.value)) : storeFailure(result);
}

export function proposalStoreUpdateResult(
  result: VersionResult<AgentProposalRecord>,
): VersionResult<AgentProposal> {
  return proposalStoreResult(result);
}
