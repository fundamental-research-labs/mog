import type { ProposalWorkspaceLifecycleService } from '../../../document/version-store/proposals/proposal-workspace-lifecycle-service';
import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import { DOCUMENT_SCOPE } from './version-proposal-accept-provider-helpers-fixtures';
import { commitInput } from './version-proposal-accept-provider-helpers-graph';
import type { InMemoryVersionStoreProvider } from './version-proposal-accept-provider-helpers-graph';

export function graphCommittingWorkspaceService(
  provider: InMemoryVersionStoreProvider,
): ProposalWorkspaceLifecycleService {
  return {
    async startProposalWorkspace(input) {
      return {
        ok: true,
        value: {
          workspaceId: `workspace:${input.proposal.id}`,
          proposalId: input.proposal.id,
          proposalBranchName: input.proposal.proposalBranchName,
          baseCommitId: input.proposal.baseCommitId,
          providerIdentity: 'in-memory-test-provider',
          workbookSessionId: `session:${input.proposal.id}`,
        },
      };
    },
    async getProposalWorkspace(input) {
      return {
        ok: true,
        value: {
          workspaceId: input.workspaceId,
          proposalId: 'proposal:sha256:lookup' as never,
          proposalBranchName: 'agent/lookup' as never,
          baseCommitId: `commit:sha256:${'0'.repeat(64)}` as never,
          providerIdentity: 'in-memory-test-provider',
          workbookSessionId: `session:${input.workspaceId}`,
        },
      };
    },
    async disposeProposalWorkspace() {
      return { ok: true, value: { disposed: true } };
    },
    async commitProposalWorkspace(input) {
      const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
      const graph = await provider.openGraph(namespace);
      const proposalRefName = `refs/heads/${input.proposal.proposalBranchName}`;
      const branch = await graph.readRef(proposalRefName);
      if (branch.status !== 'success' || branch.ref.name === 'HEAD') {
        throw new Error('expected proposal branch ref before workspace commit');
      }
      const committed = await graph.commit(
        await commitInput(namespace, branch.ref.commitId, branch.ref.revision, proposalRefName),
      );
      if (committed.status !== 'success') {
        throw new Error(
          `expected proposal graph commit success: ${committed.diagnostics[0]?.code}`,
        );
      }
      return {
        ok: true,
        value: {
          workspaceId: input.workspaceId,
          proposalCommitId: committed.commit.id,
        },
      };
    },
  };
}
