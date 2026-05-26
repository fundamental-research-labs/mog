/**
 * Ink Hooks
 *
 * React hooks for accessing ink/drawing state from the UIStore ink slice.
 * These hooks provide convenient access to ink mode state and actions.
 *
 * Wave 5: Ink Actions & UI System
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { InkTool, SelectionMode, StrokeId } from '@mog-sdk/contracts/ink';

import { useStore } from 'zustand';
import { useDocumentContext } from '../../infra/context';

// =============================================================================
// Individual State Hooks
// =============================================================================

/**
 * Check if ink mode is currently active.
 */
export function useInkActive(): boolean {
  const { uiStore } = useDocumentContext();
  return useStore(uiStore, (s) => s.inkModeActive);
}

/**
 * Get the ID of the currently active drawing.
 */
export function useActiveDrawingId(): string | null {
  const { uiStore } = useDocumentContext();
  return useStore(uiStore, (s) => s.activeDrawingId);
}

/**
 * Get the currently selected ink tool.
 */
export function useInkTool(): InkTool {
  const { uiStore } = useDocumentContext();
  return useStore(uiStore, (s) => s.activeTool);
}

/**
 * Get the current stroke color.
 */
export function useInkColor(): string {
  const { uiStore } = useDocumentContext();
  return useStore(uiStore, (s) => s.strokeColor);
}

/**
 * Get the current stroke width.
 */
export function useInkWidth(): number {
  const { uiStore } = useDocumentContext();
  return useStore(uiStore, (s) => s.strokeWidth);
}

/**
 * Get the current stroke opacity.
 */
export function useInkOpacity(): number {
  const { uiStore } = useDocumentContext();
  return useStore(uiStore, (s) => s.strokeOpacity);
}

/**
 * Check if the user is currently stroking (pen down).
 */
export function useIsStroking(): boolean {
  const { uiStore } = useDocumentContext();
  return useStore(uiStore, (s) => s.isStroking);
}

/**
 * Check if the user is currently erasing.
 */
export function useIsErasing(): boolean {
  const { uiStore } = useDocumentContext();
  return useStore(uiStore, (s) => s.isErasing);
}

/**
 * Get the current selection mode (lasso or rectangle).
 */
export function useSelectionMode(): SelectionMode {
  const { uiStore } = useDocumentContext();
  return useStore(uiStore, (s) => s.selectionMode);
}

/**
 * Check if selection mode is active (vs drawing mode).
 */
export function useIsSelectionModeActive(): boolean {
  const { uiStore } = useDocumentContext();
  return useStore(uiStore, (s) => s.isSelectionModeActive);
}

/**
 * Get the Set of currently selected stroke IDs.
 */
export function useSelectedStrokeIds(): Set<StrokeId> {
  const { uiStore } = useDocumentContext();
  return useStore(uiStore, (s) => s.selectedStrokeIds);
}

/**
 * Check if there are any selected strokes.
 */
export function useHasSelection(): boolean {
  const { uiStore } = useDocumentContext();
  return useStore(uiStore, (s) => s.selectedStrokeIds.size > 0);
}

/**
 * Get the count of selected strokes.
 */
export function useSelectedStrokeCount(): number {
  const { uiStore } = useDocumentContext();
  return useStore(uiStore, (s) => s.selectedStrokeIds.size);
}

// =============================================================================
// Combined State Hooks
// =============================================================================

/**
 * Return type for useInkToolSettings hook.
 */
export interface InkToolSettings {
  tool: InkTool;
  color: string;
  width: number;
  opacity: number;
}

/**
 * Get all ink tool settings at once.
 * Useful for the toolbar to display current settings.
 */
export function useInkToolSettings(): InkToolSettings {
  const { uiStore } = useDocumentContext();
  return useStore(
    uiStore,
    useShallow((s) => ({
      tool: s.activeTool,
      color: s.strokeColor,
      width: s.strokeWidth,
      opacity: s.strokeOpacity,
    })),
  );
}

/**
 * Return type for useInkState hook.
 */
export interface InkState {
  // Mode
  isActive: boolean;
  activeDrawingId: string | null;

  // Tool settings
  tool: InkTool;
  color: string;
  width: number;
  opacity: number;

