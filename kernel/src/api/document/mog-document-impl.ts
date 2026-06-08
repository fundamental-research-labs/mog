/**
 * MogDocumentImpl — Public SDK wrapper around DocumentHandle.
 *
 * This class wraps the internal DocumentHandle to expose only the
 * public MogDocument interface. Internal members (context, trap
 * recovery, raw eventBus) are never surfaced.
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';
import type {
  MogDocument,
  MogDocumentWorkbookOptions,
  MogCollaborationHandle,
  MogSdkCollaborationProvider,
  MogCloseBehavior,
} from '@mog-sdk/contracts/sdk';
import type {
  MogDocumentStatus,
  MogDocumentCheckpointResult,
  MogDocumentCloseResult,
  MogDocumentPersistenceState,
  MogDocumentDurabilityMode,
  IMogDocumentHistory,
  MogUndoState,
  MogDisposable,
} from '@mog-sdk/contracts/sdk';
import type { IMogSdkEventFacade } from '@mog-sdk/contracts/sdk';
import type { MogSdkStorageProvider } from '@mog-sdk/contracts/sdk';
import type { IUndoService } from '@mog-sdk/contracts/services';
import type { DocumentStoragePhase } from '@mog-sdk/types-document/storage/lifecycle';

import type { DocumentHandle } from './document-factory';
import { MogSdkEventFacade } from './mog-sdk-event-facade';
import { CollaborationFirstJoinRequiresHostBootstrapError } from '../../errors/document';
import { MogSdkError } from '../../errors/mog-sdk-error';

// =============================================================================
// Phase → MogDocumentStatus mapping
// =============================================================================

function mapPhaseToStatus(phase: DocumentStoragePhase): MogDocumentStatus {
  switch (phase) {
    case 'idle':
    case 'validatingStorageHandoff':
    case 'selectingProviders':
    case 'preflightingProviders':
    case 'creatingEngine':
    case 'wiringContext':
    case 'startingBridge':
    case 'installingWriteGate':
    case 'hydratingImport':
    case 'attachingProviders':
    case 'replayingProviderState':
    case 'establishingDurability':
      return 'creating';

    case 'readyReadWrite':
    case 'readyReadOnly':
    case 'readyEphemeral':
      return 'ready';

    case 'checkpointing':
    case 'syncing':
      return 'saving';

    case 'closing':
    case 'destroying':
      return 'closing';

    case 'closed':
    case 'destroyed':
      return 'closed';

    case 'error':
      return 'error';
  }
}

// =============================================================================
// History facade (wraps IUndoService)
// =============================================================================

class MogDocumentHistoryImpl implements IMogDocumentHistory {
  constructor(private readonly _undoService: IUndoService | undefined) {}

  async undo(): Promise<void> {
    if (!this._undoService) return;
    await this._undoService.undo();
  }

  async redo(): Promise<void> {
    if (!this._undoService) return;
    await this._undoService.redo();
  }

  canUndo(): boolean {
    return this._undoService?.canUndo() ?? false;
  }

  canRedo(): boolean {
    return this._undoService?.canRedo() ?? false;
  }

  async getState(): Promise<MogUndoState> {
    if (!this._undoService) {
      return {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      };
    }
    const state = this._undoService.getState();
    return {
      canUndo: state.canUndo,
      canRedo: state.canRedo,
      undoDepth: state.undoStackSize,
      redoDepth: state.redoStackSize,
      nextUndoDescription: state.nextUndoDescription ?? undefined,
      nextRedoDescription: state.nextRedoDescription ?? undefined,
    };
  }

  setNextDescription(description: string): void {
    this._undoService?.setNextDescription(description);
  }

  subscribe(listener: (state: MogUndoState) => void): MogDisposable {
    if (!this._undoService) {
      return { dispose() {} };
    }
    const sub = this._undoService.subscribe((event) => {
      listener({
        canUndo: event.state.canUndo,
        canRedo: event.state.canRedo,
        undoDepth: event.state.undoStackSize,
        redoDepth: event.state.redoStackSize,
        nextUndoDescription: event.state.nextUndoDescription ?? undefined,
        nextRedoDescription: event.state.nextRedoDescription ?? undefined,
      });
    });
    return { dispose: () => sub.dispose() };
  }
}

// =============================================================================
// MogDocumentImpl
// =============================================================================

class MogDocumentImpl implements MogDocument {
  private readonly _handle: DocumentHandle;
  private _cachedWorkbook: Workbook | undefined;
  private _eventFacade: IMogSdkEventFacade | undefined;
  private _history: IMogDocumentHistory | undefined;

  constructor(handle: DocumentHandle) {
    this._handle = handle;
  }

  private _assertOpen(operation: string): void {
    if (!this._handle.isDisposed) return;
    throw new MogSdkError('DISPOSED', `${operation}: document is disposed`, {
      operation,
      details: { documentId: this._handle.documentId },
    });
  }

  // -- Identity ---------------------------------------------------------------

  get documentId(): string {
    return this._handle.documentId;
  }

  get initialSheetId(): SheetId {
    return this._handle.initialSheetId;
  }

  // -- Lifecycle state --------------------------------------------------------

  get status(): MogDocumentStatus {
    return mapPhaseToStatus(this._handle.storageState.phase);
  }

  get isDisposed(): boolean {
    return this._handle.isDisposed;
  }

  // -- Event facade -----------------------------------------------------------

  get events(): IMogSdkEventFacade {
    if (!this._eventFacade) {
      this._eventFacade = new MogSdkEventFacade(this._handle.eventBus, this._handle.documentId);
    }
    return this._eventFacade;
  }

  // -- History ----------------------------------------------------------------

  get history(): IMogDocumentHistory {
    if (!this._history) {
      this._history = new MogDocumentHistoryImpl(this._handle.undoService);
    }
    return this._history;
  }

  // -- Persistence state ------------------------------------------------------

  get persistence(): MogDocumentPersistenceState {
    const state = this._handle.storageState;
    return {
      mode: state.mode as MogDocumentDurabilityMode,
      readOnly: state.readOnly,
      pendingUpdatesCount: state.pendingUpdatesCount,
      lastCheckpointAt: state.lastCheckpointAt,
      lastSyncAt: state.lastSyncAt,
    };
  }

  // -- Workbook access --------------------------------------------------------

  async workbook(options?: MogDocumentWorkbookOptions): Promise<Workbook> {
    this._assertOpen('MogDocument.workbook');
    if (options) {
      // Options path — create a configured workbook (not cached).
      return this._handle.workbook({
        stateProvider: options.stateProvider
          ? {
              getActiveSheetId: () =>
                options.stateProvider!.getActiveSheetId() ?? this._handle.initialSheetId,
              setActiveSheetId: (id: string) =>
                options.stateProvider!.setActiveSheetId(toSheetId(id)),
              // SDK state providers only track sheet ID; remaining
              // members are headless no-ops that the internal
              // WorkbookStateProvider contract requires.
              getActiveCell: () => null,
              getSelectedRanges: () => [],
              getActiveObjectId: () => null,
              getActiveObjectType: () => null,
            }
          : undefined,
        readOnly: options.readOnly,
      });
    }

    // Default path — cached for referential stability.
    if (!this._cachedWorkbook) {
      this._cachedWorkbook = await this._handle.workbook();
    }
    return this._cachedWorkbook;
  }

  // -- Storage attachment -----------------------------------------------------

  async attachStorage(provider: MogSdkStorageProvider): Promise<void> {
    const { createSdkStorageAdapter } =
      await import('../../document/providers/sdk-storage-adapter');
    const internalProvider = createSdkStorageAdapter(provider);
    await this._handle.attachStorageProvider(internalProvider);
  }

  // -- Collaboration ----------------------------------------------------------

  async attachCollaboration(
    provider: MogSdkCollaborationProvider,
  ): Promise<MogCollaborationHandle> {
    throw new CollaborationFirstJoinRequiresHostBootstrapError(
      'SDK collaboration first join is not available on this path',
    );
  }

  // -- Close / dispose --------------------------------------------------------

  async close(_behavior?: MogCloseBehavior): Promise<MogDocumentCloseResult> {
    const result = await this._handle.close();
    return {
      status: result.status,
      finalCheckpoint: result.finalCheckpoint
        ? {
            status: result.finalCheckpoint.status,
            highWaterMark: {
              mark:
                typeof result.finalCheckpoint.highWaterMark.mark === 'string'
                  ? parseInt(result.finalCheckpoint.highWaterMark.mark, 10) || 0
                  : (result.finalCheckpoint.highWaterMark.mark as unknown as number),
              capturedAt: result.finalCheckpoint.highWaterMark.capturedAt,
              pendingMutationCount: result.finalCheckpoint.highWaterMark.pendingMutationCount,
            },
            providerResults: result.finalCheckpoint.providerResults.map((r) => ({
              providerId: r.providerRefId,
              status: r.status,
              error: r.failureReason,
            })),
            timestamp: result.finalCheckpoint.timestamp,
          }
        : undefined,
      detachedProviders: result.detachedProviders,
      errors: result.errors.map((e) => ({
        phase: e.phase,
        message: e.message,
        providerId: e.providerRefId,
      })),
      timestamp: result.timestamp,
    };
  }

  async checkpoint(): Promise<MogDocumentCheckpointResult> {
    const result = await this._handle.checkpoint();
    return {
      status: result.status,
      highWaterMark: {
        mark:
          typeof result.highWaterMark.mark === 'string'
            ? parseInt(result.highWaterMark.mark, 10) || 0
            : (result.highWaterMark.mark as unknown as number),
        capturedAt: result.highWaterMark.capturedAt,
        pendingMutationCount: result.highWaterMark.pendingMutationCount,
      },
      providerResults: result.providerResults.map((r) => ({
        providerId: r.providerRefId,
        status: r.status,
        error: r.failureReason,
      })),
      timestamp: result.timestamp,
    };
  }

  async disposeAsync(): Promise<void> {
    await this._handle.disposeAsync();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.disposeAsync();
  }

  // -- Deferred hydration -----------------------------------------------------

  async awaitMaterialized(scope?: SheetId | 'allSheets'): Promise<void> {
    await this._handle.awaitMaterialized(scope);
  }
}

// =============================================================================
// Factory function
// =============================================================================

/**
 * Wrap an internal DocumentHandle into a public MogDocument facade.
 * The returned MogDocument does NOT expose context, trap recovery,
 * or any other kernel-internal surface.
 */
export function createMogDocument(handle: DocumentHandle): MogDocument {
  return new MogDocumentImpl(handle);
}

export type { MogDocument };
