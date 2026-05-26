/**
 * Cursor Manager Hook
 *
 * Manages cursor style computation based on current grid interaction state.
 * Uses direct DOM manipulation for high-frequency updates to avoid React re-renders.
 *
 * This is a performance-critical hook that:
 * 1. Computes cursor style based on format painter, object interaction, and hit test state
 * 2. Updates cursor directly on DOM (not React state) for performance
 * 3. Returns stable callback references to prevent re-renders
 *
 * @see use-grid-mouse.ts - Main hook that uses this
 */

import { useCallback, useMemo, useRef } from 'react';

import type { ObjectHitRegion } from '@mog-sdk/contracts/floating-objects';
import type { InkTool } from '@mog-sdk/contracts/ink';
import { FORMAT_PAINTER_CURSOR, getInkCursor } from '../../infra/styles/cursors';

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies required by the cursor manager hook.
 * These are passed in to allow flexibility and testability.
 */
export interface CursorManagerDeps {
  /**
   * Container element ref for direct DOM cursor updates.
   * Cursor is set directly on this element for performance.
   */
  containerRef: React.RefObject<HTMLDivElement | null>;

  /**
   * Format painter state from UIStore.
   * When active, shows the format painter cursor.
   */
  formatPainter: {
    isActive: boolean;
  };

  /**
   * Ink mode state from UIStore.
   * When active, shows the appropriate ink tool cursor.
   */
  ink: {
    isActive: boolean;
    tool: InkTool;
  };

  /**
   * Object interaction state for floating objects.
   * Used to determine cursor during drag/resize/rotate operations.
   */
  objectInteraction: {
    isDragging: boolean;
    isResizing: boolean;
    isRotating: boolean;
    activeHandle: ObjectHitRegion | null;
    getCursor: (handle: ObjectHitRegion | null) => string;
  };
}

/**
 * Return value from the useCursorManager hook.
 */
export interface UseCursorManagerReturn {
  /**
   * Current cursor style based on state.
   * This is a computed value for use in React's style prop as a fallback.
   * For performance, prefer using updateCursor() for high-frequency updates.
   */
  cursor: string | undefined;

  /**
   * Update cursor directly on DOM.
   * This is the performance-optimized path - no React re-render.
   *
   * @param cursorStyle - The CSS cursor value to set (e.g., 'pointer', 'col-resize')
   */
  updateCursor: (cursorStyle: string) => void;

  /**
   * Update cursor based on object hit result.
   * Sets cursor for floating object handles (resize, rotate, move).
   *
   * @param handle - The object hit region, or null to clear
   */
  updateCursorFromObjectHit: (handle: ObjectHitRegion | null) => void;

  /**
   * Reset cursor to default.
   * Clears any custom cursor set on the container.
   */
  resetCursor: () => void;

  /**
   * Ref holding the currently hovered object handle.
   * Use this to track state across mouse moves without causing re-renders.
   */
  hoveredHandleRef: React.MutableRefObject<ObjectHitRegion | null>;
}

// =============================================================================
// Cursor Style Constants
// =============================================================================

/**
 * Common cursor styles used throughout the grid.
 * These are CSS cursor values.
 */
export const CURSOR_STYLES = {
  /** Default cursor */
  DEFAULT: '',
  /** For dragging objects */
  GRABBING: 'grabbing',
  /** For hovering over draggable elements */
  MOVE: 'move',
  /** For copy operations (Ctrl+drag) */
  COPY: 'copy',
  /** For column resize */
  COL_RESIZE: 'col-resize',
  /** For row resize */
  ROW_RESIZE: 'row-resize',
  /** For fill handle */
  CROSSHAIR: 'crosshair',
  /** For clickable elements like hyperlinks */
  POINTER: 'pointer',
  /** For invalid drop targets */
  NOT_ALLOWED: 'not-allowed',
  /** For NW-SE resize handles */
  NWSE_RESIZE: 'nwse-resize',
  /** For NE-SW resize handles */
  NESW_RESIZE: 'nesw-resize',
} as const;

