/**
 * Unified Action System - Type Definitions
 *
 * These types define the unified action dispatch system that replaces
 * duplicate action implementations across keyboard, toolbar, and context menu.
 *
 * ARCHITECTURE:
 * - All input sources (keyboard, toolbar, context menu, AI agent) dispatch actions
 *   through a single handler system: dispatch(actionType, deps) → ActionResult
 * - Handlers are pure functions in engine/src/state/actions/handlers/
 * - This file contains ONLY types; all implementation is in engine/
 *
 * Package boundary:
 * - Pure string-literal action type unions live in @mog/types-editor
 *   (types/editor/src/actions/action-types.ts). Re-exported below.
 * - Handler/dependency interfaces stay here because they reference Tier 2
 *   types (WorkbookInternal from ../api, ActorAccessors/Commands from
 *   ../actors, MutationReceipt from ../api/mutation-receipt) that have
 *   not yet been extracted into workspace packages.
 *
 */

// Re-export the pure string-literal action unions from types-editor. Consumers
// that only need ActionType (e.g. keyboard/shortcuts) can also import from
// @mog/types-editor/actions/action-types directly.
export type {
  ActionType,
  AutoFillActionType,
  ChartActionType,
  ClipboardActionType,
  CommentActionType,
  ConditionalFormattingActionType,
  CustomListsActionType,
  DataAnalysisDialogActionType,
  DragDropActionType,
  EditorActionType,
  EquationActionType,
  FillContextMenuActionType,
  FilterActionType,
  FlashFillActionType,
  FormatPainterActionType,
  FormattingActionType,
  InkActionType,
  CellHorizontalAlign,
  KeyboardActionPayload,
  NavigationActionType,
  ObjectActionType,
  OpenPageSetupDialogPayload,
  PageSetupDialogTab,
  PasteValidationActionType,
  PrintExportActionType,
  RepeatActionType,
  RibbonDropdownId,
  RibbonDropdownPayload,
  RibbonTabId,
  SelectionActionType,
  SetHorizontalAlignPayload,
  SetVerticalAlignPayload,
  SlicerActionType,
  DiagramActionType,
  SplitActionType,
  StructureActionType,
  SwitchRibbonTabPayload,
  CellVerticalAlign,
  TableActionType,
  ThesaurusInsertPayload,
  TotalRowActionType,
  UIActionType,
  ViewActionType,
  TextEffectActionType,
  WorkbookActionType,
} from '@mog/types-editor/actions/action-types';

import type { ActionType } from '@mog/types-editor/actions/action-types';

// =============================================================================
// UI Store Interface
// =============================================================================

/**
 * Minimal interface for UI Store API (Zustand store pattern).
 *
 * This interface describes the subset of Zustand's StoreApi that action handlers need.
 * The actual state type is intentionally `unknown` to avoid circular dependencies
 * between contracts and engine/shell packages.
 *
 * In practice:
 * - Engine's UIStore implements this with UIState
 * - Shell's UIStore implements this with ShellUIState
 *
 * Handlers should use type-safe helper functions to access the store:
 * ```ts
 * // In shell-local action handler helpers
 * import type { UIState } from the app's UI state module;
 *
 * export function getUIState(deps: ActionDependencies): UIState {
 *   return deps.uiStore.getState() as UIState;
 * }
 * ```
 */
export interface IUIStoreApi {
  /**
   * Get the current state snapshot.
   * State contains both data and action methods (Zustand pattern).
   */
  getState(): unknown;

  /**
   * Update state with partial state or updater function.
   * Typically not used directly by handlers - call state methods instead.
   */
  setState(partial: unknown | ((state: unknown) => unknown), replace?: boolean): void;

  /**
   * Subscribe to state changes.
   * Typically not used by action handlers.
   */
  subscribe(listener: (state: unknown, prevState: unknown) => void): () => void;
}

// =============================================================================
// Host Command Bridge
// =============================================================================

/**
 * Ownership for host-sensitive full-app commands.
 *
 * The spreadsheet app still receives normal UI actions from toolbar clicks and
 * keyboard shortcuts. This bridge lets an embedding runtime intercept the
 * command at the action-handler boundary before browser file dialogs, downloads,
 * printing, or shell lifecycle side effects happen.
 */
export type HostCommandOwner = 'host' | 'mog' | 'disabled';

export type HostSpreadsheetCommand = 'save' | 'export' | 'open' | 'share' | 'import' | 'print';

