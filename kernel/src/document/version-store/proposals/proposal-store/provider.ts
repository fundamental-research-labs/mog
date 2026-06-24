import { isRecord } from './codec';
import type { AgentProposalMetadataStoreProvider } from './types';

export function hasAgentProposalMetadataStoreProvider(
  value: unknown,
): value is AgentProposalMetadataStoreProvider {
  return isRecord(value) && typeof value.openAgentProposalMetadataStore === 'function';
}
