import { describeRangeClearScenarios } from './semantic-mutation-capture-range-clear-scenarios';
import { describeRangeCopyRelocateScenarios } from './semantic-mutation-capture-range-copy-relocate-scenarios';
import { describeRangeReplaceAllScenarios } from './semantic-mutation-capture-range-replace-all-scenarios';

describe('semantic mutation capture range cell operations', () => {
  describeRangeClearScenarios();
  describeRangeCopyRelocateScenarios();
  describeRangeReplaceAllScenarios();
});
