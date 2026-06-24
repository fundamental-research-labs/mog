import type { AgentProposalWorkspaceHandle } from '@mog-sdk/contracts/api';

import type { ProposalWorkspaceLifecycleService } from '../../../document/version-store/proposals/proposal-workspace-lifecycle-service';

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
