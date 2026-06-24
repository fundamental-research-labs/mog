import { AgentProposalMetadataStoreImpl } from './impl';
import { AgentProposalMetadataMemoryBackend } from './memory-backend';
import type { AgentProposalMetadataStore } from './types';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from '../../registry';

export class InMemoryAgentProposalMetadataStore
  extends AgentProposalMetadataStoreImpl
  implements AgentProposalMetadataStore
{
  constructor(options: {
    readonly documentScope: VersionDocumentScope;
    readonly backend: AgentProposalMetadataMemoryBackend;
  }) {
    const documentScope = normalizeVersionDocumentScope(options.documentScope);
    const documentScopeKey = versionDocumentScopeKey(documentScope);
    super({
      documentScope,
      adapter: {
        async readRow(proposalId) {
          return options.backend.get(documentScopeKey, proposalId);
        },
        async listRows() {
          return options.backend.list(documentScopeKey);
        },
        async mutateRow(proposalId, mutator) {
          const result = mutator(options.backend.get(documentScopeKey, proposalId));
          if (result.action === 'put') options.backend.put(result.row);
          return result.result;
        },
        async mutateRows(mutator) {
          const result = mutator(options.backend.list(documentScopeKey));
          if (result.action === 'put') options.backend.put(result.row);
          return result.result;
        },
      },
    });
  }
}
