import type { WorkbookCommitId } from '../../../document/version-store/object-digest';
import type { ProposalWorkspaceLifecycleService } from '../../../document/version-store/proposals/proposal-workspace-lifecycle-service';
import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import { DOCUMENT_SCOPE, type ProposalProvider } from './version-proposal-provider-fixtures';
import { commitInput, commitMain } from './version-proposal-provider-graph-fixtures';

export function graphCommittingWorkspaceService(
  provider: ProposalProvider,
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
      try {
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
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'target_unavailable',
            target: 'workbook.version.commitProposalWorkspace',
            diagnostics: [
              {
                code: 'TEST_WORKSPACE_COMMIT_FAILED',
                severity: 'error',
                message: error instanceof Error ? error.message : 'Workspace commit failed.',
              },
            ],
          },
        };
      }
    },
  };
}

export function misboundStartWorkspaceService(
  provider: ProposalProvider,
): ProposalWorkspaceLifecycleService {
  const base = graphCommittingWorkspaceService(provider);
  return {
    ...base,
    async startProposalWorkspace(input) {
      const started = await base.startProposalWorkspace(input);
      if (!started.ok) return started;
      return {
        ok: true,
        value: {
          ...started.value,
          proposalId: `${started.value.proposalId}:other` as never,
        },
      };
    },
  };
}

export function mismatchedCommitWorkspaceService(
  provider: ProposalProvider,
): ProposalWorkspaceLifecycleService {
  const base = graphCommittingWorkspaceService(provider);
  return {
    ...base,
    async commitProposalWorkspace(input) {
      const committed = await base.commitProposalWorkspace(input);
      if (!committed.ok) return committed;
      return {
        ok: true,
        value: {
          ...committed.value,
          workspaceId: `${committed.value.workspaceId}:other`,
        },
      };
    },
  };
}

export function wrongBranchCommittingWorkspaceService(
  provider: ProposalProvider,
  mainHeadCommitId: WorkbookCommitId,
): ProposalWorkspaceLifecycleService {
  return {
    ...graphCommittingWorkspaceService(provider),
    async commitProposalWorkspace(input) {
      const wrongBranchCommitId = await commitMain(provider, mainHeadCommitId);
      return {
        ok: true,
        value: {
          workspaceId: input.workspaceId,
          proposalCommitId: wrongBranchCommitId,
        },
      };
    },
  };
}
