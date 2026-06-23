import { registerProposalLifecycleTests } from './proposal-store-lifecycle-scenarios';
import { registerProposalListingTests } from './proposal-store-listing-scenarios';
import { registerProposalTerminalStateTests } from './proposal-store-terminal-state-scenarios';

describe('AgentProposalMetadataStore', () => {
  registerProposalLifecycleTests();
  registerProposalListingTests();
  registerProposalTerminalStateTests();
});
