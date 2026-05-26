/**
 * Storage Subpath — `@mog-sdk/kernel/storage`
 *
 * Consolidates provider/persistence contracts that were previously spread
 * across `@mog-sdk/kernel/lifecycle` and `@mog-sdk/kernel/document`.
 *
 * Public surface:
 *   - Provider protocol types (Provider, ProviderDoc, attach/checkpoint modes)
 *   - IndexedDB provider + options
 *   - Meta API helpers (readMeta, touchDoc, forgetDoc, clearMeta, emptyMeta)
 *   - Meta state types (MetaState, RecentDoc)
 *
 * NOT exported here: RustDocument, lifecycle machines, StateMirror,
 * raw collab sidecars, createDocumentContext.
 */

// Provider protocol types
export type {
  DocumentByteSyncPort,
  Provider,
  ProviderDoc,
  ProviderAttachMode,
  ProviderAttachReturn,
  ProviderCheckpointMode,
  ProviderCheckpointReturn,
} from '../document/providers';

// IndexedDB provider
export { IndexedDBProvider, hasPersistedSnapshot } from '../document/providers';

export { installEvictionSink, type EvictionEvent } from '../context/bridge-devtools-wrapper';

export type { IndexedDBProviderOptions } from '../document/providers';

// Meta API helpers
export { readMeta, touchDoc, forgetDoc, clearMeta, emptyMeta } from '../document/providers';

// Meta state types
export type { MetaState, RecentDoc } from '../document/providers';
