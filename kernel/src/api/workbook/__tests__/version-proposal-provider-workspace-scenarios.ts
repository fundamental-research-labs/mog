import { registerProposalProviderWorkspaceBranchHeadGuardScenarios } from './version-proposal-provider-workspace-branch-head-guard-scenarios';
import { registerProposalProviderWorkspaceCommitResultGuardScenarios } from './version-proposal-provider-workspace-commit-result-guard-scenarios';
import { registerProposalProviderWorkspaceIdGuardScenarios } from './version-proposal-provider-workspace-id-guard-scenarios';
import { registerProposalProviderWorkspaceLifecycleScenarios } from './version-proposal-provider-workspace-lifecycle-scenarios';
import { registerProposalProviderWorkspaceStartBindingScenarios } from './version-proposal-provider-workspace-start-binding-scenarios';

export { registerProposalProviderWorkspaceBranchHeadGuardScenarios } from './version-proposal-provider-workspace-branch-head-guard-scenarios';
export { registerProposalProviderWorkspaceCommitResultGuardScenarios } from './version-proposal-provider-workspace-commit-result-guard-scenarios';
export { registerProposalProviderWorkspaceIdGuardScenarios } from './version-proposal-provider-workspace-id-guard-scenarios';
export { registerProposalProviderWorkspaceLifecycleScenarios } from './version-proposal-provider-workspace-lifecycle-scenarios';
export { registerProposalProviderWorkspaceStartBindingScenarios } from './version-proposal-provider-workspace-start-binding-scenarios';

export function registerProposalProviderWorkspaceScenarios(): void {
  registerProposalProviderWorkspaceLifecycleScenarios();
  registerProposalProviderWorkspaceStartBindingScenarios();
  registerProposalProviderWorkspaceIdGuardScenarios();
  registerProposalProviderWorkspaceCommitResultGuardScenarios();
  registerProposalProviderWorkspaceBranchHeadGuardScenarios();
}
