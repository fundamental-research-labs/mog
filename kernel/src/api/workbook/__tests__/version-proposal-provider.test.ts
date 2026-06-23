import { registerProposalProviderAcceptanceScenarios } from './version-proposal-provider-acceptance-scenarios';
import { registerProposalProviderCreationScenarios } from './version-proposal-provider-creation-scenarios';
import { registerProposalProviderWorkspaceScenarios } from './version-proposal-provider-workspace-scenarios';

describe('WorkbookVersion provider-backed proposal service', () => {
  registerProposalProviderCreationScenarios();
  registerProposalProviderWorkspaceScenarios();
  registerProposalProviderAcceptanceScenarios();
});
