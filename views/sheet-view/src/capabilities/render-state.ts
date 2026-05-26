/**
 * Render State Capability Implementation
 *
 * Maps the public SheetRenderState DTO to the internal
 * RenderContextConfig and delegates to updateContext().
 *
 * This is the primary boundary where public visual-only types are
 * converted to internal renderer types. Only fields with clear
 * correspondences are mapped; unknown fields are silently ignored.
 *
 * The internal updateContext() uses a field-by-field dispatch table,
 * so we pass each field as a top-level key. Complex internal types
 * (SelectionRenderState, EditorSnapshot, ClipboardSnapshot) are
 * built as partial objects — the dispatch table's individual setters
 * handle each field independently.
 *
 * @module @mog-sdk/sheet-view/capabilities/render-state
 */

import type { RenderContextConfig } from '@mog-sdk/contracts/rendering';

import type { ISheetViewRenderState } from '../capability-interfaces';
import type { SheetRenderState } from '../public-types';
import { mapSheetChromeThemeToRenderer } from './skin';

// =============================================================================
// Internal accessor type
// =============================================================================

export interface RenderStateInternals {
  updateContext(config: Partial<RenderContextConfig>): void;
  /** Called when selection visual state changes (for event emission). */
  onSelectionChange?: () => void;
  /** Called when editor visual state changes (for event emission). */
  onEditorChange?: (editor: { isEditing: boolean; cell?: { row: number; col: number } }) => void;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Helper to build the internal config object from public render state.
 *
 * Uses `Record<string, unknown>` casts for fields where the public DTO
 * is intentionally a subset of the internal type. The dispatch table
 * in grid-renderer.ts processes these field-by-field so partial objects
 * are safe.
 */
function mapToInternalConfig(state: Partial<SheetRenderState>): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  // --- Selection ---
  if (state.selection !== undefined) {
    const sel = state.selection;
    // Pass the selection fields that the renderer dispatch table handles.
    // The dispatch table calls individual setters, so a partial object
    // with just the visual fields is correct.
    config.selection = {
      ranges: sel.ranges.map((r) => ({
        startRow: r.startRow,
        startCol: r.startCol,
        endRow: r.endRow,
        endCol: r.endCol,
      })),
      activeCell: sel.activeCell
        ? { row: sel.activeCell.row, col: sel.activeCell.col }
        : { row: 0, col: 0 },
      formulaRanges: sel.formulaRanges?.map((fr) => ({
        range: {
          startRow: fr.range.startRow,
          startCol: fr.range.startCol,
          endRow: fr.range.endRow,
          endCol: fr.range.endCol,
        },
        color: fr.color,
        index: fr.index,
      })),
      activeReferenceIndex: sel.activeReferenceIndex,
      fillPreviewRange: sel.fillPreviewRange
        ? {
            startRow: sel.fillPreviewRange.startRow,
            startCol: sel.fillPreviewRange.startCol,
            endRow: sel.fillPreviewRange.endRow,
            endCol: sel.fillPreviewRange.endCol,
          }
        : undefined,
      hasError: sel.hasError,
      errorType: sel.errorType,
      tablePreviewRange:
        sel.tablePreviewRange !== undefined
          ? sel.tablePreviewRange
            ? {
                startRow: sel.tablePreviewRange.startRow,
                startCol: sel.tablePreviewRange.startCol,
                endRow: sel.tablePreviewRange.endRow,
                endCol: sel.tablePreviewRange.endCol,
              }
            : null
          : undefined,
      pastePreview: sel.pastePreview
        ? {
            isActive: sel.pastePreview.isActive,
            targetRange: {
              startRow: sel.pastePreview.targetRange.startRow,
              startCol: sel.pastePreview.targetRange.startCol,
              endRow: sel.pastePreview.targetRange.endRow,
              endCol: sel.pastePreview.targetRange.endCol,
            },
            cells: sel.pastePreview.cells.map((c) => ({
              row: c.row,
              col: c.col,
              displayValue: c.displayValue,
            })),
          }
        : undefined,
    };
  }

  // --- Editor ---
  if (state.editor !== undefined) {
    const ed = state.editor;
    config.editor = {
      isEditing: ed.isEditing,
      cell: ed.cell ? { row: ed.cell.row, col: ed.cell.col } : undefined,
      displayText: ed.displayText,
    };
  }

  // --- Clipboard ---
  if (state.clipboard !== undefined) {
    const clip = state.clipboard;
    config.clipboard = {
      isActive: clip.isActive,
      range: clip.range
        ? {
            startRow: clip.range.startRow,
            startCol: clip.range.startCol,
            endRow: clip.range.endRow,
            endCol: clip.range.endCol,
          }
        : undefined,
      isCut: clip.isCut,
    };
  }

