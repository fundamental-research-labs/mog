/**
 * Storage Contracts
 *
 * Contracts for table data storage drivers.
 * Supports local (Yjs) and external (Postgres, REST, etc.) data sources.
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

export type {
  DatabaseLogProviderConfig,
  FilesystemProviderConfig,
  HostCallbackProviderConfig,
  IndexedDbProviderConfig,
  MemoryProviderConfig,
  ObjectStoreProviderConfig,
  ReadOnlySnapshotProviderConfig,
  RedactedPublishedSnapshotProviderConfig,
  RemoteApiProviderConfig,
  StorageProviderConfig,
  StorageProviderConfigBase,
  TauriSidecarProviderConfig,
  TestProviderConfig,
} from './provider-configs';

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

// High-water-mark proof types
export type {
  HighWaterMarkSnapshot,
  HighWaterMarkProof,
  HighWaterMarkProofRequest,
  ProofValidationError,
  ProofValidationResult,
} from './high-water-mark';
