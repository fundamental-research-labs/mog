/**
 * Coordinator Type Definitions
 *
 * All type definitions for the SheetCoordinator extracted to a single location.
 * This ensures type consistency across all coordinator modules.
 *
 * @see COORDINATOR-MODULE-EXTRACTION.md
 */

import type { ActorRefFrom, SnapshotFrom } from 'xstate';

import type { SheetViewHandle } from '@mog-sdk/sheet-view';
import type { focusMachine } from '@mog/shell';
import type { CellFormat, SheetId, SheetViewOptions } from '@mog-sdk/contracts/core';
import type { ViewportReader } from '@mog-sdk/contracts/api';
import type {
  CellCoord,
  FrozenPanes,
  GridRenderer,
  GridRendererConfig,
  RendererFactory,
} from '@mog-sdk/contracts/rendering';
import type { ResolvedSheetViewSkin } from '@mog-sdk/contracts/rendering/sheet-view-skin';

import type { Point } from '@mog-sdk/contracts/viewport';
import type { SplitViewportConfig } from '@mog-sdk/contracts/viewport-config';
import type { IViewAdapter } from '@mog-sdk/contracts/views';
import type { RenderInvalidation } from '../systems/grid-editing/coordination/cross-coordination';
import type { Platform } from '@mog-sdk/contracts/platform';
import type { InputCoordinatorConfig } from '../systems/input/machines/input-types';
import type { Metric } from '../systems/shared/types';

// =============================================================================
// ACTOR TYPE ALIASES (re-exported from machine files)
// =============================================================================

export type {
  ClipboardActor,
  ClipboardState,
} from '../systems/grid-editing/machines/clipboard-machine';
export type { CommentActor, CommentState } from '../systems/grid-editing/machines/comment-machine';
export type {
  DrawBorderActor,
  DrawBorderState,
} from '../systems/grid-editing/machines/draw-border-machine';
export type {
  FindReplaceActor,
  FindReplaceState,
} from '../systems/grid-editing/machines/find-replace-machine';
export type {
  EditorActor,
  EditorState,
} from '../systems/grid-editing/machines/grid-editor-machine';
export type {
  SelectionActor,
  SelectionState,
} from '../systems/grid-editing/machines/grid-selection-machine';
export type { PaneFocusActor } from '../systems/input/machines/pane-focus-machine';
export type { ChartActor, ChartState } from '../systems/objects/machines/chart-machine';
export type {
  ObjectInteractionActor,
  ObjectInteractionState_,
} from '../systems/objects/machines/object-interaction-machine';
export type { DiagramActor } from '../systems/objects/machines/diagram-machine';
export type {
  RendererActor,
  RendererState,
} from '../systems/renderer/machines/grid-renderer-machine';
export type { PageBreakActor } from '../systems/renderer/machines/page-break-machine';

// FocusActor stays here (from @mog/shell, not in systems/)
export type FocusActor = ActorRefFrom<typeof focusMachine>;
export type FocusState = SnapshotFrom<typeof focusMachine>;

// Re-import moved interfaces
export type { ClipboardDependencies, EditorDependencies } from '../systems/grid-editing/types';
export type { ActorRefs } from '../systems/shared/actor-types';

// Local imports for types used within this file (re-exports don't bind locally)
import type {
  ClipboardDependencies as _ClipboardDeps,
  EditorDependencies as _EditorDeps,
} from '../systems/grid-editing/types';

// =============================================================================
// MINIMAL COORDINATOR INTERFACE
// =============================================================================

/**
 * Minimal interface for coordinator access in mutations and object coordination.
 *
 * This interface defines the subset of coordinator methods needed by:
 * - Object mutations (moveObject, resizeObject, rotateObject, etc.)
 * - Object coordination module (for ink mode checking)
 *
 * Both SheetCoordinator and GridCoordinator implement this interface,
 * allowing them to be used interchangeably in these contexts.
 *
 */
export interface FloatingObjectCoordinator {
  /** Check if ink mode is active (for input isolation) */
  isInkActive(): boolean;
}

