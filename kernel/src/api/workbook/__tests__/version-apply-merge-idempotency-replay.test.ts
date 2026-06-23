import { registerReplayDifferentPayloadScenarios } from './version-apply-merge-idempotency-replay-different-payload-scenarios';
import { registerReplaySuccessfulApplyScenarios } from './version-apply-merge-idempotency-replay-successful-apply-scenarios';

describe('WorkbookVersion public applyMerge idempotency replay', () => {
  registerReplaySuccessfulApplyScenarios();
  registerReplayDifferentPayloadScenarios();
});
