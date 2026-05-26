/**
 * Shell Action System Types
 *
 * Types for the action dispatch system in the Shell layer.
 * Actions are how ALL user interactions happen (keyboard, toolbar, context menu, AI).
 *
 * Architecture:
 * ```
 * Input Sources (keyboard, toolbar, context menu, AI)
 * │
 * ▼ dispatch(actionType, deps)
 * ┌─────────────────────────────────────────────┐
 * │ HANDLER_MAP[actionType](deps) → ActionResult │
 * └─────────────────────────────────────────────┘
 * │
 * ┌──────────┼──────────┐
 * ▼ ▼ ▼
 * ViewAdapter Mutations UIStore
 * (via ctx) (via ctx) (shell)
 * ```
 *
 * Key differences from engine/src/state/actions:
 * - Uses ViewAdapter for view-agnostic operations (TOGGLE_BOLD, FILL_DOWN)
 * - Has ShellUIStore instead of EngineUIStore
 * - Will use ShellCoordinator instead of EngineCoordinator (TODO:
 *
 */

import type { ShellUIState } from '@mog/shell';
import type { MutationReceipt, WorkbookInternal } from '@mog-sdk/contracts/api';
import type { ViewAdapter } from '../views/types';

// =============================================================================
// Action Dependencies (Shell-specific)
// =============================================================================

/**
 * Dependencies injected into action handlers.
 *
 * Shell action handlers receive:
 * - ctx: Store context (for Mutations, domain modules, actor access)
 * - uiStore: Shell UI store (for dialogs, navigation, toolbar, etc.)
 * - accessors: View-agnostic accessors (active adapter, focus layer)
 * - commands: View-agnostic commands (copy, paste, etc.)
 *
 * TODO: Add ShellCoordinator for view-agnostic operations.
 */
export interface ActionDependencies {
  /**
   * Unified Workbook API — THE single entry point for all data/compute operations.
   * All paths terminate at the same ComputeBridge -> MutationResultHandler -> EventBus pipeline.
   */
  workbook: WorkbookInternal;

  /**
   * Shell UI store for shared UI state.
   * Manages dialogs, navigation, toolbar, find/replace, etc.
   */
  uiStore: ShellUIState;

  // TODO: Add when ShellCoordinator exists
  // coordinator: ShellCoordinator;

  /**
   * View-agnostic accessors for reading state.
   * Handlers should use these instead of directly accessing view internals.
   */
  accessors: {
    /**
     * Get the currently active view adapter.
     * Returns null if no view is active (e.g., during initialization).
     *
     * Pattern for view-agnostic handlers:
     * ```ts
     * const adapter = deps.accessors.getActiveViewAdapter();
     * if (!adapter) return { handled: false, reason: 'not_applicable' };
     *
     * const toolbarCtx = adapter.getToolbarContext();
     * if (!toolbarCtx.formatting.canBold) {
     * return { handled: false, reason: 'not_applicable' };
     * }
     *
     * adapter.applyFormatting({ bold: !toolbarCtx.state.isBold });
     * return { handled: true };
     * ```
     */
    getActiveViewAdapter(): ViewAdapter | null;

    /**
     * Get the current focus layer.
     * Determines which input handlers should be active.
     *
     * Layers (from lowest to highest priority):
     * - 'view': View handles input (Grid, Kanban, etc.)
     * - 'editor': Cell/field editor handles input
     * - 'dialog': Modal dialog handles input
     * - 'context-menu': Context menu handles input
     *
     * Example usage:
     * ```ts
     * if (deps.accessors.getFocusLayer() === 'dialog') {
     * // Don't handle keyboard shortcuts while dialog is open
     * return { handled: false, reason: 'not_applicable' };
     * }
     * ```
     */
    getFocusLayer(): 'view' | 'editor' | 'dialog' | 'context-menu';
  };

  /**
   * View-agnostic commands for writing state.
   * Handlers should use these instead of directly calling view methods.
   *
   * TODO: Move these to ShellCoordinator methods.
   */
  commands: {
    /**
     * Copy current selection to clipboard (multi-format).
     * Delegates to active view's getClipboardData().
     */
    copy(): void;

    /**
     * Paste clipboard data to current selection.
     * Delegates to active view's paste(data).
     */
    paste(): void;

    // TODO: Add more commands as they're needed
    // cut(): void;
    // delete(): void;
    // undo(): void;
    // redo(): void;
  };
}

// =============================================================================
// Action Result
// =============================================================================

/**
 * Result returned by action handlers.
 *
 * Allows handlers to indicate:
 * - Whether they handled the action
 * - Why they didn't handle it (for debugging)
 *
 * Note: This matches the contracts ActionResult for compatibility.
 */
export interface ActionResult {
  /** Whether the handler handled the action */
  handled: boolean;

  /**
   * Error message if the action failed.
   * Only set when handled is true but an error occurred.
   */
  error?: string;

  /**
   * Reason why the handler didn't handle the action (optional).
   * Used for debugging and analytics.
   */
  reason?: 'not_found' | 'not_implemented' | 'wrong_context' | 'disabled' | 'blocked';

  /**
   * Mutation receipts collected during action execution.
   * Downstream consumers (rendering, selection, undo) can use these
   * without re-querying for the mutated state.
   */
  receipts?: MutationReceipt[];
}

// =============================================================================
// Action Handler
// =============================================================================

/**
 * Action handler function signature.
 *
 * Handlers are pure functions with injected dependencies.
 * They should NOT directly access global state or actors.
 *
 * Pattern for view-agnostic handlers (
 * ```ts
 * export const TOGGLE_BOLD: ActionHandler = (deps) => {
 * const adapter = deps.accessors.getActiveViewAdapter();
 * if (!adapter) return { handled: false, reason: 'not_applicable' };
 *
 * const toolbarCtx = adapter.getToolbarContext();
 * if (!toolbarCtx.formatting.canBold) {
 * return { handled: false, reason: 'not_applicable' };
 * }
 *
 * const newValue = toolbarCtx.state.isBold !== true;
 * adapter.applyFormatting({ bold: newValue });
 * return { handled: true };
 * };
 * ```
 */
export type ActionHandler = (deps: ActionDependencies, payload?: unknown) => ActionResult;
