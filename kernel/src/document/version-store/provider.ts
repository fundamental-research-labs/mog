export {
  VERSION_GRAPH_REGISTRY_CHECKSUM_DOMAIN,
  VERSION_GRAPH_REGISTRY_SCHEMA_VERSION,
  createVersionGraphRegistry,
  namespaceForDocumentScope,
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
} from './registry';
export type { VersionDocumentScope, VersionGraphRegistry, VersionRecordRevision } from './registry';
export {
  InMemoryVersionDocumentProviderBackend,
  type InMemoryVersionDocumentProviderBackendSnapshot,
} from './provider-memory-backend';
export type { VersionGraphStore } from './provider-graph-store';
export type {
  VersionAccessContext,
  VersionDiagnosticMessageId,
  VersionDocumentIntegrityScanOptions,
  VersionGraphInitializeInput,
  VersionGraphInitializeResult,
  VersionGraphRegistryReadResult,
  VersionIntegrityReport,
  VersionStoreCapabilities,
  VersionStoreCloseReason,
  VersionStoreDiagnostic,
  VersionStoreDiagnosticCode,
  VersionStoreFailure,
  VersionStoreLifecycleState,
  VersionStoreMutationGuarantee,
  VersionStoreOperation,
  VersionStoreProvider,
} from './provider-types';
export { cloneVersionStoreCapabilities } from './provider-capabilities';
export { mapGraphDiagnostics, versionStoreDiagnostic } from './provider-diagnostics';
export { failedStoreResult } from './provider-results';
export { VersionStoreProviderError } from './provider-error';
export {
  IN_MEMORY_DURABLE_SNAPSHOT_VERSION_STORE_CAPABILITIES,
  IN_MEMORY_VERSION_STORE_CAPABILITIES,
} from './provider-in-memory-capabilities';
export {
  InMemoryVersionStoreProvider,
  createInMemoryVersionStoreProvider,
  type InMemoryVersionStoreProviderOptions,
} from './provider-in-memory';
