/**
 * Slicer Actor Selectors & Event Factories
 *
 * Pure functions that extract data from slicer state,
 * plus type-safe event factory functions.
 * Moved from contracts to kernel (contracts holds types only).
 *
 * @module @mog-sdk/kernel/selectors
 */

import type { SlicerEvent, SlicerState } from '@mog-sdk/contracts/actors/slicer';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';

export { type SlicerEvent, type SlicerState } from '@mog-sdk/contracts/actors/slicer';

export const slicerSelectors = {
  // ---------------------------------------------------------------------------
  // Value selectors
  // ---------------------------------------------------------------------------
  slicerId: (state: SlicerState) => state.context.slicerId,
  sheetId: (state: SlicerState) => state.context.sheetId,
  lastClickedValue: (state: SlicerState) => state.context.lastClickedValue,
  hoveredValue: (state: SlicerState) => state.context.hoveredValue,
  isMultiSelectActive: (state: SlicerState): boolean => state.context.isMultiSelectActive,
  errorMessage: (state: SlicerState) => state.context.errorMessage,

  // ---------------------------------------------------------------------------
  // State matching selectors
  // ---------------------------------------------------------------------------
  isIdle: (state: SlicerState): boolean => state.matches('idle'),
  isHovering: (state: SlicerState): boolean => state.matches('hovering'),
  isMultiSelecting: (state: SlicerState): boolean => state.matches('multiSelecting'),
  isDragging: (state: SlicerState): boolean => state.matches('delegatingDrag'),
  isResizing: (state: SlicerState): boolean => state.matches('delegatingResize'),
  isDisconnectedState: (state: SlicerState): boolean => state.matches('disconnected'),

  // ---------------------------------------------------------------------------
  // Derived selectors
  // ---------------------------------------------------------------------------
  isDisconnected: (state: SlicerState): boolean =>
    state.matches('disconnected') || state.context.isDisconnected,

  /** Check if a slicer is currently focused */
  hasFocusedSlicer: (state: SlicerState): boolean => state.context.slicerId !== null,

  /** Get the current machine state value */
  machineState: (state: SlicerState): string => state.value,
};

/**
 * Type-safe event factories for the slicer machine.
 * Use these instead of inline object literals to prevent magic string drift.
 */
export const SlicerEvents = {
  focusSlicer: (slicerId: string, sheetId: SheetId): SlicerEvent => ({
    type: 'FOCUS_SLICER',
    slicerId,
    sheetId,
  }),

  blurSlicer: (): SlicerEvent => ({
    type: 'BLUR_SLICER',
  }),

  mouseEnter: (slicerId: string): SlicerEvent => ({
    type: 'MOUSE_ENTER',
    slicerId,
  }),

  mouseLeave: (): SlicerEvent => ({
    type: 'MOUSE_LEAVE',
  }),

  itemClick: (
    value: CellValue,
    modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
  ): SlicerEvent => ({
    type: 'ITEM_CLICK',
    value,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
  }),

  itemHover: (value: CellValue): SlicerEvent => ({
    type: 'ITEM_HOVER',
    value,
  }),

  itemHoverEnd: (): SlicerEvent => ({
    type: 'ITEM_HOVER_END',
  }),

  clearAllClick: (): SlicerEvent => ({
    type: 'CLEAR_ALL_CLICK',
  }),

  keyDown: (
    key: string,
    modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {},
  ): SlicerEvent => ({
    type: 'KEY_DOWN',
    key,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
  }),

  keyUp: (key: string): SlicerEvent => ({
    type: 'KEY_UP',
    key,
  }),

  dragStart: (): SlicerEvent => ({
    type: 'DRAG_START',
  }),

  dragEnd: (newPosition?: { x: number; y: number }): SlicerEvent => ({
    type: 'DRAG_END',
    newPosition,
  }),

  resizeStart: (): SlicerEvent => ({
    type: 'RESIZE_START',
  }),

  resizeEnd: (newSize?: { width: number; height: number }): SlicerEvent => ({
    type: 'RESIZE_END',
    newSize,
  }),

  filterChanged: (slicerId: string, selectedValues: CellValue[]): SlicerEvent => ({
    type: 'FILTER_CHANGED',
    slicerId,
    selectedValues,
  }),

  cacheRefreshed: (slicerId: string): SlicerEvent => ({
    type: 'CACHE_REFRESHED',
    slicerId,
  }),

  remoteUpdate: (slicerId: string): SlicerEvent => ({
    type: 'REMOTE_UPDATE',
    slicerId,
  }),

  disconnected: (
    slicerId: string,
    reason: 'columnDeleted' | 'tableDeleted' | 'pivotDeleted',
  ): SlicerEvent => ({
    type: 'DISCONNECTED',
    slicerId,
    reason,
  }),

  reconnected: (slicerId: string): SlicerEvent => ({
    type: 'RECONNECTED',
    slicerId,
  }),

  selectionCommitted: (selectedValues: CellValue[]): SlicerEvent => ({
    type: 'SELECTION_COMMITTED',
    selectedValues,
  }),
} as const;
