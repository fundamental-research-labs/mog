import { registerRefStoreTombstoneLifecycleScenarios } from './ref-store-tombstones-lifecycle-scenarios';
import { registerRefStoreTombstoneListingScenarios } from './ref-store-tombstones-listing-scenarios';
import { registerRefStoreTombstoneOrderingScenarios } from './ref-store-tombstones-ordering-scenarios';

describe('InMemoryRefStore tombstones', () => {
  registerRefStoreTombstoneLifecycleScenarios();
});

describe('InMemoryRefStore list filters and ordering', () => {
  registerRefStoreTombstoneListingScenarios();
});

describe('InMemoryRefStore tombstone ordering hardening', () => {
  registerRefStoreTombstoneOrderingScenarios();
});
