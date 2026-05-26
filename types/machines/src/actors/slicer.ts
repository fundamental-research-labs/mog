/**
 * Slicer Actor Access
 *
 * Selectors (the primitive) + Accessor interface (the contract for handlers).
 * Co-located to prevent drift.
 *
 * States:
 * - idle: Slicer visible but not being interacted with
 * - hovering: Mouse over slicer (shows hover effects)
 * - multiSelecting: Ctrl+click multi-select mode
 * - delegatingDrag: Moving the slicer (delegated to object-interaction-machine)
 * - delegatingResize: Resizing slicer (delegated to object-interaction-machine)
 * - disconnected: Source column/table/pivot was deleted
 *
 * @see state-machines/src/slicer-machine.ts
 */

import type { CellValue, SheetId } from '@mog/types-core';

// =============================================================================
// STATE TYPE (matches XState snapshot shape)
// =============================================================================

/**
 * Minimal state type for selectors - matches XState snapshot shape.
 */
export interface SlicerState {
  context: {
    /** ID of the slicer being interacted with (null if no slicer focused) */
    slicerId: string | null;
    /** Sheet containing the slicer */
    sheetId: SheetId | null;
    /** Last clicked value (for shift+click range selection) */
    lastClickedValue: CellValue | undefined;
    /** Currently hovered item value (for hover effects) */
    hoveredValue: CellValue | undefined;
    /** Whether multi-select mode is active (Ctrl key held) */
    isMultiSelectActive: boolean;
    /** Error message (for disconnected state, etc.) */
    errorMessage: string | null;
    /** Whether slicer is in disconnected state (source column deleted) */
    isDisconnected: boolean;
  };
  // Use `any` for state parameter to be compatible with XState's specific union type
  matches(state: any): boolean;
  value: string;
}

// =============================================================================
// SELECTORS - Moved to @mog-sdk/kernel/selectors
// Import from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACCESSOR INTERFACE (mirrors selectors 1:1 for handlers)
// =============================================================================

export interface SlicerAccessor {
  // Value accessors
  getSlicerId(): string | null;
  getSheetId(): SheetId | null;
  getLastClickedValue(): CellValue | undefined;
  getHoveredValue(): CellValue | undefined;
  getIsMultiSelectActive(): boolean;
  getErrorMessage(): string | null;

  // State matching accessors
  isIdle(): boolean;
  isHovering(): boolean;
  isMultiSelecting(): boolean;
  isDragging(): boolean;
  isResizing(): boolean;
  isDisconnectedState(): boolean;

  // Derived accessors
  isDisconnected(): boolean;
  hasFocusedSlicer(): boolean;
  getMachineState(): string;
}

// =============================================================================
// COMMANDS INTERFACE
// =============================================================================

export interface SlicerCommands {
  // Focus events
  focusSlicer(slicerId: string, sheetId: SheetId): void;
  blurSlicer(): void;

  // Mouse events
  mouseEnter(slicerId: string): void;
  mouseLeave(): void;
  itemClick(
    value: CellValue,
    modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
  ): void;
  itemHover(value: CellValue): void;
  itemHoverEnd(): void;
  clearAllClick(): void;

  // Keyboard events
  keyDown(key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean }): void;
  keyUp(key: string): void;

  // Delegation events
  dragStart(): void;
  dragEnd(newPosition?: { x: number; y: number }): void;
  resizeStart(): void;
  resizeEnd(newSize?: { width: number; height: number }): void;

  // External update events
  filterChanged(slicerId: string, selectedValues: CellValue[]): void;
  cacheRefreshed(slicerId: string): void;
  remoteUpdate(slicerId: string): void;
  disconnected(slicerId: string, reason: 'columnDeleted' | 'tableDeleted' | 'pivotDeleted'): void;
  reconnected(slicerId: string): void;
  selectionCommitted(selectedValues: CellValue[]): void;
}

// =============================================================================
// EVENT TYPES (for XState machine events)
// =============================================================================

/**
 * Slicer machine event union type.
 * These are the events that can be sent to the slicer state machine.
 */
export type SlicerEvent =
  // Focus events
  | { type: 'FOCUS_SLICER'; slicerId: string; sheetId: SheetId }
  | { type: 'BLUR_SLICER' }
  // Mouse events
  | { type: 'MOUSE_ENTER'; slicerId: string }
  | { type: 'MOUSE_LEAVE' }
  | {
      type: 'ITEM_CLICK';
      value: CellValue;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    }
  | { type: 'ITEM_HOVER'; value: CellValue }
  | { type: 'ITEM_HOVER_END' }
  | { type: 'CLEAR_ALL_CLICK' }
  // Keyboard events
  | { type: 'KEY_DOWN'; key: string; ctrlKey: boolean; metaKey: boolean }
  | { type: 'KEY_UP'; key: string }
  // Delegation events (to/from object-interaction-machine)
  | { type: 'DRAG_START' }
  | { type: 'DRAG_END'; newPosition?: { x: number; y: number } }
  | { type: 'RESIZE_START' }
  | { type: 'RESIZE_END'; newSize?: { width: number; height: number } }
  // External update events
  | {
      type: 'FILTER_CHANGED';
      slicerId: string;
      selectedValues: CellValue[];
    }
  | { type: 'CACHE_REFRESHED'; slicerId: string }
  | { type: 'REMOTE_UPDATE'; slicerId: string }
  | {
      type: 'DISCONNECTED';
      slicerId: string;
      reason: 'columnDeleted' | 'tableDeleted' | 'pivotDeleted';
    }
  | { type: 'RECONNECTED'; slicerId: string }
  // Selection committed (for bridge to apply filter)
  | { type: 'SELECTION_COMMITTED'; selectedValues: CellValue[] };

// =============================================================================
// EVENT FACTORY - Moved to @mog-sdk/kernel/selectors
// Import SlicerEvents from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACTOR INTERFACE (minimal interface for bridges)
// =============================================================================

/**
 * Minimal SlicerActor interface for bridges.
 * This allows bridges to send events to the slicer machine without
 * depending on the full XState implementation.
 */
export interface SlicerActor {
  /** Send an event to the slicer machine */
  send(event: SlicerEvent): void;
}
