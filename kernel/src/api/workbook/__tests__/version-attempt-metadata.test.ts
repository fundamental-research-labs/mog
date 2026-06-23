import { describe } from '@jest/globals';

import {
  registerApplyMetadataNormalizationScenario,
  registerMergeMetadataDigestClosureRejectionScenario,
  registerMergeMetadataNormalizationScenario,
  registerMergeMetadataShapeRejectionScenario,
} from './version-attempt-metadata-scenarios';

describe('version attempt metadata normalization', () => {
  registerMergeMetadataNormalizationScenario();
  registerMergeMetadataShapeRejectionScenario();
  registerMergeMetadataDigestClosureRejectionScenario();
  registerApplyMetadataNormalizationScenario();
});
