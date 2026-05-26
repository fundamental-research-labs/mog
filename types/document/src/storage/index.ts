/**
 * Storage Contracts
 *
 * Contracts for table data storage drivers and document storage providers.
 *
 */

// Query contract
export type {
  ArrayFilterCondition,
  FilterCondition,
  FilterGroup,
  FilterOperator,
  FilterScalar,
  NullFilterCondition,
  ScalarFilterCondition,
  StringFilterCondition,
  Query,
  SortSpec,
} from './query';

// Capabilities
export type { TableDriverCapabilities } from './capabilities';

// Connection types
export type {
  BaseConnectionConfig,
  ConnectionConfig,
  ConnectionStatus,
  DriverType,
  GraphQLConnectionConfig,
  LocalConnectionConfig,
  MySQLConnectionConfig,
  PostgresConnectionConfig,
  RefreshBehavior,
  RestConnectionConfig,
  RowId,
  SQLiteConnectionConfig,
  SourceConfig,
  TableBinding,
  TableId,
} from './connection';

// Table driver interface
export type {
  ColumnSchema,
  ColumnType,
  DriverError,
  ITableDriver,
  PingResult,
  RecordData,
  TableChange,
  TableRecord,
  TableSchema,
  Unsubscribe,
} from './table-driver';

// --- Document storage provider types ---

// Core enums and config
export type {
  DocumentOpenIntent,
  DocumentDurabilityMode,
  StorageProviderKind,
  StorageProviderRole,
  DocumentStorageConfig,
} from './document-provider';

// Provider identity and scope
export type {
  StorageScope,
  StorageScopeBinding,
  StorageProviderIdentity,
} from './provider-identity';

// Provider capabilities
export type { StorageProviderCapabilities } from './provider-capabilities';

// Per-provider configs (discriminated union)
export type {
  StorageProviderConfigBase,
  StorageProviderConfig,
  MemoryProviderConfig,
  IndexedDbProviderConfig,
  FilesystemProviderConfig,
  TauriSidecarProviderConfig,
  RemoteApiProviderConfig,
  ObjectStoreProviderConfig,
  DatabaseLogProviderConfig,
  HostCallbackProviderConfig,
  ReadOnlySnapshotProviderConfig,
  RedactedPublishedSnapshotProviderConfig,
  TestProviderConfig,
} from './provider-configs';

// Lifecycle types
export type {
  DocumentStoragePhase,
  DocumentStorageState,
  DegradedProviderInfo,
  StorageLifecycleError,
  StorageLifecycleTransition,
  StorageHighWaterMark,
  ImportDurabilityResult,
  ProviderCheckpointStatus,
  CheckpointResult,
  CloseResult,
} from './lifecycle';

// Inbound update types
export type {
  ProviderAuthorityProof,
  ProviderInboundProofField,
  ProviderInboundUpdateEnvelope,
  ProviderInboundAssetDependency,
} from './inbound-updates';

// High-water mark types
export type {
  InboundBarrierProof,
  ProviderOriginWatermark,
  ProviderBarrierReceipt,
  HighWaterAssetStateProof,
  AssetProviderCursor,
  HighWaterMarkSnapshot,
  HighWaterMarkProof,
  HighWaterMarkProofRequest,
  ProofValidationError,
  ProofValidationResult,
} from './high-water-mark';

// Error types
export type {
  StorageErrorCategory,
  StorageErrorSeverity,
  StorageErrorBase,
  StorageError,
  StorageAuthorizationError,
  StorageConfigurationError,
  StorageLockError,
  StorageDurabilityError,
  StorageReplayError,
  StorageSyncError,
  StorageQuotaError,
  StoragePolicyError,
  StorageImplementationError,
} from './errors';

// Runtime profile types
export type { StorageRuntimeProfile, StorageRuntimeProfileDescriptor } from './profiles';

// Composition validation types
export type {
  ProviderRoleConstraint,
  DurabilityRequirement,
  ProviderKindRoleCompatibility,
  CompositionViolation,
  CompositionValidationResult,
  CompositionRuleSet,
} from './composition';
