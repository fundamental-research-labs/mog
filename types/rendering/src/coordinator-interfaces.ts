// TODO: Migrate sheetId → containerId in FloatingObjectCoordinator and related interfaces.

/**
 * Coordinator Interfaces
 *
 * Pure interfaces extracted from the coordinator type definitions that have
 * no app-internal dependencies. These enable cross-zone references to
 * coordinator capabilities without creating DAG violations.
 *
 * @module @mog-sdk/contracts/rendering
 */

import type { CellFormat, SheetViewOptions } from '@mog/types-core';
import type { IFloatingObjectManager } from '@mog/types-objects/objects/floating-object-manager';
import type { Point } from '@mog/types-viewport/viewport';
import type { SplitViewportConfig } from '@mog/types-viewport/viewport-config';
import type { CellCoord, FrozenPanes } from './coordinates';
import type { ViewportReader } from '@mog/types-viewport/viewport/reader';

// =============================================================================
// FLOATING OBJECT COORDINATOR
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
  /** Get the FloatingObjectManager for object CRUD operations */
  getFloatingObjectManager(): IFloatingObjectManager | null;
  /** Check if ink mode is active (for input isolation) */
  isInkActive(): boolean;
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
 * - When drag state is entered -> coordinator calls onDragStart()
 * - When drag state is exited -> coordinator calls onDragEnd()
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
// SHEET STATE PROVIDER
// =============================================================================

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
   */
  getCulture(): string;
  /**
   * Get split view configuration for a sheet.
   * Returns null if no split is configured.
   * Used to restore split view on initialization and sheet switch.
   */
  getSplitConfig(sheetId: string): SplitViewportConfig | null;
  /** Get cell-level scroll position for a sheet (ground truth from Rust/Yrs). */
  getScrollPosition(sheetId: string): { topRow: number; leftCol: number };
}

// =============================================================================
// RENDERER DEPENDENCIES
// =============================================================================

/**
 * Opaque SheetView reference used in the onRendererCreated bridge callback.
 *
 * The callback is exposed as a cross-zone type in the contracts layer but
 * SheetView is defined in the Views layer (`@mog-sdk/sheet-view`). To keep
 * contracts free of hardware/view dependencies, we accept `unknown` here and
 * let the app-layer extension of this interface narrow the type to
 * `SheetView` (see `apps/spreadsheet/src/coordinator/types.ts`).
 */
export type SheetViewRef = unknown;

/**
 * Dependencies needed by the coordinator to execute renderer side effects.
 * These are provided by the component after mount since they require React hooks.
 */
export interface RendererDependencies {
  /**
   * ViewportReader for sync dimension data.
   * The renderer execution creates position indices internally from this.
   */
  viewport?: ViewportReader;
  /**
   * Get cell display value.
   * Receives sheetId at call time from RenderContext.currentSheetId.
   * This eliminates stale closure bugs when sheets switch.
   */
  getCellValue: (sheetId: string, cell: CellCoord) => unknown;
  /**
   * Get cell format.
   * Receives sheetId at call time from RenderContext.currentSheetId.
   * This eliminates stale closure bugs when sheets switch.
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

  // ===========================================================================
  // Per-sheet view state callbacks
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
   * Without this, the next scroll gesture would jump from the stale position.
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
   * Parameter type was `GridRenderer` before the SheetView extraction; it is
   * now an opaque `SheetViewRef`. The spreadsheet app narrows this to its
   * `SheetView` alias via a type-extended version of this interface.
   */
  onRendererCreated?: (view: SheetViewRef) => void;
}
