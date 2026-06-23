import { isRecord } from './proposal-store-codec';
import type { AgentProposalMetadataStoreProvider } from './proposal-store-types';

export function hasAgentProposalMetadataStoreProvider(
  value: unknown,
): value is AgentProposalMetadataStoreProvider {
  return isRecord(value) && typeof value.openAgentProposalMetadataStore === 'function';
}
