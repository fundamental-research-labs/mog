import { registerProposalBranchStaleScenarios } from './version-proposal-accept-provider-stale-proposal-branch-scenarios';
import { registerTargetHeadCapabilityScenarios } from './version-proposal-accept-provider-stale-target-head-capability-scenarios';
import { registerTargetHeadNoWriteScenarios } from './version-proposal-accept-provider-stale-target-head-no-write-scenarios';
import { registerTargetHeadStaleScenarios } from './version-proposal-accept-provider-stale-target-head-scenarios';

describe('WorkbookVersion provider-backed proposal accept stale handling', () => {
  registerTargetHeadStaleScenarios();
  registerTargetHeadNoWriteScenarios();
  registerTargetHeadCapabilityScenarios();
  registerProposalBranchStaleScenarios();
});