export interface HostSpreadsheetCommandRequest {
  readonly command: HostSpreadsheetCommand;
  readonly format?: 'xlsx' | 'csv' | 'pdf' | 'json';
  readonly source?: 'file-menu' | 'keyboard' | 'data-ribbon' | 'print-panel' | string;
}

export type HostSpreadsheetCommandResult =
  | { readonly status: 'handled'; readonly result?: unknown }
  | { readonly status: 'denied'; readonly reason: string }
  | { readonly status: 'not-handled' };

export interface HostSpreadsheetCommandBridge {
  getOwner(command: HostSpreadsheetCommand): HostCommandOwner;
  request(request: HostSpreadsheetCommandRequest): Promise<HostSpreadsheetCommandResult>;
}

// =============================================================================
// Action Dependencies
// =============================================================================

/**
 * Dependencies needed by action handlers.
 *
 * This interface is designed to be constructed once and passed to dispatch().
 * Handlers receive all dependencies they might need; unused ones are simply ignored.
 *
 * CRITICAL: Handlers must not store references to these dependencies.
 * They should use them synchronously and return.
 */
export interface ActionDependencies {
  /**
   * Unified Workbook API — THE single entry point for all data/compute operations.
   *
   * The single entry point for all data/compute operations.
   * All paths terminate at the same ComputeBridge -> MutationResultHandler -> EventBus pipeline.
   */
  workbook: import('../api').WorkbookInternal;

  /**
   * Actor accessors for reading actor state (point-in-time reads).
   * Handlers should use this instead of directly accessing actors.
   *
   * @example
   * ```ts
   * const activeCell = deps.accessors.selection.getActiveCell();
   * if (deps.accessors.editor.isFormulaEditing()) { ... }
   * ```
   *
   */
  accessors: import('../actors').ActorAccessors;

  /**
   * Actor commands for writing actor state.
   * Handlers should use this instead of directly calling actor.send().
   *
   * @example
   * ```ts
   * deps.commands.selection.keyArrow('down', false);
   * deps.commands.editor.commit('down');
   * ```
   *
   */
  commands: import('../actors').ActorCommands;

  /** Get active sheet ID */
  getActiveSheetId: () => import('../core/core').SheetId;

  /**
   * Get selected sheet IDs for multi-sheet operations.
   * When multiple sheets are selected, operations like formatting
   * should broadcast to all selected sheets.
   *
   * Returns [activeSheetId] if not set (single sheet selection).
   *
   * Stream H: Multi-Sheet Selection
   */
  getSelectedSheetIds?: () => string[] | Promise<string[]>;

  /**
   * UI action callback for the deferred chart-format dialog handlers and
   * `PASTE_NAME_IN_FORMULA` in editor.ts.
   *
   * @scope ONLY:
   *   - charts.ts: OPEN_MOVE_CHART_DIALOG, OPEN_FORMAT_CHART_AREA,
   *     OPEN_FORMAT_PLOT_AREA, OPEN_FORMAT_DATA_SERIES, OPEN_FORMAT_AXIS,
   *     OPEN_FORMAT_LEGEND, OPEN_FORMAT_CHART_TITLE
   *   - editor.ts: PASTE_NAME_IN_FORMULA
   *
   * This compatibility hook is temporary until dialog components are available
   * field entirely. Do NOT add new uses.
   */
  onUIAction?: (action: string) => void;

  /** Check if floating objects are selected */
  hasObjectSelection?: () => boolean;

  /** Check if editing text inside a floating object */
  isEditingObjectText?: () => boolean;

  /** Get current selection state (for handlers that need selection info) */
  getSelection?: () => unknown;

  /**
   * UI Store for ephemeral UI state (dialogs, pending formats, etc.).
   *
   * This is a Zustand store API instance that provides access to UI state.
   * The state type is generic to avoid contracts → engine circular dependency.
   *
   * Handler pattern - use getState() to access current state:
   * ```ts
   * const state = deps.uiStore.getState();
   * if (state.dialogOpen) { ... }
   * state.openDialog();  // Methods are on the state, not the store
   * ```
   *
   * In engine, the state type is `UIState`.
   * In shell, the state type is `ShellUIState`.
   */
  uiStore: IUIStoreApi;

  /**
   * Coordinator instance for viewport/scroll operations.
   * Type is `unknown` here to avoid contracts → engine dependency.
   * In engine, this is typed as `SheetCoordinator`.
   *
   * E1/E4: Used for scrollToActiveCell via Ctrl+Backspace.
   */
  coordinator?: unknown;

