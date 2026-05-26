/**
 * WorkbookHistoryImpl -- Undo/redo sub-API implementation.
 *
 * Delegates to UndoService (undo/redo/canUndo/canRedo) and
 * domain/undo (getUndoHistory, undoToIndex). UndoService owns the
 * single undo/redo pipeline: mutateCore() for Rust state, then
 * notification/state refresh.
 *
 * No JS-side sheet cache — undo/redo reads sheet state from Rust directly.
 */
import type { CallableDisposable } from '@mog/spreadsheet-utils/disposable';
import type {
  RedoReceipt,
  UndoHistoryEntry,
  UndoReceipt,
  UndoState,
  UndoStateChangeEvent,
  WorkbookHistory,
} from '@mog-sdk/contracts/api';
import { KernelError } from '../../errors';

import type { DocumentContext } from '../../context';
import * as Undo from '../../domain/undo';

export interface WorkbookHistoryDeps {
  ctx: DocumentContext;
  refreshSheetMetadata?: () => Promise<void>;
}

export class WorkbookHistoryImpl implements WorkbookHistory {
  private readonly ctx: DocumentContext;
  private readonly refreshSheetMetadata?: () => Promise<void>;

  constructor(deps: WorkbookHistoryDeps) {
    this.ctx = deps.ctx;
    this.refreshSheetMetadata = deps.refreshSheetMetadata;
  }

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  async undo(): Promise<UndoReceipt> {
    this._ensureWritable('history.undo');
    const result = await this.ctx.services!.undo.undo();
    if (!result.ok && result.error.type === 'rust-failed') {
      throw new KernelError('COMPUTE_ERROR', `Undo failed: ${result.error.reason}`);
    }
    if (result.ok) await this.refreshSheetMetadata?.();
    return { kind: 'undo', success: result.ok };
  }

  async redo(): Promise<RedoReceipt> {
    this._ensureWritable('history.redo');
    const result = await this.ctx.services!.undo.redo();
    if (!result.ok && result.error.type === 'rust-failed') {
      throw new KernelError('COMPUTE_ERROR', `Redo failed: ${result.error.reason}`);
    }
    if (result.ok) await this.refreshSheetMetadata?.();
    return { kind: 'redo', success: result.ok };
  }

  canUndo(): boolean {
    return this.ctx.services!.undo.canUndo();
  }

  canRedo(): boolean {
    return this.ctx.services!.undo.canRedo();
  }

  list(): UndoHistoryEntry[] {
    return Undo.getUndoHistory(this.ctx);
  }

  async goToIndex(index: number): Promise<void> {
    try {
      await Undo.undoToIndex(this.ctx, index);
      await this.refreshSheetMetadata?.();
    } catch (error) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Failed to go to undo history index ${index}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async getState(): Promise<UndoState> {
    const state = await this.ctx.computeBridge.getUndoState();
    const serviceState = this.ctx.services?.undo.getState();
    return {
      canUndo: state.canUndo,
      canRedo: state.canRedo,
      undoDepth: state.undoDepth,
      redoDepth: state.redoDepth,
      nextUndoDescription: serviceState?.nextUndoDescription ?? null,
      nextRedoDescription: serviceState?.nextRedoDescription ?? null,
    };
  }

  subscribe(listener: (event: UndoStateChangeEvent) => void): CallableDisposable {
    return this.ctx.services!.undo.subscribe(listener);
  }

  setNextDescription(description: string): void {
    this.ctx.services!.undo.setNextDescription(description);
  }
}
