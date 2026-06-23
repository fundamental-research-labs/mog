import {
  registerProposalWorkspaceAcceptanceScenarios,
  registerProposalWorkspaceCommitScenarios,
  registerProposalWorkspaceDiagnosticScenarios,
  registerProposalWorkspaceLookupScenarios,
} from './version-proposal-workspace-provider-scenarios';

describe('WorkbookVersion provider-backed proposal workspace lookup', () => {
  registerProposalWorkspaceLookupScenarios();
  registerProposalWorkspaceCommitScenarios();
  registerProposalWorkspaceDiagnosticScenarios();
  registerProposalWorkspaceAcceptanceScenarios();
});