  // --- Remote cursors ---
  if (state.remoteCursors !== undefined) {
    config.remoteCursors = state.remoteCursors.map((rc) => ({
      clientId: rc.clientId,
      user: {
        id: rc.user.id,
        name: rc.user.name,
        color: rc.user.color,
        avatar: rc.user.avatar,
      },
      selection: rc.selection.map((r) => ({
        startRow: r.startRow,
        startCol: r.startCol,
        endRow: r.endRow,
        endCol: r.endCol,
      })),
      activeCell: { row: rc.activeCell.row, col: rc.activeCell.col },
      sheetId: rc.sheetId,
      isEditing: rc.isEditing,
      editingCell: rc.editingCell
        ? { row: rc.editingCell.row, col: rc.editingCell.col }
        : undefined,
    }));
  }

  // --- View options (flat fields on RenderContextConfig) ---
  if (state.viewOptions !== undefined) {
    const vo = state.viewOptions;
    if (vo.showGridlines !== undefined) config.showGridlines = vo.showGridlines;
    if (vo.showRowHeaders !== undefined) config.showRowHeaders = vo.showRowHeaders;
    if (vo.showColumnHeaders !== undefined) config.showColumnHeaders = vo.showColumnHeaders;
    if (vo.showZeroValues !== undefined) config.showZeroValues = vo.showZeroValues;
    if (vo.gridlineColor !== undefined) config.gridlineColor = vo.gridlineColor;
    if (vo.rightToLeft !== undefined) config.rightToLeft = vo.rightToLeft;
    if (vo.showCutCopyIndicator !== undefined)
      config.showCutCopyIndicator = vo.showCutCopyIndicator;
    if (vo.allowDragFill !== undefined) config.allowDragFill = vo.allowDragFill;
  }

  // --- Chrome theme ---
  if (state.chromeTheme !== undefined) {
    config.chromeTheme = mapSheetChromeThemeToRenderer(state.chromeTheme);
  }

  // --- Shimmer ---
  if (state.shimmer !== undefined) {
    const sh = state.shimmer;
    if (sh.entries !== undefined) config.shimmerEntries = sh.entries;
    if (sh.effect !== undefined) config.shimmerEffect = sh.effect;
    if (sh.durationMs !== undefined) config.shimmerDurationMs = sh.durationMs;
    if (sh.color !== undefined) config.shimmerColor = sh.color;
    if (sh.maxOpacity !== undefined) config.shimmerMaxOpacity = sh.maxOpacity;
    if (sh.enabled !== undefined) config.shimmerEnabled = sh.enabled;
  }

  // --- Page breaks ---
  if (state.pageBreaks !== undefined) {
    const pb = state.pageBreaks;
    if (pb.previewMode !== undefined) config.pageBreakPreviewMode = pb.previewMode;
    if (pb.pageBreaks !== undefined) config.pageBreaks = pb.pageBreaks;
    if (pb.autoPageBreaks !== undefined) config.autoPageBreaks = pb.autoPageBreaks;
    if (pb.printArea !== undefined) config.printArea = pb.printArea;
  }

  // --- Preview font ---
  if (state.previewFont !== undefined) {
    config.previewFont = state.previewFont;
  }

  // --- Search highlights ---
  if (state.searchHighlights !== undefined) {
    config.searchHighlights = state.searchHighlights.map((h) => ({
      row: h.row,
      col: h.col,
      isActive: h.isActive,
    }));
  }

  // --- Blocked edit attempt ---
  if (state.blockedEditAttempt !== undefined) {
    config.blockedEditAttempt = state.blockedEditAttempt;
  }

  // --- Validation circles ---
  if (state.validationCirclesVisible !== undefined) {
    config.validationCirclesVisible = state.validationCirclesVisible;
  }

  return config;
}

export class SheetViewRenderState implements ISheetViewRenderState {
  constructor(private readonly _internals: RenderStateInternals) {}

  update(state: Partial<SheetRenderState>): void {
    const config = mapToInternalConfig(state);
    // The dispatch table in grid-renderer processes fields individually,
    // so passing a Record<string, unknown> as Partial<RenderContextConfig>
    // is type-safe at runtime even though the compile-time types differ.
    this._internals.updateContext(config as Partial<RenderContextConfig>);

    // Notify SheetView of state changes for event emission.
    if (state.selection !== undefined) {
      this._internals.onSelectionChange?.();
    }
    if (state.editor !== undefined) {
      this._internals.onEditorChange?.({
        isEditing: state.editor.isEditing,
        cell: state.editor.cell,
      });
    }
  }
}
