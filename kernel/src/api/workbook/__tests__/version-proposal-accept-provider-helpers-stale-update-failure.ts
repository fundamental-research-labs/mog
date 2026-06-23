import type { VersionDiagnostic, VersionResult } from '@mog-sdk/contracts/api';

import type { InMemoryVersionStoreProvider } from './version-proposal-accept-provider-helpers-graph';

type AgentProposalStore = Awaited<
  ReturnType<InMemoryVersionStoreProvider['openAgentProposalMetadataStore']>
>;
type UpdateProposalInput = Parameters<AgentProposalStore['updateProposal']>[0];

export function providerWithFirstStaleProposalUpdateFailure(
  provider: InMemoryVersionStoreProvider,
  options: {
    readonly clientRequestId: string;
    readonly diagnostic: VersionDiagnostic;
  },
): InMemoryVersionStoreProvider {
  let pendingFailure = true;
  return new Proxy(provider, {
    get(target, property) {
      if (property === 'openAgentProposalMetadataStore') {
        return async () => {
          const store = await target.openAgentProposalMetadataStore();
          return staleUpdateFailingStore(store, {
            shouldFail: (input) => {
              if (
                !pendingFailure ||
                input.status !== 'stale' ||
                input.clientRequestId !== options.clientRequestId
              ) {
                return false;
              }
              pendingFailure = false;
              return true;
            },
            diagnostic: options.diagnostic,
          });
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as InMemoryVersionStoreProvider;
}

export function noWriteStaleProposalUpdateDiagnostic(clientRequestId: string): VersionDiagnostic {
  return {
    code: 'proposal_accept_stale_update_no_write',
    severity: 'warning',
    message: 'Stale proposal accept update was rejected before writing.',
    owner: 'version-store',
    data: {
      operation: 'acceptProposal',
      acceptClientRequestId: clientRequestId,
      mutationGuarantee: 'no-write-attempted',
    },
  };
}

function staleUpdateFailingStore(
  store: AgentProposalStore,
  options: {
    readonly shouldFail: (input: UpdateProposalInput) => boolean;
    readonly diagnostic: VersionDiagnostic;
  },
): AgentProposalStore {
  return {
    documentScope: store.documentScope,
    createProposal: (input) => store.createProposal(input),
    getProposal: (proposalId) => store.getProposal(proposalId),
    getProposalByWorkspaceId: (workspaceId) => store.getProposalByWorkspaceId(workspaceId),
    listProposals: (input) => store.listProposals(input),
    updateProposal: async (input) => {
      if (options.shouldFail(input)) return noWriteProposalUpdateFailure(options.diagnostic);
      return store.updateProposal(input);
    },
  };
}

function noWriteProposalUpdateFailure<T>(diagnostic: VersionDiagnostic): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.acceptProposal',
      diagnostics: [diagnostic],
    },
  };
}