// =============================================================================
// RENDERER DEPENDENCY TYPES
// =============================================================================

// Re-export from contracts for convenience
export type { GridRenderer, GridRendererConfig, RendererFactory };

/**
 * Interface for providing sheet state to the coordinator.
 * The spreadsheet store implements this interface.
 *
 * This pattern ensures:
 * 1. TypeScript enforces that all required methods are provided
 * 2. Single point of wiring instead of many individual callbacks
 * 3. New state accessors can be added by extending this interface
 */
export interface SheetStateProvider {
  /** Get frozen panes configuration for a sheet */
  getFrozenPanes(sheetId: string): FrozenPanes;
  /** Get view options (gridlines, headers visibility, etc.) for a sheet */
  getSheetViewOptions(sheetId: string): SheetViewOptions;
  /**
   * Get the workbook culture setting.
   * Returns IETF language tag (e.g., 'en-US', 'de-DE').
   * Used to apply initial culture on renderer initialization.
   * Culture & Localization
   */
  getCulture(): string;
  /**
   * Get split view configuration for a sheet.
   * Returns null if no split is configured.
   * Used to restore split view on initialization and sheet switch.
   */
  getSplitConfig(sheetId: string): SplitViewportConfig | null;

  /** Get the cell-level scroll position for a sheet (ground truth from Rust/Yrs). */
  getScrollPosition(sheetId: string): { topRow: number; leftCol: number };
}

/**
 * Dependencies needed by the coordinator to execute renderer side effects.
 * These are provided by the component after mount since they require React hooks.
 *
 * NOTE: This is the spreadsheet-app-specific extension of the contracts
 * RendererDependencies. It narrows `onRendererCreated` to accept `SheetView`
 * directly (contracts uses an opaque `SheetViewRef`) so bridge consumers get
 * the real type.
 */
export interface RendererDependencies {
  /**
   * ViewportReader for sync dimension data.
   * The renderer execution creates VPI+VMI from this reader.
   */
  viewport?: ViewportReader;
  /**
   * Get cell display value.
   * Receives sheetId at call time from RenderContext.currentSheetId.
   * This eliminates stale closure bugs when sheets switch.
   * @see SHEET-AWARE-CELL-DATA-CALLBACKS.md
   */
  getCellValue: (sheetId: string, cell: CellCoord) => unknown;
  /**
   * Get cell format.
   * Receives sheetId at call time from RenderContext.currentSheetId.
   * This eliminates stale closure bugs when sheets switch.
   * @see SHEET-AWARE-CELL-DATA-CALLBACKS.md
   */
  getCellFormat: (sheetId: string, cell: CellCoord) => CellFormat | undefined;
  /** Initial sheet ID */
  initialSheetId: string;
  /** Total rows */
  totalRows?: number;
  /** Total cols */
  totalCols?: number;
  /** Provides sheet state (frozen panes, view options) - required for correct initialization */
  sheetStateProvider: SheetStateProvider;
  /** Initial renderer skin. Must be available before first paint. */
  sheetViewSkin?: ResolvedSheetViewSkin;

  // ===========================================================================
  // Per-Sheet View State Callbacks (Per-Sheet Selection Memory)
  // ===========================================================================

  /**
   * Get the initial scroll position for a sheet.
   * Called when switching to a sheet to restore scroll position.
   * Returns {x: 0, y: 0} if no saved position exists.
   */
  getInitialScrollPosition?: (sheetId: string) => Point;

  /**
   * Notify when scroll position changes for a sheet.
   * Called on scroll events to save scroll position per sheet.
   */
  onScrollPositionChanged?: (sheetId: string, position: Point) => void;

  /**
   * Reset the input system's internal scroll position without triggering events.
   * Called during sheet switch after renderer.setScroll() restores the scroll position,
   * so the InputCoordinator's physics engine syncs to the restored position.
   */
  onScrollPositionReset?: (position: Point) => void;

  // ===========================================================================
  // Renderer Lifecycle Callbacks
  // ===========================================================================