export type CursorStyle = (typeof CURSOR_STYLES)[keyof typeof CURSOR_STYLES];

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for managing cursor style in the grid.
 *
 * This hook provides:
 * 1. A computed cursor value for React state (fallback)
 * 2. A stable callback for direct DOM updates (performance path)
 * 3. A ref for tracking hovered handles without re-renders
 *
 * Performance Pattern:
 * The cursor is updated directly on the DOM element for high-frequency
 * mouse move events. This avoids React re-renders that would otherwise
 * occur on every mouse movement.
 *
 * @example
 * ```tsx
 * function GridContainer() {
 * const containerRef = useRef<HTMLDivElement>(null);
 * const formatPainter = useUIStore(s => s.formatPainter);
 * const objectInteraction = useObjectInteraction;
 *
 * const {
 * cursor,
 * updateCursor,
 * updateCursorFromObjectHit,
 * hoveredHandleRef
 * } = useCursorManager({
 * containerRef,
 * formatPainter,
 * objectInteraction
 * });
 *
 * const handleMouseMove = useCallback((e: MouseEvent) => {
 * const hit = hitTest(e.clientX, e.clientY);
 *
 * if (hit?.type === 'columnResize') {
 * updateCursor('col-resize');
 * } else if (hit?.type === 'floatingObject') {
 * updateCursorFromObjectHit(hit.handle);
 * } else {
 * updateCursor('');
 * }
 * }, [updateCursor, updateCursorFromObjectHit]);
 *
 * return (
 * <div
 * ref={containerRef}
 * style={{ cursor }}
 * onMouseMove={handleMouseMove}
 * />
 * );
 * }
 * ```
 */
