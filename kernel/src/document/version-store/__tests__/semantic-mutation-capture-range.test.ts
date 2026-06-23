import { describeRangeClearScenarios } from './semantic-mutation-capture-range-clear-scenarios';
import { describeRangeReplaceAllScenarios } from './semantic-mutation-capture-range-replace-all-scenarios';

describe('semantic mutation capture range cell operations', () => {
  describeRangeClearScenarios();
  describeRangeReplaceAllScenarios();
});
