/**
 * Kernel Services
 *
 * System services that are cross-app (survive app switches).
 *
 * Lifecycle:
 * - Per-document services (created by DocumentFactory, disposed with document):
 *   Clipboard, Undo, Checkpoint, Notifications, QueryExecutor, Filesystem
 * - Global singletons (one instance for the kernel lifetime):
 *   TableRegistry (getTableRegistry/resetTableRegistry)
 * - Stateless (pure functions, no lifecycle):
 *   Protection
 *
 * Convention:
 * - Services are obtained via factory functions (createXxxService), never direct construction
 * - All stateful services implement IDisposable
 * - Observable services extend Subscribable<T> or TypedEventEmitter<TEventMap>
 * - Fallible operations return Result<T, E> — never throw, never return bare boolean
 * - Subscriptions return IDisposable — composable with DisposableStore.track()
 */

// =============================================================================
// Clipboard Service
// =============================================================================

export {
  clipboardServiceMachine,
  createClipboardService,
  getClipboardServiceSnapshot,
} from './clipboard';

export type {
  ClipboardContext,
  ClipboardEvent,
  ClipboardOperation,
  ClipboardPayload,
  ClipboardServiceActor,
  ClipboardServiceMachine,
  ClipboardServiceState,
  ClipboardSnapshot,
  ClipboardState,
  IClipboardService,
} from './clipboard';

// =============================================================================
// Undo Service
// =============================================================================

export { createUndoService } from './undo';
export type { IUndoService, UndoServiceState, UndoStackItem, UndoStateChangeEvent } from './undo';

// =============================================================================
// Checkpoint Service
// =============================================================================

export { createCheckpointManager } from './checkpoint';
export type {
  Checkpoint,
  CreateCheckpointOptions,
  ICheckpointManager,
  RestoreCheckpointOptions,
} from './checkpoint';

// =============================================================================
// Notifications Service
// =============================================================================

export { createNotificationsService } from './notifications';
export type {
  INotificationsService,
  Notification,
  NotificationOptions,
  NotificationType,
  NotificationsState,
} from './notifications';

// =============================================================================
// Workbook Links
// =============================================================================

export {
  ExternalLinkWatchRegistry,
  WorkbookLinkService,
  createWorkbookLinkService,
} from './workbook-links';
export type {
  AuthorizedMaterializedCacheMetadata,
  CreateWorkbookLinkInput,
  CopyWorkbookLinkSourceResult,
  DisposableWatchHandle,
  DocumentId,
  ImportedExternalLinkIdentity,
  LinkId,
  LinkStatus,
  LinkStatusReason,
  LinkStatusView,
  LocateTarget,
  PersistedLinkTarget,
  PersistedWorkbookLinkRecord,
  ResolvedWorkbookLink,
  RuntimeLinkStatus,
  UpdateWorkbookLinkInput,
  UsageKind,
  WorkbookExternalLinkUsageView,
  WorkbookExternalPackageArtifactView,
  WorkbookId,
  WorkbookLinkView,
  WorkbookLinkResolver,
  WorkbookLinksAPI,
  WorkbookLinkStatusScope,
  WorkbookSessionId,
} from './workbook-links';

// =============================================================================
// Capability Registry Service
// =============================================================================

export {
  // Audit Logger
  CapabilityAuditLogger,
  CloudGrantsStore,
  // Stores
  MemoryGrantsStore,
  SQLiteGrantsStore,
  // Vector clock utilities
  compareVectorClocks,
  createCapabilityAuditLogger,
  createCapabilityRegistry,
  createCloudGrantsStore,
  createMemoryGrantsStore,
  createSQLiteGrantsStore,
  incrementVectorClock,
  mergeVectorClocks,
} from './capabilities';

export type {
  // Audit types
  AuditEventType,
  AuditLoggerOptions,
  CapabilityAuditEntry,
  // Registry (type-only — use createCapabilityRegistry factory for instances)
  CapabilityRegistry,
  CloudGrant,
  CloudStoreOptions,
  ICapabilityAuditLog,
  ISQLiteDatabase,
  RegistryEvent,
  RegistryEventHandler,
  // Registry event types
  RegistryEventType,
  // Store options
  SQLiteStoreOptions,
  // Vector clock types
  VectorClock,
  VectorClockComparison,
} from './capabilities';

// =============================================================================
// Query Executor Service
// =============================================================================

export { createQueryExecutor } from './query-executor';

export type {
  ConnectionConfig,
  DatabaseType,
  IConnectionResolver,
  IQueryExecutor,
  QueryCacheEntry,
  QueryCompleteCallback,
  QueryCompleteEvent,
  QueryError,
  QueryErrorType,
  QueryResult,
} from './query-executor';

// =============================================================================
// Table Registry Service
// =============================================================================

export { getTableRegistry, resetTableRegistry } from './table-registry';

export type { ITableRegistry, TableRegistryEvent, TableRegistryEvents } from './table-registry';

// =============================================================================
// Filesystem Service
// =============================================================================

export { createAppFileSystem, createFilesystemService } from './filesystem';

export { PathEscapeError, PermissionDeniedError } from './filesystem';

export type {
  IFileSystem,
  IFilesystemService,
  FileEntry,
  FileStat,
  WatchEvent,
  WatchCallback,
  WatchCreateEvent,
  WatchDeleteEvent,
  WatchModifyEvent,
  WatchRenameEvent,
  DeleteOptions,
  MkdirOptions,
  RmdirOptions,
  Unsubscribe,
} from './filesystem/types';

export {
  DirectoryExistsError,
  DirectoryNotEmptyError,
  DirectoryNotFoundError,
  FileExistsError,
  FileNotFoundError,
  FileSystemError,
  IsDirectoryError,
  NotDirectoryError,
} from './filesystem/types';

export type { AnyPath, FilePath, DirPath } from './filesystem/paths';

export {
  changeExtension,
  dirPath,
  filePath,
  getBasename,
  getDirname,
  getExtension,
  getStem,
  isAbsolute,
  isRelative,
  isUnder,
  joinPath,
  normalizePath,
  pathsEqual,
  relativePath,
  resolvePath,
} from './filesystem/paths';

export type { AccessLevel, AppId, FilePermission, SandboxConfig } from './filesystem/permissions';

export {
  addPermission,
  appId,
  createPermission,
  createSandboxConfig,
  InvalidAppIdError,
  isOperationAllowed,
  isPathInSandbox,
  isPermissionExpired,
  isValidAppId,
  permissionGrantsAccess,
  pruneExpiredPermissions,
  removePermission,
  resolveSandboxPath,
} from './filesystem/permissions';

// =============================================================================
// Protection (pure functions — no class, no lifecycle)
// =============================================================================

// TODO: hashExcelPassword/verifyExcelPassword belong in xlsx/bridge/.
// successResult/protectionError/etc. should live next to MutationResult.
// Deferred until XLSX package structure is finalized.

export {
  hashExcelPassword,
  verifyExcelPassword,
  successResult,
  protectionError,
  invalidRangeError,
  sheetNotFoundError,
} from './protection';

// =============================================================================
// Primitives (re-exported for convenience)
// =============================================================================

export type { IDisposable, Result, Listener } from './primitives';
export {
  DisposableBase,
  DisposableStore,
  DisposableGroup,
  MutableDisposable,
  DisposableNone,
  toDisposable,
  ok,
  err,
  Subscribable,
  TypedEventEmitter,
} from './primitives';