export function useCursorManager(deps: CursorManagerDeps): UseCursorManagerReturn {
  const { containerRef, formatPainter, ink, objectInteraction } = deps;

  // Track hovered handle for cursor feedback without re-renders
  const hoveredHandleRef = useRef<ObjectHitRegion | null>(null);

  // ===========================================================================
  // Cursor Update Callbacks (Direct DOM Manipulation)
  // ===========================================================================

  /**
   * Update cursor directly on DOM element.
   * This is the performance-optimized path for high-frequency updates.
   */
  const updateCursor = useCallback(
    (cursorStyle: string) => {
      if (containerRef.current) {
        containerRef.current.style.cursor = cursorStyle;
      }
    },
    [containerRef],
  );

  /**
   * Update cursor based on floating object hit result.
   * Also updates the hoveredHandleRef for tracking.
   */
  const updateCursorFromObjectHit = useCallback(
    (handle: ObjectHitRegion | null) => {
      // Only update if handle changed
      if (hoveredHandleRef.current !== handle) {
        hoveredHandleRef.current = handle;

        if (containerRef.current) {
          containerRef.current.style.cursor = handle
            ? objectInteraction.getCursor(handle)
            : CURSOR_STYLES.DEFAULT;
        }
      }
    },
    [containerRef, objectInteraction],
  );

  /**
   * Reset cursor to default.
   */
  const resetCursor = useCallback(() => {
    hoveredHandleRef.current = null;
    if (containerRef.current) {
      containerRef.current.style.cursor = CURSOR_STYLES.DEFAULT;
    }
  }, [containerRef]);

  // ===========================================================================
  // Computed Cursor (React State Fallback)
  // ===========================================================================

  /**
   * Compute cursor style based on current state.
   *
   * Priority order:
   * 1. Ink mode -> appropriate ink tool cursor (pen dot, highlighter, eraser)
   * 2. Format painter mode -> custom paintbrush cursor
   * 3. Object dragging -> grabbing cursor
   * 4. Object resizing/rotating -> appropriate resize cursor
   * 5. Hovered object handle -> appropriate cursor
   * 6. Default -> undefined (no cursor override)
   *
   * Note: This is primarily used as a React fallback.
   * High-frequency updates should use updateCursor() directly.
   */
  const cursor = useMemo(() => {
    // DEBUG: Trace cursor computation
    console.log('[useCursorManager] cursor computation:', {
      inkIsActive: ink.isActive,
      inkTool: ink.tool,
      formatPainterActive: formatPainter.isActive,
    });

    // 1. Ink mode cursor (highest priority when in drawing mode)
    if (ink.isActive) {
      const inkCursor = getInkCursor(ink.tool);
      console.log('[useCursorManager] returning ink cursor:', inkCursor?.slice(0, 50) + '...');
      return inkCursor;
    }

    // 2. Format Painter cursor
    if (formatPainter.isActive) {
      return FORMAT_PAINTER_CURSOR;
    }

    // 3. Object dragging
    if (objectInteraction.isDragging) {
      return CURSOR_STYLES.GRABBING;
    }

    // 4. Object resizing or rotating
    if (objectInteraction.isResizing || objectInteraction.isRotating) {
      return objectInteraction.getCursor(objectInteraction.activeHandle);
    }

    // 5. Hovered object handle (set via ref, included for React re-renders)
    if (hoveredHandleRef.current) {
      return objectInteraction.getCursor(hoveredHandleRef.current);
    }

    // 6. Default - no cursor override
    return undefined;
  }, [ink.isActive, ink.tool, formatPainter.isActive, objectInteraction]);

  // ===========================================================================
  // Return Value
  // ===========================================================================

  return useMemo(
    () => ({
      cursor,
      updateCursor,
      updateCursorFromObjectHit,
      resetCursor,
      hoveredHandleRef,
    }),
    [cursor, updateCursor, updateCursorFromObjectHit, resetCursor],
  );
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get cursor style for a given hit test result type.
 * This is a pure helper function for use outside the hook.
 *
 * @param hitType - The type of hit test result
 * @param modifiers - Optional modifier keys state
 * @returns The appropriate cursor style
 */
export function getCursorForHitType(
  hitType:
    | 'columnResize'
    | 'rowResize'
    | 'fillHandle'
    | 'selectionBorder'
    | 'hyperlink'
    | 'tableResize'
    | 'hiddenColumnBoundary'
    | 'hiddenRowBoundary'
    | 'validationDropdown',
  modifiers?: { ctrlKey?: boolean; metaKey?: boolean },
): string {
  const isCtrlHeld = modifiers?.ctrlKey || modifiers?.metaKey;

  switch (hitType) {
    case 'columnResize':
    case 'hiddenColumnBoundary':
      return CURSOR_STYLES.COL_RESIZE;

    case 'rowResize':
    case 'hiddenRowBoundary':
      return CURSOR_STYLES.ROW_RESIZE;

    case 'fillHandle':
      return isCtrlHeld ? CURSOR_STYLES.COPY : CURSOR_STYLES.CROSSHAIR;

    case 'selectionBorder':
      return isCtrlHeld ? CURSOR_STYLES.COPY : CURSOR_STYLES.MOVE;

    case 'hyperlink':
    case 'validationDropdown':
      return CURSOR_STYLES.POINTER;

    case 'tableResize':
      return CURSOR_STYLES.NWSE_RESIZE;

    default:
      return CURSOR_STYLES.DEFAULT;
  }
}

/**
 * Get cursor for drag operation state.
 *
 * @param isDragging - Whether a drag operation is in progress
 * @param isValidTarget - Whether the current position is a valid drop target
 * @param isCopyMode - Whether Ctrl/Cmd is held for copy mode
 * @returns The appropriate cursor style
 */
export function getCursorForDrag(
  isDragging: boolean,
  isValidTarget: boolean,
  isCopyMode: boolean,
): string {
  if (!isDragging) {
    return CURSOR_STYLES.DEFAULT;
  }

  if (!isValidTarget) {
    return CURSOR_STYLES.NOT_ALLOWED;
  }

  return isCopyMode ? CURSOR_STYLES.COPY : CURSOR_STYLES.MOVE;
}
