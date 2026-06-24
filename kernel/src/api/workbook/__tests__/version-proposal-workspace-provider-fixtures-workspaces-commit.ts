import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import {
  proposalWorkspaceStaleHeadResult,
  type ProposalWorkspaceLifecycleService,
} from '../../../document/version-store/proposals/proposal-workspace-lifecycle-service';
import {
  DOCUMENT_SCOPE,
  type InMemoryVersionStoreProvider,
} from './version-proposal-workspace-provider-fixtures-core';
import { commitInput } from './version-proposal-workspace-provider-fixtures-graph';
import { workspaceLookupService } from './version-proposal-workspace-provider-fixtures-workspaces-lookup';

export function staleHeadCheckingWorkspaceService(
  provider: InMemoryVersionStoreProvider,
): ProposalWorkspaceLifecycleService {
  const base = workspaceLookupService();
  return {
    ...base,
    async commitProposalWorkspace(input) {
      const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
      const graph = await provider.openGraph(namespace);
      const proposalRefName = `refs/heads/${input.proposal.proposalBranchName}`;
      const branch = await graph.readRef(proposalRefName);
      if (branch.status !== 'success' || branch.ref.name === 'HEAD') {
        throw new Error('expected proposal branch ref before workspace commit');
      }
      if (branch.ref.commitId !== input.proposal.baseCommitId) {
        return proposalWorkspaceStaleHeadResult({
          operation: 'commitProposalWorkspace',
          proposalId: input.proposal.id,
          workspaceId: input.workspaceId,
          proposalBranchName: input.proposal.proposalBranchName,
          expectedWorkspaceHeadId: input.proposal.baseCommitId,
          actualProposalBranchHeadId: branch.ref.commitId,
        });
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
          proposalBranchName: input.proposal.proposalBranchName,
          committedFromHeadId: input.proposal.baseCommitId,
        },
      };
    },
  };
}
