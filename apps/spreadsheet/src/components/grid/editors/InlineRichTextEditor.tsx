/**
 * Inline Rich Text Editor Component
 *
 * Renders the rich text editor for cells with rich text content.
 * Rich text cells use contentEditable with per-segment formatting.
 *
 * Rich Text Editor for cells with rich text content
 *
 * WYSIWYG NOTE:
 * Unlike InlineCellEditor which uses computeTextPosition() for exact positioning,
 * RichTextEditor handles multiple segments with different formatting using CSS-based
 * layout within contentEditable. Full WYSIWYG for rich text would require computing
 * positions for each segment individually, which is deferred.
 * Current approach: Position the editor container at cell bounds, let CSS handle
 * internal segment layout.
 *
 * Extracted from SpreadsheetGrid.tsx as part of Editor Overlay Decomposition
 *
 * Performance optimization: Uses granular hooks internally instead of receiving
 * editor/renderer as props to avoid identity-selector re-render cascades.
 */

import { useSelector } from '@xstate/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { editorSelectors } from '../../../selectors';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { RichTextSegment } from '@mog-sdk/contracts/rich-text';
import { isRichText } from '@mog/spreadsheet-utils/rich-text';
import type { StoreCellData } from '@mog-sdk/contracts/store';
import {
  useCoordinator,
  useDispatch,
  useEditorActions,
  useEditorState,
  useRendererActions,
  useScrollSyncTransform,
} from '../../../hooks';
import { COMMIT_ACTION_FOR } from '../../../actions/handlers/editor';
import { useActiveSheetId, useWorkbook } from '../../../infra/context';
import { RichTextEditor } from '../../editor';

// =============================================================================
// Component
// =============================================================================

export function InlineRichTextEditor() {
  // Use granular hooks internally for better performance
  const editorState = useEditorState();
  const editorActions = useEditorActions();
  const rendererActions = useRendererActions();
  const dispatch = useDispatch();
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  const ws = wb.getSheetById(activeSheetId);

  // Get coordinator for direct access to editor actor (needed for mergeBounds)
  const coordinator = useCoordinator();
  const editorActor = coordinator.grid.access.actors.editor;

  // Subscribe to mergeBounds separately (not in useEditorState for minimal coupling)
  const mergeBounds = useSelector(
    editorActor,
    (state): CellRange | null => editorSelectors.mergeBounds(state),
    (a, b) =>
      a === b ||
      (a !== null &&
        b !== null &&
        a.startRow === b.startRow &&
        a.endRow === b.endRow &&
        a.startCol === b.startCol &&
        a.endCol === b.endCol),
  );

  // Async cell data loading for rich text check
  // Use getRawCellData from worksheet API which includes the raw value for RichText detection
  const [cellData, setCellData] = useState<StoreCellData | undefined>(undefined);
  useEffect(() => {
    if (!editorState.isEditing || !editorState.editingCell) {
      setCellData(undefined);
      return;
    }
    let stale = false;
    const ws = wb.getSheetById(activeSheetId);
    void ws
      .getRawCellData(editorState.editingCell.row, editorState.editingCell.col)
      .then((rawData) => {
        if (!stale) {
          // Map RawCellData to StoreCellData-like shape for rich text detection
          setCellData({ raw: rawData.value } as StoreCellData);
        }
      });
    return () => {
      stale = true;
    };
  }, [wb, activeSheetId, editorState.isEditing, editorState.editingCell]);

  // Compute cell rect (memoized) — needed for scroll sync hook before early returns
  const cellRect = useMemo(() => {
    if (!editorState.isEditing || !editorState.editingCell) return null;

    const geometry = rendererActions.getGeometry();
    if (!geometry) return null;

    if (mergeBounds) {
      const rects = geometry.getRangeRects(mergeBounds);
      return rects[0] ?? null;
    } else {
      return geometry.getCellRect(editorState.editingCell);
    }
  }, [editorState.isEditing, editorState.editingCell, mergeBounds, activeSheetId, rendererActions]);

  // Scroll sync: wrapper div ref and imperative transform hook
  const scrollSyncRef = useRef<HTMLDivElement>(null);
  useScrollSyncTransform(
    scrollSyncRef,
    activeSheetId,
    editorState.editingCell,
    mergeBounds,
    cellRect ? { x: cellRect.x, y: cellRect.y } : null,
  );

  // Only render when editing and have a cell
  if (!editorState.isEditing || !editorState.editingCell) {
    return null;
  }

  // Check if the cell contains rich text
  const rawValue = cellData?.raw;

  if (!isRichText(rawValue)) {
    return null;
  }

  if (!cellRect) return null;

  // Get cell format
  const vpCellData = ws.viewport.getCellData(
    editorState.editingCell.row,
    editorState.editingCell.col,
  );
  const cellFormat = vpCellData?.format ?? {}; // Provide default empty format if not available

  // Get current zoom level for WYSIWYG font scaling
  const zoom = rendererActions.getZoom();

  // Convert RichText to segments for editor
  const segments: RichTextSegment[] = rawValue;

  return (
    <div
      ref={scrollSyncRef}
      className="absolute inset-0 pointer-events-none"
      style={{ willChange: 'transform' }}
    >
      <RichTextEditor
        segments={segments}
        selectionStart={0}
        selectionEnd={0}
        hasSelection={false}
        onInput={(newSegments) => {
          // Convert segments back to plain text for editor value
          // TODO: Store segments directly
          const plainText = newSegments.map((s) => s.text).join('');
          // The wrapped RichTextEditor today does not expose its caret
          // offset to this container (selectionStart/selectionEnd are
          // hard-wired to 0 above and onSelectionChange is a TODO), so we
          // pass end-of-value as the cursor. The editor machine's
          // cursorPosition is only consulted during plain-text editing
          // paths (formula range insert, IME commit, Alt+Enter newline);
          // none of those run while the rich-text editor owns input. When
          // the rich-text caret is wired up (see TODO above), thread the
          // real offset here. See
          editorActions.input(plainText, plainText.length);
        }}
        onSelectionChange={() => {
          // TODO: Track character selection for partial formatting
        }}
        onKeyDown={() => {
          // Keyboard handling is done internally by RichTextEditor
        }}
        onCommit={(direction) => dispatch(COMMIT_ACTION_FOR[direction])}
        onCancel={() => dispatch('CANCEL_EDIT')}
        cellFormat={cellFormat}
        position={{ x: cellRect.x, y: cellRect.y }}
        width={cellRect.width}
        height={cellRect.height}
        zoom={zoom}
      />
    </div>
  );
}
