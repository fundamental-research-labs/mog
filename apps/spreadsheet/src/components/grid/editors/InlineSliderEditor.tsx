/**
 * Inline Slider Editor Component
 *
 * Renders a slider control for bounded number cells (integer/number with min/max constraints).
 * The slider replaces the normal text input when appropriate.
 *
 * This is an inline editor (not a popup) that appears in place of the text input.
 *
 * Slider cells render SliderEditor instead of text input
 *
 * Extracted from SpreadsheetGrid.tsx as part of Editor Overlay Decomposition
 *
 * Performance optimization: Uses granular hooks internally to avoid
 * identity-selector re-renders from parent components.
 */

import { useSelector } from '@xstate/react';
import { useMemo, useRef } from 'react';

import { editorSelectors } from '../../../selectors';
import type { CellSchema } from '@mog-sdk/contracts/schema';
import {
  useCoordinator,
  useDispatch,
  useEditorActions,
  useEditorState,
  useRendererActions,
  useScrollSyncTransform,
} from '../../../hooks';
import { COMMIT_ACTION_FOR } from '../../../actions/handlers/editor';
import { SliderEditor } from '../SliderEditor';

// =============================================================================
// Types
// =============================================================================

/**
 * Internal state slice for slider editor.
 * Only subscribes to cellSchema, avoiding identity selector re-renders.
 */
interface SliderStateSlice {
  cellSchema: CellSchema | null;
}

// =============================================================================
// Equality Function
// =============================================================================

/**
 * Custom equality function for slider state comparison.
 */
function sliderStateEqual(a: SliderStateSlice, b: SliderStateSlice): boolean {
  // For cellSchema, compare reference since schema objects are stable per cell
  return a.cellSchema === b.cellSchema;
}

// =============================================================================
// Component
// =============================================================================

export function InlineSliderEditor() {
  // Get coordinator for editor actor access (needed for additional selectors)
  const coordinator = useCoordinator();
  const editorActor = coordinator.grid.access.actors.editor;

  // Use granular hooks internally for better performance
  const editorState = useEditorState();
  const editorActions = useEditorActions();
  const rendererActions = useRendererActions();
  const dispatch = useDispatch();

  // Subscribe to cellSchema using custom selector (not in useEditorState)
  const additionalState = useSelector(
    editorActor,
    (state): SliderStateSlice => ({
      cellSchema: editorSelectors.cellSchema(state),
    }),
    sliderStateEqual,
  );

  // Derive isSliderCell from editorType
  const isSliderCell = editorState.editorType === 'slider';

  // Compute cell rectangle for positioning (memoized to avoid unnecessary recalculations)
  const cellRect = useMemo(() => {
    if (!isSliderCell || !editorState.editingCell || !editorState.sheetId) {
      return null;
    }

    // Need coordinate system for positioning
    const geometry = rendererActions.getGeometry();
    if (!geometry) return null;

    // For merged cells, use the merged bounds for editor sizing
    if (editorState.mergeBounds) {
      // getRangeRects returns array (for frozen panes), use first rect
      const rects = geometry.getRangeRects(editorState.mergeBounds);
      return rects[0] ?? null;
    } else {
      return geometry.getCellRect(editorState.editingCell);
    }
  }, [
    isSliderCell,
    editorState.editingCell,
    editorState.sheetId,
    editorState.mergeBounds,
    rendererActions,
  ]);

  // Scroll sync: wrapper div ref and imperative transform hook
  const scrollSyncRef = useRef<HTMLDivElement>(null);
  useScrollSyncTransform(
    scrollSyncRef,
    editorState.sheetId,
    editorState.editingCell,
    editorState.mergeBounds,
    cellRect ? { x: cellRect.x, y: cellRect.y } : null,
  );

  // Early return if conditions not met
  // Note: We render regardless of focusLocation - when editing via formula bar,
  // the inline editor should still be visible (Excel parity), just without focus.
  if (!editorState.isEditing || !editorState.editingCell || !isSliderCell) {
    return null;
  }

  // Check that we have valid min/max constraints
  if (!additionalState.cellSchema?.constraints) {
    return null;
  }

  const { min, max } = additionalState.cellSchema.constraints;
  if (min === undefined || max === undefined) {
    return null;
  }

  if (!cellRect) return null;

  return (
    <div
      ref={scrollSyncRef}
      className="absolute inset-0 pointer-events-none"
      style={{ willChange: 'transform' }}
    >
      <SliderEditor
        currentValue={editorState.value}
        min={min}
        max={max}
        isInteger={additionalState.cellSchema.type === 'integer'}
        // Slider has no caret — value is replaced atomically when the user
        // drags the thumb. End-of-value is the correct cursor for the
        // machine; there is no mid-string caret to preserve. See
        onChange={(value) => editorActions.input(value, value.length)}
        onCommit={(direction) => dispatch(COMMIT_ACTION_FOR[direction])}
        onCancel={() => dispatch('CANCEL_EDIT')}
        position={{ x: cellRect.x, y: cellRect.y }}
        width={cellRect.width}
        height={cellRect.height}
      />
    </div>
  );
}
