/**
 * @mog-sdk/contracts/sdk — Public SDK contract types.
 *
 * These types define the stable public API for the Mog kernel SDK.
 * They are type-only (no runtime code) and must not import kernel,
 * transport, runtime, shell, views, React, or app packages.
 */

// MogDocument and factory
export type {
  MogDocument,
  MogDocumentWorkbookOptions,
  MogCollaborationHandle,
  MogDocumentCreateOptions,
  MogDocumentImportOptions,
  IMogDocumentFactory,
  MogDocumentOpenResult,
  MogCreateWorkbookOptions,
} from './mog-document';

// Errors
export type {
  MogSdkErrorCode,
  MogSdkDiagnostics,
  MogSdkErrorJSON,
  IMogSdkError,
  KernelToSdkErrorMapping,
} from './mog-sdk-error';

// Events
export type {
  MogSdkEvent,
  MogSdkEventType,
  MogSdkEventOrigin,
  MogSdkEventScope,
  MogSdkEventPayloads,
  TypedMogSdkEvent,
} from './mog-sdk-event';

// Event facade
export type { IMogSdkEventFacade, MogSdkSubscription } from './event-facade';

// Providers
export type {
  MogSdkRuntimeProvider,
  MogSdkStorageProvider,
  MogSdkProviderDoc,
  MogSdkProviderAttachResult,
  MogSdkProviderCheckpointResult,
  MogSdkWorkbookStateProvider,
  MogSdkSecurityProvider,
  MogSdkAccessPrincipal,
  MogSdkCollaborationProvider,
  MogSdkProviderOwnership,
} from './providers';

// Lifecycle
export type {
  MogDocumentStatus,
  MogDocumentCloseResult,
  MogDocumentCheckpointResult,
  MogProviderCheckpointStatus,
  MogDocumentLifecycleError,
  MogUndoState,
  IMogDocumentHistory,
  MogDocumentDurabilityMode,
  MogDocumentPersistenceState,
  MogDisposable,
  MogAsyncDisposable,
} from './lifecycle';

// Transactions
export type {
  MogBatchOptions,
  IMogBatchable,
  MogTransactionOptions,
  IMogTransactable,
  MogMutationReceipt,
} from './transactions';

// Import/export
export type {
  MogDocumentSource,
  MogFileFormat,
  MogSnapshot,
  MogUpdateLog,
  MogImportOptions,
  MogCsvImportOptions,
  MogImportProgress,
  MogImportResult,
  MogImportWarning,
  MogImportWarningType,
  MogImportMetrics,
  MogImportError,
  MogExportOptions,
  MogExportProgress,
  MogExportResult,
  MogExportWarning,
  MogExportError,
  MogSaveMode,
  MogCloseBehavior,
} from './import-export';
