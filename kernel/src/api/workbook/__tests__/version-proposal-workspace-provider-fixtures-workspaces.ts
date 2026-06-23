import type { AgentProposalWorkspaceHandle } from '@mog-sdk/contracts/api';

import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import {
  proposalWorkspaceStaleHeadResult,
  type ProposalWorkspaceLifecycleService,
} from '../../../document/version-store/proposal-workspace-lifecycle-service';
import {
  DOCUMENT_SCOPE,
  type InMemoryVersionStoreProvider,
} from './version-proposal-workspace-provider-fixtures-core';
import { commitInput } from './version-proposal-workspace-provider-fixtures-graph';

export function workspaceLookupService(): ProposalWorkspaceLifecycleService {
  const handles = new Map<string, AgentProposalWorkspaceHandle>();
  return {
    async startProposalWorkspace(input) {
      const handle: AgentProposalWorkspaceHandle = {
        workspaceId: `workspace:${input.proposal.id}`,
        proposalId: input.proposal.id,
        proposalBranchName: input.proposal.proposalBranchName,
        baseCommitId: input.proposal.baseCommitId,
        providerIdentity: 'in-memory-test-provider',
        workbookSessionId: `session:${input.proposal.id}`,
      };
      handles.set(handle.workspaceId, handle);
      return { ok: true, value: handle };
    },
    async getProposalWorkspace(input) {
      const handle = handles.get(input.workspaceId);
      return handle
        ? ({ ok: true, value: handle } as const)
        : ({
            ok: false,
            error: {
              code: 'target_unavailable',
              target: 'workbook.version.getProposalWorkspace',
              diagnostics: [
                {
                  code: 'TEST_WORKSPACE_NOT_FOUND',
                  severity: 'error',
                  message: 'Workspace handle was not found.',
                },
              ],
            },
          } as const);
    },
    async disposeProposalWorkspace(input) {
      handles.delete(input.workspaceId);
      return { ok: true, value: { disposed: true } };
    },
    async commitProposalWorkspace() {
      return {
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.commitProposalWorkspace',
          diagnostics: [
            {
              code: 'TEST_COMMIT_UNAVAILABLE',
              severity: 'error',
              message: 'This test service only supports lookup and disposal.',
            },
          ],
        },
      };
    },
  };
}

export function misboundLookupService(): ProposalWorkspaceLifecycleService {
  const base = workspaceLookupService();
  return {
    ...base,
    async getProposalWorkspace(input) {
      const workspace = await base.getProposalWorkspace(input);
      if (!workspace.ok) return workspace;
      return {
        ok: true,
        value: {
          ...workspace.value,
          proposalBranchName: `${workspace.value.proposalBranchName}-other` as never,
        },
      };
    },
  };
}

export function misbasedLookupService(): ProposalWorkspaceLifecycleService {
  const base = workspaceLookupService();
  return {
    ...base,
    async getProposalWorkspace(input) {
      const workspace = await base.getProposalWorkspace(input);
      if (!workspace.ok) return workspace;
      return {
        ok: true,
        value: {
          ...workspace.value,
          baseCommitId: `commit:sha256:${'f'.repeat(64)}` as never,
        },
      };
    },
  };
}

export function unsafeStartDiagnosticWorkspaceService(): ProposalWorkspaceLifecycleService {
  return {
    ...workspaceLookupService(),
    async startProposalWorkspace() {
      return {
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.startProposalWorkspace',
          diagnostics: [
            {
              code: 'TEST_UNSAFE_WORKSPACE_DIAGNOSTIC',
              severity: 'error',
              message: 'Workspace denied principal-secret for agent-run-1.',
              data: {
                principalId: 'principal-secret',
                agentRunId: 'agent-run-1',
                safeWorkspaceId: 'workspace:redaction',
                workspaceId: 'workspace-secret',
                providerId: 'provider-secret',
                providerIdentity: 'provider-secret-identity',
                safeNote: 'agent-run-1',
                safeTokens: ['principal-secret', 'agent-run-1'],
                workspace: {
                  workspaceId: 'workspace-secret',
                  principalScope: 'principal-secret',
                },
                nested: {
                  actorId: 'actor-secret',
                  safeStatus: 'kept',
                  safeNote: 'agent-run-1',
                },
              },
            },
          ],
        },
      };
    },
  };
}

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
