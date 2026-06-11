/**
 * Undo Service
 *
 * Delegates undo/redo to the Rust compute engine via ComputeBridge.
 * This is the cross-app undo/redo service.
 *
 * Y.UndoManager eliminated — all undo state lives in Rust.
 *
 */

import type { Result } from '../primitives';
import { ok, err, Subscribable } from '../primitives';
import type { ComputeBridge, UndoState } from '../../bridges/compute/compute-bridge';
import type { PivotUpdateOptions } from '@mog-sdk/contracts/events';

import type {
  IUndoService,
  UndoError,
  UndoServiceState,
  UndoStateChangeEvent,
} from '@mog-sdk/contracts/services';

export interface IUndoReplayService extends IUndoService {
  replayToUndoDepth(targetUndoDepth: number): Promise<Result<void, UndoError>>;
  undoToIndex(targetIndex: number): Promise<Result<void, UndoError>>;
}

// =============================================================================
// Undo Service Implementation
// =============================================================================

/**
 * Undo service implementation.
 * Delegates to ComputeBridge (Rust compute engine) for undo/redo.
 *
 * Extends Subscribable<UndoStateChangeEvent> — subscribe() returns IDisposable,
 * listeners are automatically cleaned up on dispose.
 */
class UndoService extends Subscribable<UndoStateChangeEvent> implements IUndoService {
  private static readonly HISTORY_REPLAY_PIVOT_UPDATE: PivotUpdateOptions = {
    reason: 'historyReplay',
    refreshPolicy: 'refreshAndMaterialize',
  };

  private computeBridge: ComputeBridge;
  private pendingDescription: string | null = null;
  private descriptions: string[] = [];
  private redoDescriptions: string[] = [];

  /** The trigger for the most recent state change (used by getSnapshot) */
  private lastTrigger: UndoStateChangeEvent['trigger'] = 'external';

  // Cached state from last Rust query (updated after each operation)
  private cachedState: UndoState = {
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    redoDepth: 0,
  };

  constructor(computeBridge: ComputeBridge) {
    super();
    this.computeBridge = computeBridge;

    // Initialize cached state from Rust
    void this.refreshState();
  }

  // ===========================================================================
  // Subscribable<UndoStateChangeEvent>
  // ===========================================================================

  getSnapshot(): UndoStateChangeEvent {
    return {
      state: this.getState(),
      trigger: this.lastTrigger,
    };
  }

  // ===========================================================================
  // State
  // ===========================================================================

