/**
 * MogDocument — Public SDK lifecycle root.
 *
 * MogDocument wraps DocumentHandle to provide a clean public surface.
 * It is the canonical entry point for document-first SDK usage:
 *
 *   const document = await MogDocumentFactory.create({ documentId, storage });
 *   const workbook = await document.workbook();
 *   // ... use workbook ...
 *   await document.close();
 *
 * Design decision: MogDocument is a wrapper around DocumentHandle, not a
 * rename or additional interface on the handle. This allows the handle to
 * retain internal members while MogDocument exposes only public members.
 *
 * Ownership: A MogDocument owns exactly one public workbook facade.
 * document.workbook() returns that facade; repeated calls are referentially
 * stable. Closing either the document or its workbook closes the shared
 * lifecycle exactly once.
 */

import type { SheetId } from '../core';
import type { Workbook } from '../api';
import type { IMogSdkEventFacade } from './event-facade';
import type {
  IMogDocumentHistory,
  MogDocumentStatus,
  MogDocumentCheckpointResult,
  MogDocumentCloseResult,
  MogDocumentPersistenceState,
  MogAsyncDisposable,
  MogDisposable,
} from './lifecycle';
import type {
  MogSdkCollaborationProvider,
  MogSdkSecurityProvider,
  MogSdkStorageProvider,
  MogSdkWorkbookStateProvider,
} from './providers';
import type { IMogBatchable } from './transactions';
import type {
  MogImportResult,
  MogImportOptions,
  MogDocumentSource,
  MogCloseBehavior,
  MogExportOptions,
  MogExportResult,
} from './import-export';

// ---------------------------------------------------------------------------
// MogDocument interface
// ---------------------------------------------------------------------------

export interface MogDocument extends MogAsyncDisposable {
  // -- Identity -------------------------------------------------------------

  readonly documentId: string;
  readonly initialSheetId: SheetId;

  // -- Lifecycle state ------------------------------------------------------

  readonly status: MogDocumentStatus;
  readonly isDisposed: boolean;

  // -- Event facade (replaces raw IEventBus) --------------------------------

  readonly events: IMogSdkEventFacade;

  // -- History (replaces raw IUndoService) ----------------------------------

  readonly history: IMogDocumentHistory;

  // -- Persistence state ----------------------------------------------------

  readonly persistence: MogDocumentPersistenceState;

  // -- Workbook access ------------------------------------------------------

  /**
   * Returns the document-owned workbook facade.
   * Repeated calls return the same instance.
   * Disposing the document also disposes the workbook.
   */
  workbook(): Promise<Workbook>;

  /**
   * Returns the document-owned workbook with a custom state provider.
   * Host state/provider changes are applied through explicit methods
   * rather than creating independent workbook facades.
   */
  workbook(options: MogDocumentWorkbookOptions): Promise<Workbook>;

  // -- Storage attachment ---------------------------------------------------

  attachStorage(provider: MogSdkStorageProvider): Promise<void>;

  // -- Collaboration --------------------------------------------------------

  attachCollaboration(provider: MogSdkCollaborationProvider): Promise<MogCollaborationHandle>;

  // -- Close / dispose ------------------------------------------------------

  close(behavior?: MogCloseBehavior): Promise<MogDocumentCloseResult>;
  checkpoint(): Promise<MogDocumentCheckpointResult>;

  // -- Deferred hydration (import durability) -------------------------------

  awaitMaterialized(scope?: SheetId | 'allSheets'): Promise<void>;
}

// ---------------------------------------------------------------------------
// Workbook options for document-first construction
// ---------------------------------------------------------------------------

export interface MogDocumentWorkbookOptions {
  readonly stateProvider?: MogSdkWorkbookStateProvider;
  readonly readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Collaboration handle
// ---------------------------------------------------------------------------

export interface MogCollaborationHandle extends MogDisposable {
  detach(): Promise<void>;
}

// ---------------------------------------------------------------------------
// MogDocumentFactory — public creation API
// ---------------------------------------------------------------------------

export interface MogDocumentCreateOptions {
  readonly documentId?: string;
  readonly runtime?: { readonly kind: 'browser' | 'headless'; readonly userTimezone?: string };
  readonly storage?: MogSdkStorageProvider;
  readonly security?: MogSdkSecurityProvider;
}

export interface MogDocumentImportOptions extends MogDocumentCreateOptions {
  readonly source: MogDocumentSource;
  readonly importOptions?: MogImportOptions;
}

export interface IMogDocumentFactory {
  create(options?: MogDocumentCreateOptions): Promise<MogDocument>;
  open(options: MogDocumentImportOptions): Promise<MogDocumentOpenResult>;
}

export interface MogDocumentOpenResult {
  readonly document?: MogDocument;
  readonly importResult: MogImportResult;
}

// ---------------------------------------------------------------------------
// Zero-ceremony SDK entry point contract
// ---------------------------------------------------------------------------

/**
 * Zero-ceremony contract:
 *
 *   import { createWorkbook } from '@mog-sdk/node';
 *   const workbook = await createWorkbook();
 *   const sheet = workbook.activeSheet;
 *   await sheet.setCell('A1', 42);
 *   await workbook.close('skipSave');
 *
 * Creates and owns a document handle internally. Disposes all owned
 * kernel resources when workbook.dispose(), workbook.close(), or
 * await using runs.
 */
export interface MogCreateWorkbookOptions {
  readonly documentId?: string;
  readonly xlsx?: Uint8Array;
  readonly source?: MogDocumentSource;
  readonly importOptions?: MogImportOptions;
  readonly security?: MogSdkSecurityProvider;
  readonly userTimezone?: string;
  readonly writeFile?: (path: string, data: Uint8Array) => Promise<void>;
  readonly onSave?: (buffer: Uint8Array) => Promise<void>;
}