  /**
   * Dispatch a synthetic contextmenu event at the given coordinates.
   *
   * Used by INVOKE_CONTEXT_MENU to trigger Radix ContextMenu (which is
   * uncontrolled and only responds to native contextmenu DOM events).
   * This avoids leaking raw HTMLElement references to action handlers.
   *
   * @returns true if the event was dispatched, false if unavailable
   */
  dispatchContextMenu?: (clientX?: number, clientY?: number) => boolean;

  /**
   * Platform abstraction for OS-bridging operations: file dialogs (returning
   * `PlatformFileHandle` capability handles), notifications, clipboard, and
   * shell ops. Required invariant: every deps construction
   * site MUST provide this. Web/desktop differences live behind the
   * implementation; handlers code against the capability surface.
   *
   * @see contracts/src/platform/index.ts for `IPlatform`.
   */
  platform: import('../platform').IPlatform;

  /**
   * Platform-owned wall clock in Unix milliseconds.
   *
   * Production dependency builders should provide this instead of letting action
   * handlers read host wall time directly.
   */
  wallClockNow?: () => number;

  /**
   * Shell-level document lifecycle facade. Provides bytes-based
   * `loadDocument`, `newDocument`, `closeActiveDocument`,
   * `setActiveDocument`, `getDocumentState`, and `setDocumentHandle` —
   * the typed replacement for the previous `window.__SHELL__.*`
   * reach-arounds in handler code. Required invariant.
   *
   * @see types/document/src/shell/types.ts for `ShellService`.
   * @see shell/src/services/shell-service.ts for the implementation.
   */
  shellService: import('@mog-sdk/types-document/shell/types').ShellService;

  /**
   * Optional full-app embed command bridge. Present when the spreadsheet app is
   * mounted inside a trusted host runtime that owns persistence or selected
   * command side effects.
   */
  hostCommands?: HostSpreadsheetCommandBridge;

  /**
   * Optional UI feature gates for action handlers that must enforce chrome
   * policy beyond visible controls, such as keyboard shortcuts.
   */
  featureGates?: import('../feature-gates').FeatureGates;
}

// =============================================================================
// Action Result
// =============================================================================

/**
 * Result of executing an action handler.
 */
export interface ActionResult {
  /**
   * Whether the action was handled.
   * If true, the caller should typically preventDefault().
   */
  handled: boolean;

  /**
   * Error message if the action failed.
   * Only set when handled is true but an error occurred.
   */
  error?: string;

  /**
   * Reason for not handling (debugging).
   * Only set when handled is false.
   */
  reason?: 'not_found' | 'not_implemented' | 'wrong_context' | 'disabled' | 'blocked';

  /**
   * Mutation receipts collected during action execution.
   * Downstream consumers (rendering, selection, undo) can use these
   * without re-querying for the mutated state.
   */
  receipts?: import('../api/mutation-receipt').MutationReceipt[];
}

// =============================================================================
// Action Handler Type
// =============================================================================

/**
 * Function signature for action handlers.
 *
 * Handlers are pure functions that:
 * 1. Receive dependencies (actors, ctx, etc.) and optional payload
 * 2. Perform the action (send to actor, call Mutations, etc.)
 * 3. Return a result indicating success/failure
 *
 * Handlers should NOT:
 * - Store references to dependencies
 * - Perform async operations (use callbacks for those)
 * - Access global state directly
 *
 * @param deps - Action dependencies (ctx, actors, etc.)
 * @param payload - Optional action-specific data (e.g., { panel: 'info' } for SET_BACKSTAGE_PANEL)
 */

export type ActionHandler = (deps: ActionDependencies, payload?: any) => ActionResult;

/**
 * Async action handler type.
 *
 * Used for actions that require async operations (e.g., ink recognition).
 * The dispatcher handles awaiting these automatically.
 */
export type AsyncActionHandler = (deps: ActionDependencies, payload?: any) => Promise<ActionResult>;

// =============================================================================
// Handler Map Type
// =============================================================================

/**
 * Combined handler type that allows both sync and async handlers.
 */
export type AnyActionHandler = ActionHandler | AsyncActionHandler;

/**
 * Type for the handler map.
 * Ensures every ActionType has a corresponding handler.
 * Handlers can be sync or async.
 */
export type ActionHandlerMap = Record<ActionType, AnyActionHandler>;
