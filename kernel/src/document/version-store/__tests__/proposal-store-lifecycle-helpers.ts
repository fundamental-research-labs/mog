import type { AgentProposalMetadataStore } from '../proposal-store';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import { DOCUMENT_SCOPE } from './proposal-store-test-utils';

export async function openProposalLifecycleStore(): Promise<AgentProposalMetadataStore> {
  const provider = createInMemoryVersionStoreProvider({
    documentScope: DOCUMENT_SCOPE,
    backend: new InMemoryVersionDocumentProviderBackend(),
    durability: 'snapshot-test-double',
  });
  return provider.openAgentProposalMetadataStore();
}
