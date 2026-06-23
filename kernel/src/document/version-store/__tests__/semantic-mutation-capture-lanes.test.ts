import { describeCollaborationPolicyLaneScenarios } from './semantic-mutation-capture-lanes-collaboration-policy-scenarios';
import { describePendingRemoteLaneScenarios } from './semantic-mutation-capture-lanes-pending-remote-scenarios';

describe('semantic mutation capture lanes', () => {
  describePendingRemoteLaneScenarios();
  describeCollaborationPolicyLaneScenarios();
});
