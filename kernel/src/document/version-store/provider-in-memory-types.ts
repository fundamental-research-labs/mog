import type {
  InMemoryVersionDocumentProviderBackend,
  InMemoryVersionProviderDurability,
} from './provider-memory-backend';
import type {
  VersionAccessContext,
  VersionStoreCapabilities,
  VersionStoreLifecycleState,
} from './provider-types';
import type { VersionDocumentScope } from './registry';

export type InMemoryVersionStoreProviderOptions = {
  readonly documentScope: VersionDocumentScope;
  readonly accessContext?: VersionAccessContext;
  readonly backend?: InMemoryVersionDocumentProviderBackend;
  readonly durability?: InMemoryVersionProviderDurability;
  readonly readOnly?: boolean;
  readonly unavailable?: boolean;
};

export type InMemoryVersionStoreProviderMode = 'read-write' | 'read-only' | 'unavailable';

export type InMemoryVersionStoreProviderState = {
  readonly documentScope: VersionDocumentScope;
  readonly accessContext: VersionAccessContext;
  readonly backend: InMemoryVersionDocumentProviderBackend;
  readonly mode: InMemoryVersionStoreProviderMode;
  readonly baseCapabilities: VersionStoreCapabilities;
  readonly capabilities: VersionStoreCapabilities;
  lifecycleState: VersionStoreLifecycleState;
};
