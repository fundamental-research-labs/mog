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
export {
  DEFAULT_PROVENANCE_REDACTION_POLICY,
  PROVIDER_AUTHORITY_CANONICAL_PAYLOAD_CANONICALIZATION,
  PROVIDER_AUTHORITY_CANONICAL_PAYLOAD_SCHEMA_VERSION,
  PROVIDER_AUTHORITY_PROOF_V2_SCHEMA_VERSION,
  PROVIDER_INBOUND_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_OPTIONAL_IDENTITY_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
  classifyLegacyProviderInboundUpdate,
  classifyLegacyRawUpdate,
  exportProviderInboundUpdateAdmissionEvidence,
  exportSyncUpdateProvenanceEvidence,
  isProviderAuthorityProofV2,
  isProviderInboundUpdateEnvelopeV2,
  requiredProviderInboundV2ProofFields,
  validateProviderInboundUpdateEnvelope,
  validateSyncUpdateProvenance,
} from './inbound-updates';

export type {
  ProviderAuthorityCanonicalPayloadHash,
  ProviderAuthorityCanonicalPayloadHashAlgorithm,
  ProviderAuthorityProof,
  ProviderAuthorityProofAlgorithm,
  ProviderAuthorityProofAudience,
  ProviderAuthorityProofAudienceKind,
  ProviderAuthorityProofBase,
  ProviderAuthorityProofKind,
  ProviderAuthorityProofSchemaVersion,
  ProviderAuthorityProofV1,
  ProviderAuthorityProofV2,
  ProviderInboundProofField,
  ProviderInboundUpdateDiagnosticEvidenceOptions,
  ProviderInboundUpdateEnvelope,
  ProviderInboundUpdateEnvelopeAny,
  ProviderInboundUpdateEnvelopeV2,
  ProviderInboundUpdateValidationOptions,
  ProviderInboundAssetDependency,
  LegacyProviderClassificationOptions,
  LegacyRawUpdateClassificationOptions,
  CollaborationHydrationSyncUpdateProvenance,
  CollaborationLiveRemoteSyncUpdateProvenance,
  CollaborationMixedRemoteSyncUpdateProvenance,
  ImportHydrationSyncUpdateProvenance,
  ProvenanceRedactionPolicy,
  ProviderLiveInboundSyncUpdateProvenance,
  ProviderMixedInboundSyncUpdateProvenance,
  ProviderReplaySyncUpdateProvenance,
  RedactedAgentRef,
  RedactedRemoteAuthorRef,
  SyncUpdateDiagnosticEvidence,
  SyncUpdateDiagnosticEvidenceAdmission,
  SyncUpdateDiagnosticEvidenceAuthor,
  SyncUpdateDiagnosticEvidenceCorrelation,
  SyncUpdateDiagnosticEvidenceDiagnostic,
  SyncUpdateDiagnosticEvidenceEnvelopeVersion,
  SyncUpdateDiagnosticEvidenceIdentity,
  SyncUpdateDiagnosticEvidenceRedaction,
  SyncUpdateDiagnosticEvidenceTrust,
  SyncUpdateAuthorState,
  SyncUpdateCapturePolicy,
  SyncUpdateExclusionDiagnostic,
  SyncUpdateExclusionReason,
  SyncUpdateIdentity,
  SyncUpdateOriginKind,
  SyncUpdateProvenance,
  SyncUpdateProvenanceBase,
  SyncUpdateSourceKind,
  SyncUpdateTrust,
  SyncUpdateTrustStatus,
  SyncUpdateValidationDiagnostic,
  SyncUpdateValidationReason,
  SyncUpdateValidationResult,
  SyncUpdateValidationSubreason,
  SystemRepairSyncUpdateProvenance,
  LegacyRawUnknownSyncUpdateProvenance,
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
