/**
 * Toolbar Actions Hook
 *
 * Handles all toolbar-related formatting operations for the spreadsheet.
 * Extracted from Spreadsheet.tsx to improve maintainability and testability.
 *
 * Features:
 * - Text formatting (bold, italic, underline, strikethrough)
 * - Alignment (horizontal and vertical)
 * - Number formatting
 * - Colors and fonts
 * - Borders
 * - Clear formatting
 * - Format painter
 * - Undo/redo
 *
 * Architecture (
 * - Non-parameterized toggle actions use dispatch() for single source of truth:
 * TOGGLE_BOLD, TOGGLE_ITALIC, TOGGLE_UNDERLINE, TOGGLE_STRIKETHROUGH,
 * TOGGLE_WRAP_TEXT, CLEAR_FORMATS, UNDO, REDO
 * - Parameterized actions (alignment values, colors, fonts, etc.) remain as
 * direct implementations using Mutations layer
 * - Reads: Direct domain module access (Cells.getFormat, Cells.getHyperlink, Properties.getStyle)
 *
 * PERFORMANCE: This hook does NOT subscribe to selection state. Instead, it uses
 * coordinator.getSelectionSnapshot() to read selection on-demand when actions fire.
 * This prevents re-renders on every selection change (mouse drag, keyboard navigation).
 *
 * Selection is only needed when:
 * - User clicks a toolbar button (handleApplyStyle, handleFormatPainter, etc.)
 * - NOT during renders for button state (format highlighting comes from UIStore)
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 14: Render Isolation
 */

import type React from 'react';
import { useCallback } from 'react';

import type { SheetId } from '@mog-sdk/contracts/core';

import { parseA1Range } from '@mog/spreadsheet-utils/a1';
import {
  useActiveSheetId,
  useIsFormatPainterActive,
  useUIStore,
  useWorkbook,
} from '../../infra/context';
import { normalizeSolidFillFormat } from '../../actions/handlers/formatting/fill-format';
import type { Selection } from '../../systems/shared/types';
import { useCoordinator } from '../shared/use-coordinator';
import { useDispatch } from './use-action-dependencies';
// Note: openHyperlinkDialog is obtained from useUIStore selector below
// PERFORMANCE: Use coordinator.getSelectionSnapshot() for on-demand selection reads.
// This avoids subscribing to selection state which changes frequently (on every mouse move).
// Actions read selection only when invoked (user clicks), not on every render.
import { getCellsFromRanges, getRangeDescription } from '../../infra/utils/selection-utils';

// =============================================================================
// Undo/Redo State Hooks
// =============================================================================

/**
 * Hook for reactive canUndo state.
 * Uses UIStore's undoStackSize which is updated by UndoManager events.
 */
function useCanUndo(): boolean {
  return useUIStore((s) => s.undoStackSize > 0);
}

/**
 * Hook for reactive canRedo state.
 * Uses UIStore's redoStackSize which is updated by UndoManager events.
 */
function useCanRedo(): boolean {
  return useUIStore((s) => s.redoStackSize > 0);
}

// =============================================================================
// Types
// =============================================================================

export interface UseToolbarActionsOptions {
  /** Override active sheet ID (defaults to store's active sheet) */
  sheetId?: SheetId;
  /** Override selection (defaults to store's selection) */
  selection?: Selection;
}

export interface UseToolbarActionsReturn {
  // Text formatting - all use dispatch() for single source of truth
  handleBoldClick: () => void;
  handleItalicClick: () => void;
  handleUnderlineClick: () => void;
  handleStrikethroughClick: () => void;

  // Alignment - handleWordWrapClick uses dispatch()
  // NOTE: handleTextAlignChange, handleVerticalAlignChange removed - use dispatch('SET_HORIZONTAL_ALIGN'/SET_VERTICAL_ALIGN')
  handleWordWrapClick: () => void;

  // NOTE: Color/font handlers removed - use dispatch('SET_FONT_COLOR', 'SET_BACKGROUND_COLOR', etc.)
  // NOTE: handleNumberFormatChange removed - use dispatch('SET_NUMBER_FORMAT', { format })
  // NOTE: handleBorderChange removed - use dispatch('APPLY_BORDERS', { borders })

  // Clear & format painter
  handleClearFormat: () => void;
  handleFormatPainter: () => void;

  // Undo/Redo - use dispatch() for single source of truth
  handleUndo: () => void;
  handleRedo: () => void;

  // Cell Styles
  handleApplyStyle: (styleId: string) => void;

  // Insert operations
  handleInsertHyperlink: () => void;

  // Insert Table
  handleInsertTable: () => void;

  // Insert Sparkline
  /**
   * Insert sparkline with specified type
   * @param type - The sparkline type: 'line', 'column', or 'winLoss'
   */
  handleInsertSparkline: (type: 'line' | 'column' | 'winLoss') => void;