  /**
   * Called when the SheetView is created.
   * Use this to wire bridges (Diagram, TextEffect, Equation) that need the
   * underlying rendering substrate.
   *
   * Parameter type changed from `GridRenderer` to `SheetView` as part of the
   * `@mog-sdk/sheet-view` extraction. Consumers that need the underlying
   * `GridRenderer` can still reach it via `sheetView.gridRenderer` (facade)
   * or the system's capability accessors (getGeometry, getRenderCapability, etc.).
   */
  onRendererCreated?: (view: SheetViewHandle) => void;
}

// =============================================================================
// SHELL COORDINATOR TYPES
// =============================================================================

/**
 * View adapter interface for coordinator use.
 *
 * Extends the contracts IViewAdapter with clipboard methods that the
 * coordinator needs. This avoids importing from views/ (DAG violation).
 * The clipboard methods use ClipboardPayload from domain/, which is
 * allowed in the dependency graph.
 */
export interface CoordinatorViewAdapter extends IViewAdapter {
  /** Export current selection to canonical ClipboardPayload format. */
  getClipboardPayload(): import('../domain/clipboard/types').ClipboardPayload;
  /** Check if the view can paste the given payload. */
  canPaste(payload: import('../domain/clipboard/types').ClipboardPayload): boolean;
  /** Paste from canonical ClipboardPayload format. */
  paste(payload: import('../domain/clipboard/types').ClipboardPayload): void;
}

/**
 * Configuration for creating a ShellCoordinator.
 * The ShellCoordinator manages view lifecycle and cross-view coordination.
 */
export interface ShellCoordinatorConfig {
  /** Container element for mounting views */
  container: HTMLElement;
  /** View registry for creating view adapters */
  viewRegistry: import('@mog-sdk/contracts/views').IViewRegistry;
  /** Whether the OS is macOS (for keyboard shortcut modifier selection) */
  isMac?: boolean;
  /**
   * Optional kernel clipboard service for storage delegation.
   * When provided, shell clipboard operations are also delegated to the kernel service.
   * This enables cross-app clipboard support.
   */
  kernelClipboardService?: import('@mog-sdk/contracts/services').IClipboardService;
}

/**
 * State snapshot of the ShellCoordinator.
 * Used for debugging and testing.
 */
export interface ShellCoordinatorState {
  /** Currently active view ID */
  activeViewId: string | null;
  /** Currently active view adapter */
  activeAdapter: IViewAdapter | null;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Dependencies for sheet switch coordination.
 * Passed via SheetCoordinatorConfig.sheetSwitchDependencies at construction time.
 *
 * Needed by sheet switch coordination to:
 * - Subscribe to activeSheetId changes
 * - Get/save/delete per-sheet view state (selection + scroll position)
 *
 */
export interface SheetSwitchDependencies {
  /** UI store API for subscribing to activeSheetId changes and accessing view state methods */
  uiStoreApi: import('zustand').StoreApi<import('../ui-store').UIState>;
  /** Import durability gate for host-backed XLSX documents. */
  importDurability?: SheetSwitchImportDurabilityGate;
}

export interface SheetSwitchImportDurabilityGate {
  readonly isImportDurabilityPending: boolean;
  scheduleDeferredHydration?(): Promise<void>;
  awaitMaterialized?(scope?: SheetId | 'allSheets'): Promise<void>;
  awaitImportDurability(): Promise<void>;
}

/**
 * Dependencies for toolbar format synchronization.
 * Keeps ribbon buttons (Bold, Italic, etc.) in sync with the active cell's format.
 *
 * Separated from SheetSwitchDependencies so that toolbar sync is independently
 * configurable and not silently broken if multi-sheet support is disabled.
 *
 */
export interface ToolbarDependencies {
  /** UI store API for reading/writing activeCellFormat */
  uiStoreApi: import('zustand').StoreApi<import('../ui-store').UIState>;
}

/**
 * Configuration for creating a SheetCoordinator.
 *
 * Extended to include all dependencies needed for full initialization.
 * This enables constructor-only initialization (no post-construction configuration).
 *
 */
export interface SheetCoordinatorConfig {
  /** Initial sheet ID to display */
  initialSheetId: string;

