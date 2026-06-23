import { describe } from '@jest/globals';

import { describeMergeProviderAncestryScenarios } from './version-merge-provider-ancestry-scenarios';
import {
  describeMergeProviderConflictPassThroughScenarios,
  describeMergeProviderConflictValidationScenarios,
} from './version-merge-provider-conflict-scenarios';
import { describeMergeProviderDelegationScenarios } from './version-merge-provider-delegation-scenarios';
import { describeMergeProviderMetadataScenarios } from './version-merge-provider-metadata-scenarios';
import { describeMergeProviderAvailabilityScenarios } from './version-merge-provider-availability-scenarios';

describe('WorkbookVersion merge facade', () => {
  describeMergeProviderDelegationScenarios();
  describeMergeProviderMetadataScenarios();
  describeMergeProviderConflictPassThroughScenarios();
  describeMergeProviderAncestryScenarios();
  describeMergeProviderConflictValidationScenarios();
  describeMergeProviderAvailabilityScenarios();
});