  getState(): UndoServiceState {
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoStackSize: this.cachedState.undoDepth,
      redoStackSize: this.cachedState.redoDepth,
      nextUndoDescription: this.getNextUndoDescription(),
      nextRedoDescription: this.getNextRedoDescription(),
    };
  }

  canUndo(): boolean {
    return this.cachedState.canUndo;
  }

  canRedo(): boolean {
    return this.cachedState.canRedo;
  }

  getNextUndoDescription(): string | null {
    if (this.descriptions.length === 0) return null;
    return this.descriptions[this.descriptions.length - 1] ?? 'Undo';
  }

  getNextRedoDescription(): string | null {
    if (this.redoDescriptions.length === 0) return null;
    return this.redoDescriptions[this.redoDescriptions.length - 1] ?? 'Redo';
  }

  // ===========================================================================
  // Commands
  // ===========================================================================

  async undo(): Promise<Result<void, UndoError>> {
    if (!this.canUndo()) return err({ type: 'nothing-to-undo' });

    // Move description from undo stack to redo stack
    const desc = this.descriptions.pop();
    if (desc) {
      this.redoDescriptions.push(desc);
    }

    try {
      // Await the Rust undo operation (goes through mutateCore, NOT mutate).
      await this.runHistoryReplayMutation(() => this.computeBridge.undo());
      // Refresh cached state from Rust
      await this.refreshState();
      // Notify listeners once
      this.notifyChange('undo');
      return ok(undefined);
    } catch (e) {
      // Revert description move on failure
      if (desc) {
        this.redoDescriptions.pop();
        this.descriptions.push(desc);
      }
      console.error('[UndoService] undo failed:', e);
      return err({ type: 'rust-failed', reason: e instanceof Error ? e.message : String(e) });
    }
  }

  async redo(): Promise<Result<void, UndoError>> {
    if (!this.canRedo()) return err({ type: 'nothing-to-redo' });

    // Move description from redo stack to undo stack
    const desc = this.redoDescriptions.pop();
    if (desc) {
      this.descriptions.push(desc);
    }

    try {
      // Await the Rust redo operation (goes through mutateCore, NOT mutate).
      await this.runHistoryReplayMutation(() => this.computeBridge.redo());
      // Refresh cached state from Rust
      await this.refreshState();
      // Notify listeners once
      this.notifyChange('redo');
      return ok(undefined);
    } catch (e) {
      // Revert description move on failure
      if (desc) {
        this.descriptions.pop();
        this.redoDescriptions.push(desc);
      }
      console.error('[UndoService] redo failed:', e);
      return err({ type: 'rust-failed', reason: e instanceof Error ? e.message : String(e) });
    }
  }

  async replayToUndoDepth(targetUndoDepth: number): Promise<Result<void, UndoError>> {
    await this.refreshState();

    while (this.cachedState.undoDepth > targetUndoDepth) {
      const result = await this.undo();
      if (!result.ok) return result;
    }

    while (this.cachedState.undoDepth < targetUndoDepth) {
      const result = await this.redo();
      if (!result.ok) return result;
    }

    return ok(undefined);
  }

  async undoToIndex(targetIndex: number): Promise<Result<void, UndoError>> {
    if (targetIndex < 0 || !Number.isInteger(targetIndex)) {
      return err({ type: 'rust-failed', reason: `Invalid undo history index: ${targetIndex}` });
    }

    await this.refreshState();
    return this.replayToUndoDepth(Math.max(0, this.cachedState.undoDepth - targetIndex - 1));
  }

  clear(): void {
    this.descriptions = [];
    this.redoDescriptions = [];
    this.cachedState = { canUndo: false, canRedo: false, undoDepth: 0, redoDepth: 0 };
    this.notifyChange('clear');
  }

  private async runHistoryReplayMutation<T>(fn: () => Promise<T>): Promise<T> {
    const mutationHandler = this.computeBridge.getMutationHandler();
    return mutationHandler
      ? await mutationHandler.withPivotUpdateOptions(UndoService.HISTORY_REPLAY_PIVOT_UPDATE, fn)
      : await fn();
  }

  setNextDescription(description: string): void {
    this.pendingDescription = description;
  }

  stopCapturing(): void {
    // Consume any pending description into the descriptions stack
    if (this.pendingDescription) {
      this.descriptions.push(this.pendingDescription);
      this.pendingDescription = null;
    }
  }

  listDescriptions(): string[] {
    return [...this.descriptions].reverse(); // oldest-first → most-recent-first for UI
  }

  /**
   * Notify the service that a forward mutation was applied.
   * This is ONLY for forward mutations — never call this for undo/redo operations.
   * Captures pending descriptions and refreshes the undo state from Rust.
   */
  async notifyForwardMutation(): Promise<void> {
    const prevState = this.cachedState;

    // Refresh state from Rust
    await this.refreshState();

    const undoDepthChanged = this.cachedState.undoDepth !== prevState.undoDepth;
    const redoDepthChanged = this.cachedState.redoDepth !== prevState.redoDepth;
    if (!undoDepthChanged && !redoDepthChanged) {
      return;
    }

    // If there's a pending description, attach it to the current undo depth.
    if (this.pendingDescription) {
      this.descriptions.push(this.pendingDescription);
      this.pendingDescription = null;
    }

    // A real new undoable mutation after an undo invalidates Rust's redo stack.
    if (this.cachedState.redoDepth < prevState.redoDepth) {
      this.redoDescriptions = [];
    }

    // If undoDepth grew but no explicit description was set, push a fallback
    if (
      this.cachedState.undoDepth > prevState.undoDepth &&
      this.descriptions.length < this.cachedState.undoDepth
    ) {
      this.descriptions.push('Undo');
    }

    this.notifyChange('push');
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private notifyChange(trigger: UndoStateChangeEvent['trigger']): void {
    this.lastTrigger = trigger;
    this.emitChange();
  }

  /**
   * Refresh cached undo state from the Rust compute engine.
   */
  private async refreshState(): Promise<void> {
    try {
      this.cachedState = await this.computeBridge.getUndoState();
    } catch (e) {
      // If the compute bridge is not yet initialized, silently ignore
      // The state will be refreshed when the bridge is ready
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected _dispose(): void {
    super._dispose();
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new undo service instance.
 */
export function createUndoService(computeBridge: ComputeBridge): IUndoService {
  return new UndoService(computeBridge);
}