  /** Keyboard platform for shortcut resolution. Flows to InputSystem → KeyboardCoordinator. */
  platform?: Platform;

  /**
   * Live getter for the currently active sheet ID.
   * Reads from UIStore.activeSheetId when provided.
   * Falls back to initialSheetId for tests/minimal usage.
   *
   */
  getActiveSheetId?: () => string;
  /** Callback for metrics/observability */
  onMetric?: (metric: Metric) => void;
  /** Callback for render invalidation (used by renderer) */
  onRenderInvalidation?: (invalidation: RenderInvalidation) => void;
  /** Optional input coordinator configuration */
  inputConfig?: Partial<InputCoordinatorConfig>;

  // ==========================================================================
  // Decoupled dependencies (coordinator-dependency-decoupling.md)
  // ==========================================================================

  /**
   * Explicitly enable keyboard coordinator.
   * When true, keyboard shortcuts and navigation will be active.
   */
  enableKeyboard?: boolean;

  /**
   * Callback to trigger UI-level actions (open find dialog, etc.)
   * Used by keyboard coordinator and action system.
   */
  onUIAction?: (action: string) => void;

  // ==========================================================================
  // Feature-specific dependency bundles
  // ==========================================================================

  /** Dependencies for clipboard paste operations */
  clipboardDependencies?: _ClipboardDeps;
  /** Dependencies for editor operations (commit, validation, schema lookup) */
  editorDependencies?: _EditorDeps;
  /** Platform-owned wall clock in Unix milliseconds. */
  wallClockNow?: () => number;
  /** Dependencies for sheet switch coordination (per-sheet view state) */
  sheetSwitchDependencies?: SheetSwitchDependencies;
  /** Dependencies for toolbar format sync (Bold/Italic active state) */
  toolbarDependencies?: ToolbarDependencies;

  /**
   * Confirmation callback for destructive operations (e.g., delete sheet).
   * Injected to avoid direct `window.confirm` calls in the coordinator,
   * making the coordinator testable without browser globals.
   * Defaults to no-op (no confirmation, operation proceeds).
   */
  confirmDialog?: (message: string) => boolean;

  /** Unified Workbook API for data operations — required */
  workbook: import('@mog-sdk/contracts/api').WorkbookInternal;

  /** When true, blocks mutating operations (read-only mode). */
  readOnly?: boolean;
}

// =============================================================================
// POINTER CAPTURE MANAGER
// =============================================================================

/**
 * PointerCaptureManager interface.
 *
 * Coordinator owns this manager and orchestrates pointer capture lifecycle
 * based on state machine transitions (drag states).
 *
 * ARCHITECTURE:
 * - Machines are PURE (no DOM access, no side effects)
 * - Coordinator subscribes to machine state transitions
 * - When drag state is entered → coordinator calls onDragStart()
 * - When drag state is exited → coordinator calls onDragEnd()
 * - Component provides DOM element via setContainerElement()
 *
 */
export interface PointerCaptureManager {
  /**
   * Set the DOM element that will capture pointer events.
   * Called by the component/hook when container mounts.
   */
  setContainerElement(element: HTMLElement | null): void;

  /**
   * Called by coordinator when a drag state is entered.
   * Captures the pointer so events continue outside the window.
   */
  onDragStart(pointerId: number): void;

  /**
   * Called by coordinator when a drag state is exited.
   * Releases the pointer capture.
   */
  onDragEnd(pointerId: number): void;

  /**
   * Check if pointer is currently captured.
   */
  isCapturing(): boolean;

  /**
   * Get the currently captured pointer ID (or null if not capturing).
   */
  getCapturedPointerId(): number | null;
}

// =============================================================================
// RE-EXPORT COMMON TYPES
// =============================================================================

export type { CellCoord };
export type { Metric } from '../systems/shared/types';
