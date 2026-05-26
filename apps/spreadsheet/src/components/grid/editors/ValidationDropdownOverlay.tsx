/**
 * Validation Dropdown Overlay Component
 *
 * Renders the validation dropdown picker for enum/enumSource cells.
 * Positioned below the cell and handles item selection.
 *
 * Issue 2: Cell Dropdowns / In-Cell Pickers
 *
 * Extracted from SpreadsheetGrid.tsx as part of Editor Overlay Decomposition
 *
 * Performance: Uses granular hooks internally instead of receiving full editor/renderer
 * props to eliminate identity-selector re-renders.
 */

import { useSelector } from '@xstate/react';
import { useMemo } from 'react';

import { editorSelectors } from '../../../selectors';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellSchema } from '@mog-sdk/contracts/schema';
import {
  useCoordinator,
  useDispatch,
  useEditorActions,
  useEditorState,
  useRendererActions,
} from '../../../hooks';
import { createVirtualRef, Popover, PopoverAnchor, PopoverContent } from '@mog/shell/components/ui';
import { ValidationDropdown } from '../ValidationDropdown';

// =============================================================================
// Types
// =============================================================================

/**
 * Internal state slice for validation dropdown rendering.
 * Only subscribes to the specific fields needed, avoiding identity selector re-renders.
 */
interface ValidationDropdownStateSlice {
  /** Merge bounds for positioning merged cells */
  mergeBounds: CellRange | null;
  /** Resolved enum items for dropdown */
  enumItems: unknown[] | null;
  /** Cell schema for constraints */
  cellSchema: CellSchema | null;
}

// =============================================================================
// Equality Function
// =============================================================================

/**
 * Custom equality function for validation dropdown state comparison.
 * Only triggers re-render when the specific fields actually change.
 */
function validationDropdownStateEqual(
  a: ValidationDropdownStateSlice,
  b: ValidationDropdownStateSlice,
): boolean {
  // mergeBounds comparison - check reference first, then deep compare if needed
  const mergeBoundsEqual =
    a.mergeBounds === b.mergeBounds ||
    (a.mergeBounds !== null &&
      b.mergeBounds !== null &&
      a.mergeBounds.startRow === b.mergeBounds.startRow &&
      a.mergeBounds.startCol === b.mergeBounds.startCol &&
      a.mergeBounds.endRow === b.mergeBounds.endRow &&
      a.mergeBounds.endCol === b.mergeBounds.endCol);

  return mergeBoundsEqual && a.enumItems === b.enumItems && a.cellSchema === b.cellSchema;
}

// =============================================================================
// Component
// =============================================================================

export function ValidationDropdownOverlay() {
  // Get coordinator for editor actor access (needed for additional selectors)
  const coordinator = useCoordinator();
  const editorActor = coordinator.grid.access.actors.editor;

  // Use granular hooks for common state and actions
  const editorState = useEditorState();
  const editorActions = useEditorActions();
  const rendererActions = useRendererActions();
  const dispatch = useDispatch();

  // Subscribe to additional fields not in useEditorState using custom selector
  const additionalState = useSelector(
    editorActor,
    (state): ValidationDropdownStateSlice => ({
      mergeBounds: editorSelectors.mergeBounds(state),
      enumItems: editorSelectors.enumItems(state),
      cellSchema: editorSelectors.cellSchema(state),
    }),
    validationDropdownStateEqual,
  );

  // Derive isDropdownCell from editorType (available in useEditorState)
  const isDropdownCell = editorState.editorType === 'dropdown';

  // Compute cell rectangle for positioning (memoized to avoid unnecessary recalculations).
  // Uses renderer page-coord helpers so the result is already window-relative —
  // no manual canvas-rect offset math needed downstream.
  const cellRect = useMemo(() => {
    if (!isDropdownCell || !editorState.editingCell || !editorState.sheetId) {
      return null;
    }

    const geometry = rendererActions.getGeometry();
    if (!geometry) return null;

    // For merged cells, use the merged bounds for dropdown positioning.
    // getRangePageRects returns array (for frozen-pane splits); for an
    // editor-anchored merged cell the split case is degenerate, so use [0].
    if (additionalState.mergeBounds) {
      const rects = geometry.getRangePageRects(additionalState.mergeBounds);
      return rects[0] ?? null;
    } else {
      return geometry.getCellPageRect({
        row: editorState.editingCell.row,
        col: editorState.editingCell.col,
      });
    }
  }, [
    isDropdownCell,
    editorState.editingCell,
    editorState.sheetId,
    additionalState.mergeBounds,
    rendererActions,
  ]);

  // Early return if conditions not met
  if (!isDropdownCell || !editorState.editingCell || !cellRect) {
    return null;
  }

  // Get dropdown items from editor context (resolved by coordinator)
  const dropdownItems = additionalState.enumItems ?? [];

  // J.5: Determine if blank values are allowed based on cell schema
  // allowBlank is true when the cell is NOT required (required defaults to false)
  const allowBlank = additionalState.cellSchema?.constraints?.required !== true;

  return (
    <Popover
      open={editorState.isPickerOpen}
      onOpenChange={(open) => !open && editorActions.closePicker()}
    >
      <PopoverAnchor
        virtualRef={{
          current: createVirtualRef(cellRect.x, cellRect.y + cellRect.height),
        }}
      />
      <PopoverContent
        side="bottom"
        align="start"
        shadow="lg"
        closeOnClickOutside={true}
        closeOnEscape={true}
        width={Math.max(cellRect.width, 200)}
      >
        <ValidationDropdown
          items={dropdownItems}
          currentValue={editorState.value}
          onSelect={(value, direction) => {
            dispatch('PICKER_COMMIT', { value, direction });
          }}
          isOpen={editorState.isPickerOpen}
          width={cellRect.width}
          allowBlank={allowBlank}
        />
      </PopoverContent>
    </Popover>
  );
}
