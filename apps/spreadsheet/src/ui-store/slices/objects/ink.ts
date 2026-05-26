/**
 * Ink Slice
 *
 * Manages ephemeral UI state for the ink/drawing feature.
 * This includes ink mode activation, tool selection, selection state,
 * and other transient drawing UI state.
 *
 * Wave 5: Ink Actions & UI System
 */

import type { StateCreator } from 'zustand';

import type { InkTool, SelectionMode, StrokeId } from '@mog-sdk/contracts/ink';

/**
 * Ink slice state
 */
export interface InkSliceState {
  /** Whether ink mode is currently active */
  inkModeActive: boolean;

  /** ID of the currently active drawing (for editing) */
  activeDrawingId: string | null;

  /** Currently selected tool */
  activeTool: InkTool;

  /** Current stroke color */
  strokeColor: string;

  /** Current stroke width */
  strokeWidth: number;

  /** Current stroke opacity */
  strokeOpacity: number;

  /** Selection mode (lasso or rectangle) */
  selectionMode: SelectionMode;

  /** Whether selection mode is active (vs drawing mode) */
  isSelectionModeActive: boolean;

  /** IDs of currently selected strokes */
  selectedStrokeIds: Set<StrokeId>;

  /** Whether the user is currently stroking (pen down) */
  isStroking: boolean;

  /** Whether the user is currently erasing */
  isErasing: boolean;
}

/**
 * Ink slice actions
 */
export interface InkSliceActions {
  /** Activate ink mode for a drawing */
  activateInkMode: (drawingId: string) => void;

  /** Deactivate ink mode */
  deactivateInkMode: () => void;

  /** Set the active tool */
  setActiveTool: (tool: InkTool) => void;

  /** Set the stroke color */
  setStrokeColor: (color: string) => void;

  /** Set the stroke width */
  setStrokeWidth: (width: number) => void;

  /** Set the stroke opacity */
  setStrokeOpacity: (opacity: number) => void;

  /** Toggle selection mode (lasso/rectangle) */
  toggleSelectionMode: () => void;

  /** Set selection mode active/inactive */
  setSelectionModeActive: (active: boolean) => void;

  /** Set the selection mode type */
  setSelectionModeType: (mode: SelectionMode) => void;

  /** Select a stroke */
  selectStroke: (strokeId: StrokeId) => void;

  /** Deselect a stroke */
  deselectStroke: (strokeId: StrokeId) => void;

  /** Toggle stroke selection */
  toggleStrokeSelection: (strokeId: StrokeId) => void;

  /** Select multiple strokes */
  selectStrokes: (strokeIds: StrokeId[]) => void;

  /** Clear all stroke selection */
  clearStrokeSelection: () => void;

  /** Set stroking state */
  setStroking: (isStroking: boolean) => void;

  /** Set erasing state */
  setErasing: (isErasing: boolean) => void;
}

/**
 * Combined ink slice type
 */
export type InkSlice = InkSliceState & InkSliceActions;

/**
 * Default ink state
 */
const initialInkState: InkSliceState = {
  inkModeActive: false,
  activeDrawingId: null,
  activeTool: 'pen',
  strokeColor: '#000000',
  strokeWidth: 2,
  strokeOpacity: 1.0,
  selectionMode: 'lasso',
  isSelectionModeActive: false,
  selectedStrokeIds: new Set(),
  isStroking: false,
  isErasing: false,
};

/**
 * Create ink slice
 */
export const createInkSlice: StateCreator<InkSlice, [], [], InkSlice> = (set) => ({
  ...initialInkState,

  activateInkMode: (drawingId: string) => {
    set({
      inkModeActive: true,
      activeDrawingId: drawingId,
      // Reset selection when entering ink mode
      selectedStrokeIds: new Set(),
      isSelectionModeActive: false,
    });
  },

  deactivateInkMode: () => {
    set({
      inkModeActive: false,
      activeDrawingId: null,
      selectedStrokeIds: new Set(),
      isSelectionModeActive: false,
      isStroking: false,
      isErasing: false,
    });
  },

  setActiveTool: (tool: InkTool) => {
    set({
      activeTool: tool,
      // Exit selection mode when switching to a drawing tool
      isSelectionModeActive: false,
    });
  },

  setStrokeColor: (color: string) => {
    set({ strokeColor: color });
  },

  setStrokeWidth: (width: number) => {
    set({ strokeWidth: Math.max(1, Math.min(100, width)) });
  },

  setStrokeOpacity: (opacity: number) => {
    set({ strokeOpacity: Math.max(0, Math.min(1, opacity)) });
  },

  toggleSelectionMode: () => {
    set((state) => ({
      isSelectionModeActive: !state.isSelectionModeActive,
    }));
  },

  setSelectionModeActive: (active: boolean) => {
    set({ isSelectionModeActive: active });
  },

  setSelectionModeType: (mode: SelectionMode) => {
    set({ selectionMode: mode });
  },

  selectStroke: (strokeId: StrokeId) => {
    set((state) => {
      const newSelection = new Set(state.selectedStrokeIds);
      newSelection.add(strokeId);
      return { selectedStrokeIds: newSelection };
    });
  },

  deselectStroke: (strokeId: StrokeId) => {
    set((state) => {
      const newSelection = new Set(state.selectedStrokeIds);
      newSelection.delete(strokeId);
      return { selectedStrokeIds: newSelection };
    });
  },

  toggleStrokeSelection: (strokeId: StrokeId) => {
    set((state) => {
      const newSelection = new Set(state.selectedStrokeIds);
      if (newSelection.has(strokeId)) {
        newSelection.delete(strokeId);
      } else {
        newSelection.add(strokeId);
      }
      return { selectedStrokeIds: newSelection };
    });
  },

  selectStrokes: (strokeIds: StrokeId[]) => {
    set({ selectedStrokeIds: new Set(strokeIds) });
  },

  clearStrokeSelection: () => {
    set({ selectedStrokeIds: new Set() });
  },

  setStroking: (isStroking: boolean) => {
    set({ isStroking });
  },

  setErasing: (isErasing: boolean) => {
    set({ isErasing });
  },
});

// =============================================================================
// Selectors
// =============================================================================

/**
 * Check if ink mode is active
 */
export function selectInkModeActive(state: InkSlice): boolean {
  return state.inkModeActive;
}

/**
 * Get the active drawing ID
 */
export function selectActiveDrawingId(state: InkSlice): string | null {
  return state.activeDrawingId;
}

/**
 * Get the currently selected tool
 */
export function selectActiveTool(state: InkSlice): InkTool {
  return state.activeTool;
}

/**
 * Check if there are any selected strokes
 */
export function selectHasSelectedStrokes(state: InkSlice): boolean {
  return state.selectedStrokeIds.size > 0;
}

/**
 * Get the count of selected strokes
 */
export function selectSelectedStrokeCount(state: InkSlice): number {
  return state.selectedStrokeIds.size;
}

/**
 * Get the array of selected stroke IDs
 */
export function selectSelectedStrokeIdsArray(state: InkSlice): StrokeId[] {
  return Array.from(state.selectedStrokeIds);
}