  // Selection
  selectionMode: SelectionMode;
  isSelectionModeActive: boolean;
  selectedStrokeIds: Set<StrokeId>;
  hasSelection: boolean;

  // Drawing state
  isStroking: boolean;
  isErasing: boolean;
}

/**
 * Get the complete ink state.
 * Useful when you need multiple values at once.
 */
export function useInkState(): InkState {
  const { uiStore } = useDocumentContext();
  return useStore(
    uiStore,
    useShallow((s) => ({
      // Mode
      isActive: s.inkModeActive,
      activeDrawingId: s.activeDrawingId,

      // Tool settings
      tool: s.activeTool,
      color: s.strokeColor,
      width: s.strokeWidth,
      opacity: s.strokeOpacity,

      // Selection
      selectionMode: s.selectionMode,
      isSelectionModeActive: s.isSelectionModeActive,
      selectedStrokeIds: s.selectedStrokeIds,
      hasSelection: s.selectedStrokeIds.size > 0,

      // Drawing state
      isStroking: s.isStroking,
      isErasing: s.isErasing,
    })),
  );
}

// =============================================================================
// Action Hooks
// =============================================================================

/**
 * Return type for useInkActions hook.
 */
export interface InkActions {
  // Mode activation
  activateInkMode: (drawingId: string) => void;
  deactivateInkMode: () => void;

  // Tool settings
  setActiveTool: (tool: InkTool) => void;
  setStrokeColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setStrokeOpacity: (opacity: number) => void;

  // Selection
  toggleSelectionMode: () => void;
  setSelectionModeActive: (active: boolean) => void;
  setSelectionModeType: (mode: SelectionMode) => void;
  selectStroke: (strokeId: StrokeId) => void;
  deselectStroke: (strokeId: StrokeId) => void;
  toggleStrokeSelection: (strokeId: StrokeId) => void;
  selectStrokes: (strokeIds: StrokeId[]) => void;
  clearStrokeSelection: () => void;

  // Drawing state
  setStroking: (isStroking: boolean) => void;
  setErasing: (isErasing: boolean) => void;
}

/**
 * Get ink actions for modifying ink state.
 *
 * NOTE: These actions only modify the UIStore state.
 * For persistent operations (add stroke, clear drawing), use dispatch() instead.
 */
export function useInkActions(): InkActions {
  const { uiStore } = useDocumentContext();
  return useStore(
    uiStore,
    useShallow((s) => ({
      // Mode activation
      activateInkMode: s.activateInkMode,
      deactivateInkMode: s.deactivateInkMode,

      // Tool settings
      setActiveTool: s.setActiveTool,
      setStrokeColor: s.setStrokeColor,
      setStrokeWidth: s.setStrokeWidth,
      setStrokeOpacity: s.setStrokeOpacity,

      // Selection
      toggleSelectionMode: s.toggleSelectionMode,
      setSelectionModeActive: s.setSelectionModeActive,
      setSelectionModeType: s.setSelectionModeType,
      selectStroke: s.selectStroke,
      deselectStroke: s.deselectStroke,
      toggleStrokeSelection: s.toggleStrokeSelection,
      selectStrokes: s.selectStrokes,
      clearStrokeSelection: s.clearStrokeSelection,

      // Drawing state
      setStroking: s.setStroking,
      setErasing: s.setErasing,
    })),
  );
}

// =============================================================================
// Combined Hook
// =============================================================================

/**
 * Return type for useInk hook.
 */
export interface UseInkReturn extends InkState, InkActions {}

/**
 * Main ink hook combining state and actions.
 *
 * @example
 * ```tsx
 * function InkToolbar() {
 * const {
 * isActive,
 * tool,
 * color,
 * width,
 * hasSelection,
 * setActiveTool,
 * setStrokeColor
 * } = useInk;
 *
 * if (!isActive) return null;
 *
 * return (
 * <div>
 * <ToolSelector value={tool} onChange={setActiveTool} />
 * <ColorPicker value={color} onChange={setStrokeColor} />
 * {hasSelection && <DeleteButton />}
 * </div>
 * );
 * }
 * ```
 */
export function useInk(): UseInkReturn {
  const state = useInkState();
  const actions = useInkActions();

  return useMemo(
    () => ({
      ...state,
      ...actions,
    }),
    [state, actions],
  );
}
