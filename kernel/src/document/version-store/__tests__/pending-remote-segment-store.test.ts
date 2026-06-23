import 'fake-indexeddb/auto';

import { registerPendingRemoteSegmentStoreCoreDurabilityScenarios } from './pending-remote-segment-store-core-durability-scenarios';
import { registerPendingRemoteSegmentStoreCoreIdentityScenarios } from './pending-remote-segment-store-core-identity-scenarios';
import { registerPendingRemoteSegmentStoreCoreKeyValidationScenarios } from './pending-remote-segment-store-core-key-validation-scenarios';
import { registerPendingRemoteSegmentStoreCoreListingScenarios } from './pending-remote-segment-store-core-listing-scenarios';
import { installPendingRemoteSegmentStoreCoreCleanup } from './pending-remote-segment-store-core-test-helpers';

installPendingRemoteSegmentStoreCoreCleanup();

describe('pending remote segment store', () => {
  registerPendingRemoteSegmentStoreCoreIdentityScenarios();
  registerPendingRemoteSegmentStoreCoreKeyValidationScenarios();
  registerPendingRemoteSegmentStoreCoreListingScenarios();
  registerPendingRemoteSegmentStoreCoreDurabilityScenarios();
});
