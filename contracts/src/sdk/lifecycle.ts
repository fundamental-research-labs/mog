/**
 * Document and workbook lifecycle contracts.
 *
 * Disposal rules:
 * - document.close() / document.disposeAsync() are the canonical close paths.
 * - Closing either the document or its public workbook closes the shared lifecycle once.
 * - workbook.dispose() is a synchronous local-cleanup method only.
 * - Public examples prefer `await workbook.close()` or `await using`.
 */

// ---------------------------------------------------------------------------
// Document lifecycle state
// ---------------------------------------------------------------------------

export type MogDocumentStatus = 'creating' | 'ready' | 'saving' | 'closing' | 'closed' | 'error';

// ---------------------------------------------------------------------------
// Close/checkpoint results
// ---------------------------------------------------------------------------

export interface MogDocumentCloseResult {
  readonly status: 'closed' | 'closedWithWarnings' | 'closeFailed';
  readonly finalCheckpoint?: MogDocumentCheckpointResult;
  readonly detachedProviders: readonly string[];
  readonly errors: readonly MogDocumentLifecycleError[];
  readonly timestamp: number;
}

export interface MogDocumentCheckpointResult {
  readonly status: 'committed' | 'partial' | 'failed';
  readonly highWaterMark: {
    readonly mark: number;
    readonly capturedAt: number;
    readonly pendingMutationCount: number;
  };
  readonly providerResults: readonly MogProviderCheckpointStatus[];
  readonly timestamp: number;
}

export interface MogProviderCheckpointStatus {
  readonly providerId: string;
  readonly status: 'committed' | 'skipped' | 'failed';
  readonly error?: string;
}

export interface MogDocumentLifecycleError {
  readonly phase: string;
  readonly message: string;
  readonly providerId?: string;
}

// ---------------------------------------------------------------------------
// Undo/redo state
// ---------------------------------------------------------------------------

export interface MogUndoState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly nextUndoDescription?: string;
  readonly nextRedoDescription?: string;
}

// ---------------------------------------------------------------------------
// History facade
// ---------------------------------------------------------------------------

export interface IMogDocumentHistory {
  undo(): Promise<void>;
  redo(): Promise<void>;
  canUndo(): boolean;
  canRedo(): boolean;
  getState(): Promise<MogUndoState>;
  setNextDescription(description: string): void;
  subscribe(listener: (state: MogUndoState) => void): MogDisposable;
}

// ---------------------------------------------------------------------------
// Persistence state
// ---------------------------------------------------------------------------

export type MogDocumentDurabilityMode =
  | 'ephemeral'
  | 'durableLocal'
  | 'localFirst'
  | 'remoteBacked'
  | 'readOnly';

export interface MogDocumentPersistenceState {
  readonly mode: MogDocumentDurabilityMode;
  readonly readOnly: boolean;
  readonly pendingUpdatesCount: number;
  readonly lastCheckpointAt: number | null;
  readonly lastSyncAt: number | null;
}

// ---------------------------------------------------------------------------
// Generic disposable
// ---------------------------------------------------------------------------

export interface MogDisposable {
  dispose(): void;
}

export interface MogAsyncDisposable {
  disposeAsync(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