  // Insert Picture
  handleInsertPicture: () => void;

  // Insert Shapes
  handleInsertShapes: (e: React.MouseEvent) => void;

  // Insert Text Box
  handleInsertTextBox: () => void;

  // Insert Comment
  handleInsertComment: () => void;

  // Insert Slicer
  handleInsertSlicer: () => void;

  // State
  isFormatPainterActive: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useToolbarActions(options: UseToolbarActionsOptions = {}): UseToolbarActionsReturn {
  // PERFORMANCE: Use coordinator for on-demand selection reads instead of subscribing.
  // Selection is only read when actions are invoked, not on every render.
  const coordinator = useCoordinator();
  const storeActiveSheetId = useActiveSheetId();

  // Reactive undo/redo state from UIStore (updated by UndoManager events)
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  const wb = useWorkbook();

  // Allow overrides for testing or custom use cases
  const activeSheetId = options.sheetId ?? storeActiveSheetId;

  /**
   * Helper to get current selection on-demand.
   * If options.selection is provided (for testing), use that.
   * Otherwise, read from coordinator snapshot.
   */
  const getSelection = useCallback(() => {
    if (options.selection) {
      // Convert old-style selection to new format
      return {
        activeRow: options.selection.activeRow,
        activeCol: options.selection.activeCol,
        ranges: options.selection.ranges.map((r) => ({
          startRow: r.startRow,
          startCol: r.startCol,
          endRow: r.endRow,
          endCol: r.endCol,
        })),
      };
    }
    // Read from coordinator on-demand (no subscription)
    const snapshot = coordinator.grid.getSelectionSnapshot();
    return {
      activeRow: snapshot.activeCell.row,
      activeCol: snapshot.activeCell.col,
      ranges: snapshot.ranges,
    };
  }, [coordinator, options.selection]);

  // Format painter state - use atomic selector for isActive to avoid re-renders
  const isFormatPainterActive = useIsFormatPainterActive();
  const startFormatPainter = useUIStore((s) => s.startFormatPainter);
  const stopFormatPainter = useUIStore((s) => s.stopFormatPainter);

  // Hyperlink dialog
  const openHyperlinkDialog = useUIStore((s) => s.openHyperlinkDialog);

  // Insert Sparkline dialog
  const openSparklineDialog = useUIStore((s) => s.openSparklineDialog);

  // Insert Slicer dialog
  const openInsertSlicerDialog = useUIStore((s) => s.openInsertSlicerDialog);

  // Insert Picture dialog
  const openInsertPictureDialog = useUIStore((s) => s.openInsertPictureDialog);

  // Insert Shape menu
  const openInsertShapeMenu = useUIStore((s) => s.openInsertShapeMenu);

  // Set undo description BEFORE operations (single source of truth via WorkbookHistory sub-API)
  const setPendingUndoDescription = useCallback(
    (description: string) => {
      wb.history.setNextDescription(description);
    },
    [wb],
  );

  // Get dispatch function from unified action system
  // Note: cellFormat is no longer needed here since dispatch() handlers
  // read the format directly from the store
  const dispatch = useDispatch();

  // Note: Format state for button highlighting (bold/italic/etc.) should come from
  // a dedicated UIStore slice (activeCellFormat), NOT from reading on every render.
  // The UIStore slice gets updated when the active cell changes.
  // This hook no longer subscribes to selection - it reads on-demand when actions fire.

  // ==========================================================================
  // Text Formatting Handlers
  // All use dispatch() for single source of truth
  // ==========================================================================

  const handleBoldClick = useCallback(() => {
    dispatch('TOGGLE_BOLD');
  }, [dispatch]);

  const handleItalicClick = useCallback(() => {
    dispatch('TOGGLE_ITALIC');
  }, [dispatch]);

  const handleUnderlineClick = useCallback(() => {
    dispatch('TOGGLE_UNDERLINE');
  }, [dispatch]);

  const handleStrikethroughClick = useCallback(() => {
    dispatch('TOGGLE_STRIKETHROUGH');
  }, [dispatch]);

  /**
   * Toggle word wrap.
   * Uses dispatch() for single source of truth.
   */
  const handleWordWrapClick = useCallback(() => {
    dispatch('TOGGLE_WRAP_TEXT');
  }, [dispatch]);

  // ==========================================================================
  // Clear Format & Format Painter
  // ==========================================================================

  const handleClearFormat = useCallback(() => {
    dispatch('CLEAR_FORMATS');
  }, [dispatch]);

  // Use Cells domain module for reading format
  // PERFORMANCE: Read selection on-demand when action fires
  const handleFormatPainter = useCallback(async () => {
    if (isFormatPainterActive) {
      // If already active, deactivate
      stopFormatPainter();
    } else {
      // Read selection on-demand
      const { activeRow, activeCol } = getSelection();

      // Activate with current cell's format, sheet ID, and validation schemas
      const ws = wb.getSheetById(activeSheetId);
      const currentFormat = await ws.formats.get(activeRow, activeCol);
      const sourceRange = {
        startRow: activeRow,
        endRow: activeRow,
        startCol: activeCol,
        endCol: activeCol,
      };

      // Capture validation schemas for the source range via ws API
      const allRules = await ws.validations.list();
      const validationSchemasArray = allRules.filter((rule) => {
        if (!rule.range) return false;
        const parsed = parseA1Range(rule.range);
        return (
          parsed.startRow <= activeRow &&
          parsed.endRow >= activeRow &&
          parsed.startCol <= activeCol &&
          parsed.endCol >= activeCol
        );
      });

      startFormatPainter(
        currentFormat ?? {},
        sourceRange,
        activeSheetId,
        undefined, // conditionalFormats - captured separately if needed
        validationSchemasArray.length > 0 ? validationSchemasArray : undefined,
      );
    }
  }, [
    isFormatPainterActive,
    stopFormatPainter,
    startFormatPainter,
    activeSheetId,
    getSelection,
    wb,
  ]);

  // ==========================================================================
  // Undo/Redo
  // Migrated to use dispatch() for single source of truth
  // ==========================================================================

  const handleUndo = useCallback(() => {
    dispatch('UNDO');
  }, [dispatch]);

  const handleRedo = useCallback(() => {
    dispatch('REDO');
  }, [dispatch]);

  // ==========================================================================
  // Cell Styles
  // ==========================================================================

  // Use Properties domain module for reading styles, Mutations for applying
  // PERFORMANCE: Read selection on-demand when action fires
  const handleApplyStyle = useCallback(
    (styleId: string) => {
      void (async () => {
        // Read selection on-demand
        const { ranges } = getSelection();
        const cells = getCellsFromRanges(ranges);
        if (cells.length === 0) return;

        // Use Workbook API to get style format for applying
        const style = await wb.cellStyles.get(styleId);
        // CellFormat doesn't carry a name — use the styleId for undo description
        const styleName = styleId;
        const rangeDesc = getRangeDescription(ranges);
        setPendingUndoDescription(`Apply style ${styleName} to ${rangeDesc}`);

        // Apply style via Worksheet API: set format from the resolved style
        if (style) {
          const ws = wb.getSheetById(activeSheetId);
          const format = normalizeSolidFillFormat(style);
          await ws.formats.setRanges(
            ranges.map((r) => ({
              startRow: r.startRow,
              startCol: r.startCol,
              endRow: r.endRow,
              endCol: r.endCol,
            })),
            format,
          );
        }
      })();
    },
    [wb, activeSheetId, getSelection, setPendingUndoDescription],
  );

  // ==========================================================================
  // Insert Hyperlink
  // ==========================================================================

  /**
   * Open the Insert Hyperlink dialog for the active cell.
   * If the cell already has a hyperlink, opens in edit mode.
   * Uses Cells domain module for reading hyperlink.
   * PERFORMANCE: Read selection on-demand when action fires
   */
  const handleInsertHyperlink = useCallback(() => {
    void (async () => {
      // Read selection on-demand
      const { activeRow, activeCol } = getSelection();
      // Get existing hyperlink using Worksheet API
      const ws = wb.getSheetById(activeSheetId);
      const existingUrl = await ws.hyperlinks.get(activeRow, activeCol);
      // Open dialog - it will be in 'edit' mode if existingUrl is provided
      openHyperlinkDialog(activeRow, activeCol, existingUrl ?? undefined);
    })();
  }, [wb, activeSheetId, getSelection, openHyperlinkDialog]);

  // ==========================================================================
  // Insert Table
  // ==========================================================================

  /**
   * Open the Insert Table dialog.
   * Uses the current selection as the initial range for the table.
   */
  const handleInsertTable = useCallback(() => {
    dispatch('INSERT_TABLE');
  }, [dispatch]);

  // ==========================================================================
  // Insert Sparkline
  // ==========================================================================

  /**
   * Open the Insert Sparkline dialog with pre-selected type.
   * The dialog auto-populates data range from current selection.
   *
   * @param type - The sparkline type: 'line', 'column', or 'winLoss'
   */
  const handleInsertSparkline = useCallback(
    (_type: 'line' | 'column' | 'winLoss') => {
      // TODO: Pass _type to dialog to pre-select the sparkline type
      // For now, open the dialog and let user select type manually
      openSparklineDialog();
    },
    [openSparklineDialog],
  );

  // ==========================================================================
  // Insert Picture
  // ==========================================================================

  /**
   * Open the Insert Picture dialog.
   * Allows uploading images from file or URL.
   */
  const handleInsertPicture = useCallback(() => {
    openInsertPictureDialog();
  }, [openInsertPictureDialog]);

  // ==========================================================================
  // Insert Shapes
  // ==========================================================================

  /**
   * Open the Insert Shape menu.
   * Menu position is anchored to the clicked button.
   */
  const handleInsertShapes = useCallback(
    (e: React.MouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openInsertShapeMenu(rect.left, rect.bottom);
    },
    [openInsertShapeMenu],
  );

  // ==========================================================================
  // Insert Text Box
  // ==========================================================================

  /**
   * Insert a text box at a default position.
   * Text boxes are created empty - user can double-click to edit content.
   * Uses absolute positioning for simplicity (like Excel's Insert → Text Box).
   */
  const handleInsertTextBox = useCallback(() => {
    dispatch('INSERT_TEXTBOX', {
      content: '',
      position: { x: 100, y: 100, width: 150, height: 75 },
    });
  }, [dispatch]);

  // ==========================================================================
  // Insert Comment
  // ==========================================================================

  /**
   * Insert a comment at the current selection.
   * TODO: Implement comment system - for now this is a stub.
   */
  const handleInsertComment = useCallback(() => {
    // TODO: Implement comment insertion
    // This would typically open a comment panel or dialog
    console.info('Insert Comment - not yet implemented');
  }, []);

  // ==========================================================================
  // Insert Slicer
  // ==========================================================================

  /**
   * Open the Insert Slicer dialog.
   * Only works when selection is in a table - finds the table and shows
   * available columns for slicer creation.
   * PERFORMANCE: Read selection on-demand when action fires
   */
  const handleInsertSlicer = useCallback(() => {
    void (async () => {
      // Read selection on-demand
      const { activeRow, activeCol } = getSelection();

      // Find the table at the current selection via Worksheet API (async)
      let tableAtSelection: any;
      try {
        const wsForSlicer = wb.getSheetById(activeSheetId);
        tableAtSelection = await wsForSlicer.tables.getAtCell(activeRow, activeCol);
      } catch {
        console.warn('Cannot insert slicer - table lookup error');
        return;
      }
      if (!tableAtSelection) {
        console.warn('Cannot insert slicer - selection is not in a table');
        return;
      }

      // Get existing slicers for this table via Worksheet API
      const wsForSlicer = wb.getSheetById(activeSheetId);
      const allSlicers = await wsForSlicer.slicers.list();
      const existingSlicers = allSlicers.filter(
        (s: any) => s.source?.type === 'table' && s.source?.tableId === tableAtSelection.id,
      );
      const existingColumnCellIds = new Set(
        existingSlicers
          .filter((s: any) => s.source?.type === 'table')
          .map((s: any) => (s.source as { columnCellId: string }).columnCellId),
      );

      // Build column options from table columns
      // Each column in the table can have a slicer
      const columns = await Promise.all(
        tableAtSelection.columns.map(async (col: { name: string }, index: number) => {
          // Get the CellId for this column's header
          const headerRow = tableAtSelection.range.startRow;
          const headerCol = tableAtSelection.range.startCol + index;
          const cellId = await wsForSlicer._internal.getCellIdAt(headerRow, headerCol);

          return {
            columnCellId: cellId ?? '',
            columnName: col.name,
            hasExistingSlicer: existingColumnCellIds.has(cellId ?? ''),
          };
        }),
      );

      // Open the dialog
      openInsertSlicerDialog('table', tableAtSelection.id, columns);
    })();
  }, [wb, activeSheetId, getSelection, openInsertSlicerDialog]);

  // ==========================================================================
  // Return
  // ==========================================================================

  return {
    // Text formatting - all use dispatch()
    handleBoldClick,
    handleItalicClick,
    handleUnderlineClick,
    handleStrikethroughClick,

    // Alignment - uses dispatch()
    // NOTE: handleTextAlignChange, handleVerticalAlignChange removed - use dispatch() directly
    handleWordWrapClick,

    // NOTE: Color/font/number format/border handlers removed - use dispatch() directly

    // Clear & format painter
    handleClearFormat,
    handleFormatPainter,

    // Undo/Redo - use dispatch()
    handleUndo,
    handleRedo,

    // Cell Styles
    handleApplyStyle,

    // Insert operations
    handleInsertHyperlink,

    // Insert Table
    handleInsertTable,

    // Insert Sparkline
    handleInsertSparkline,

    // Insert Picture
    handleInsertPicture,

    // Insert Shapes
    handleInsertShapes,

    // Insert Text Box
    handleInsertTextBox,

    // Insert Comment
    handleInsertComment,

    // Insert Slicer
    handleInsertSlicer,

    // State
    isFormatPainterActive,
    // Use reactive undo/redo state from UIStore (not static method calls)
    canUndo,
    canRedo,
  };
}
