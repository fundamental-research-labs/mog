import type { ProposalWorkspaceLifecycleService } from '../../../document/version-store/proposals/proposal-workspace-lifecycle-service';
import { workspaceLookupService } from './version-proposal-workspace-provider-fixtures-workspaces-lookup';

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
