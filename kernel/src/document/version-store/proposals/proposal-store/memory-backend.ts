import { agentProposalStorageKey, cloneAgentProposalRow } from './codec';
import type {
  AgentProposalId,
  AgentProposalMetadataMemoryBackendSnapshot,
  AgentProposalStoreRow,
} from './types';

export class AgentProposalMetadataMemoryBackend {
  private readonly rowsByKey = new Map<string, AgentProposalStoreRow>();

  get(
    documentScopeKey: string,
    proposalId: AgentProposalId | string,
  ): AgentProposalStoreRow | undefined {
    return cloneAgentProposalRow(
      this.rowsByKey.get(agentProposalStorageKey(documentScopeKey, proposalId)),
    );
  }

  put(row: AgentProposalStoreRow): void {
    this.rowsByKey.set(
      agentProposalStorageKey(row.documentScopeKey, row.proposalId),
      cloneAgentProposalRow(row),
    );
  }

  list(documentScopeKey: string): readonly AgentProposalStoreRow[] {
    return [...this.rowsByKey.values()]
      .filter((row) => row.documentScopeKey === documentScopeKey)
      .map((row) => cloneAgentProposalRow(row));
  }

  exportSnapshot(): AgentProposalMetadataMemoryBackendSnapshot {
    return { rows: [...this.rowsByKey.values()].map((row) => cloneAgentProposalRow(row)) };
  }

  static fromSnapshot(
    snapshot: AgentProposalMetadataMemoryBackendSnapshot,
  ): AgentProposalMetadataMemoryBackend {
    const backend = new AgentProposalMetadataMemoryBackend();
    for (const row of snapshot.rows) backend.put(row);
    return backend;
  }
}
