/**
 * InMemoryProvider × conformance suite.
 *
 * The reference Provider must pass every conformance row — if it fails,
 * the conformance suite is buggy, not the InMemoryProvider. This test
 * file proves the suite is green-able and forms the seed for the
 * "Provider conformance — fresh in-memory Provider" scenario.
 *
 */

import { runProviderConformance } from './conformance';
import { InMemoryProvider, type InMemoryProviderStorage } from './in-memory-provider';
import { buildMockProviderDoc } from './mock-provider-doc';

// Suite-scoped storage Map. Two sessions in the same test share it (so
// row #2 / row #3's "session1 writes, session2 reattaches and sees the
// bytes" works); `resetStorage` swaps in a fresh Map between tests so no
// rows leak.
//
// The InMemoryProvider's docId-keyed storage is independent of the
// ProviderDoc's docId — the conformance suite's per-row `buildProviderDoc`
// IDs are only used by the doc, not the Provider. Both sessions in one
// test construct InMemoryProviders with the same fixed docId via the
// factory closure, so they read/write the same Map slot.
const PROVIDER_STORAGE_KEY = 'in-memory-provider-conformance';

let storage: InMemoryProviderStorage = new Map();

runProviderConformance({
  name: 'InMemoryProvider',
  factory: () => new InMemoryProvider(PROVIDER_STORAGE_KEY, { storage }),
  buildProviderDoc: buildMockProviderDoc,
  resetStorage: () => {
    storage = new Map();
  },
  factoryWithFailingFlushSync: () =>
    new InMemoryProvider(PROVIDER_STORAGE_KEY, {
      storage,
      failFlushSync: () => true,
    }),
});
