import { normalizeVersionAccessContext } from './provider-access-context';
import {
  cloneVersionStoreCapabilities,
  readOnlyCapabilities,
  unavailableCapabilities,
} from './provider-capabilities';
import {
  IN_MEMORY_DURABLE_SNAPSHOT_VERSION_STORE_CAPABILITIES,
  IN_MEMORY_VERSION_STORE_CAPABILITIES,
} from './provider-in-memory-capabilities';
import { InMemoryVersionDocumentProviderBackend } from './provider-memory-backend';
import { normalizeVersionDocumentScope } from './registry';
import type {
  InMemoryVersionStoreProviderOptions,
  InMemoryVersionStoreProviderState,
} from './provider-in-memory-types';

export function createInMemoryVersionStoreProviderState(
  options: InMemoryVersionStoreProviderOptions,
): InMemoryVersionStoreProviderState {
  const documentScope = normalizeVersionDocumentScope(options.documentScope);
  const accessContext = normalizeVersionAccessContext(options.accessContext);
  const backend = options.backend ?? new InMemoryVersionDocumentProviderBackend();
  const mode = options.unavailable ? 'unavailable' : options.readOnly ? 'read-only' : 'read-write';
  const baseCapabilities =
    options.durability === 'snapshot-test-double'
      ? IN_MEMORY_DURABLE_SNAPSHOT_VERSION_STORE_CAPABILITIES
      : IN_MEMORY_VERSION_STORE_CAPABILITIES;
  const capabilities =
    mode === 'unavailable'
      ? unavailableCapabilities(baseCapabilities)
      : mode === 'read-only'
        ? readOnlyCapabilities(baseCapabilities)
        : cloneVersionStoreCapabilities(baseCapabilities);

  return {
    documentScope,
    accessContext,
    backend,
    mode,
    baseCapabilities,
    capabilities,
    lifecycleState: 'open',
  };
}
