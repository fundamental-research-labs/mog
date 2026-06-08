/**
 * Cell Context Menu Component
 *
 * Right-click context menu for cell, row, and column operations.
 * Provides quick access to common operations like cut/copy/paste,
 * insert/delete rows/columns, hide/unhide, and resize.
 *
 * Architecture notes:
 * - Menu UI state is in UIStore (ephemeral, not collaborative)
 * - Actions route through appropriate channels:
 * - Clipboard: useClipboard → clipboard-machine
 * - Selection: useSelection → selection-machine
 * - Structure ops: structure-operations.ts (direct Yjs)
 * - Uses Radix ContextMenu (wraps grid trigger area, positioned from native event)
 *
 * @see docs/renderer/README.md - Architecture principles
 * @module components/context-menu/CellContextMenu
 */

import { useMemo } from 'react';

import { useReadOnly } from '../../infra/context';
import {
  ClearFilterIcon,
  ClearIcon,
  CopyIcon,
  CustomSortIcon,
  CutIcon,
  DeleteCommentIcon,
  DeleteIcon,
  DeleteRowIcon,
  EditCommentIcon,
  FilterIcon,
  FormatCellsIcon,
  GroupIcon,
  HideIcon,
  HyperlinkIcon,
  InsertCellsIcon,
  InsertColLeftIcon,
  InsertIcon,
  InsertRowAboveIcon,
  LinkIcon,
  MergeCellsIcon,
  NewCommentIcon,
  OpenHyperlinkIcon,
  PageBreakIcon,
  PasteFormattingIcon,
  PasteFormulasIcon,
  PasteIcon,
  PasteValuesIcon,
  ResizeIcon,
  ShowIcon,
  SortAscendingIcon,
  SortDescendingIcon,
  SparklineIcon,
  UngroupIcon,
  UnmergeCellsIcon,
} from './icons';

import { ContextMenuContent } from '@mog/shell/components/ui';
import { usePlatformInfo } from '@mog/shell';
import { useContextMenuActions } from '../../hooks/toolbar/use-context-menu-actions';
import type { CellContextMenuProps, ContextMenuItem as ContextMenuItemType } from './types';
import { MenuItemRenderer } from './MenuItemRenderer';
import { getFormatCellsContextMenuShortcut, platformFromShellInfo } from './shortcut-labels';

// =============================================================================
// Main Component
// =============================================================================

/** IDs of context menu items allowed in read-only mode (non-mutating actions). */
const READ_ONLY_ALLOWED_IDS = new Set([
  'copy',
  'selectArray',
  'selectTable',
  'selectAll',
  'openHyperlink',
  'copyHyperlink',
  'showFormulas',
]);

export function CellContextMenu({ target, targetRow, targetCol, onClose }: CellContextMenuProps) {
  const contextMenuCell = useMemo(
    () =>
      (target === 'cell' || target === 'selection') &&
      targetRow !== undefined &&
      targetCol !== undefined
        ? { row: targetRow, col: targetCol }
        : null,
    [target, targetRow, targetCol],
  );
  const actions = useContextMenuActions(contextMenuCell);
  const readOnly = useReadOnly();
  const platformInfo = usePlatformInfo();
  const keyboardPlatform = useMemo(() => platformFromShellInfo(platformInfo), [platformInfo]);
  const formatCellsShortcut = useMemo(
    () => getFormatCellsContextMenuShortcut(keyboardPlatform),
    [keyboardPlatform],
  );

  // Build menu items based on target type
  const menuItems = useMemo((): ContextMenuItemType[] => {
    const items: ContextMenuItemType[] = [];

    // === Open Hyperlink at Top (WCAG accessibility) ===
    // When a hyperlink exists, show "Open Hyperlink" as the first item for quick access
    if ((target === 'cell' || target === 'selection') && actions.hasHyperlinkAtActiveCell) {
      items.push({
        id: 'openHyperlink',
        label: 'Open Hyperlink',
        icon: <OpenHyperlinkIcon />,
        dividerAfter: true,
        onClick: actions.openHyperlink,
      });
    }

    // === Clipboard Section ===
    items.push({
      id: 'cut',
      label: 'Cut',
      icon: <CutIcon />,
      shortcut: 'Ctrl+X',
      onClick: actions.cut,
    });

    items.push({
      id: 'copy',
      label: 'Copy',
      icon: <CopyIcon />,
      shortcut: 'Ctrl+C',
      onClick: actions.copy,
    });

    items.push({
      id: 'paste',
      label: 'Paste',
      icon: <PasteIcon />,
      shortcut: 'Ctrl+V',
      disabled: !actions.canPaste,
      testId: 'context-menu-paste',
      onClick: actions.paste,
    });

    // Paste Options Submenu
    items.push({
      id: 'pasteOptions',
      label: 'Paste Options',
      icon: <PasteIcon />,
      disabled: !actions.canPaste,
      onClick: () => {}, // Parent item - no direct action
      children: [
        {
          id: 'pasteValues',
          label: 'Values',
          icon: <PasteValuesIcon />,
          onClick: actions.pasteValues,
        },
        {
          id: 'pasteFormulas',
          label: 'Formulas',
          icon: <PasteFormulasIcon />,
          onClick: actions.pasteFormulas,
        },
        {
          id: 'pasteFormatting',
          label: 'Formatting',
          icon: <PasteFormattingIcon />,
          onClick: actions.pasteFormatting,
        },
        {
          id: 'pasteTranspose',
          label: 'Transpose',
          icon: <PasteIcon />,
          onClick: actions.pasteTranspose,
        },
        // Paste Link/Picture Options
        {
          id: 'pasteLink',
          label: 'Paste Link',
          icon: <LinkIcon />,
          onClick: actions.pasteLink,
        },
        {
          id: 'pasteAsPicture',
          label: 'Paste as Picture',
          icon: <PasteIcon />,
          onClick: actions.pasteAsPicture,
        },
        {
          id: 'pasteAsLinkedPicture',
          label: 'Paste as Linked Picture',
          icon: <LinkIcon />,
          onClick: actions.pasteAsLinkedPicture,
        },
      ],
    });

    items.push({
      id: 'pasteSpecial',
      label: 'Paste special...',
      shortcut: 'Ctrl+Shift+V',
      disabled: !actions.canPaste,
      dividerAfter: true,
      testId: 'context-menu-paste-special',
      onClick: actions.pasteSpecial,
    });

    // === Error Context Menu Items ===
    // Show error-specific options when the active cell contains an error
    if ((target === 'cell' || target === 'selection') && actions.hasErrorAtActiveCell) {
      items.push({
        id: 'traceError',
        label: 'Trace Error',
        icon: <FormatCellsIcon />,
        onClick: actions.traceError,
      });

      items.push({
        id: 'ignoreError',
        label: 'Ignore Error',
        icon: <ClearIcon />,
        dividerAfter: true,
        onClick: actions.ignoreError,
      });
    }

    // === Array Formula Context Menu Items ===
    // Show "Select Array" when the active cell is part of an array formula
    if ((target === 'cell' || target === 'selection') && actions.isInArrayFormula) {
      // Add divider if there isn't one and we didn't just add error items
      if (
        items.length > 0 &&
        !items[items.length - 1].dividerAfter &&
        !actions.hasErrorAtActiveCell
      ) {
        items[items.length - 1].dividerAfter = true;
      }

      items.push({
        id: 'selectArray',
        label: 'Select Array',
        icon: <InsertCellsIcon />,
        dividerAfter: true,
        onClick: actions.selectArray,
      });
    }

    // === Insert Section (Selection-Type-Aware Insert Labels) ===
    // Excel behavior:
    // - Full row selection: "Insert" (directly inserts rows)
    // - Full column selection: "Insert" (directly inserts columns)
    // - Cell range selection: "Insert..." (opens Insert Cells dialog)
    // - Non-contiguous selection: disable Insert

    if (target === 'row-header') {
      // Row header: always show "Insert" (direct action)
      items.push({
        id: 'insert',
        label: 'Insert',
        icon: <InsertRowAboveIcon />,
        disabled: !actions.isContiguousSelection,
        dividerAfter: true,
        onClick: actions.insertRowAbove,
      });
    } else if (target === 'column-header') {
      // Column header: always show "Insert" (direct action)
      items.push({
        id: 'insert',
        label: 'Insert',
        icon: <InsertColLeftIcon />,
        disabled: !actions.isContiguousSelection,
        dividerAfter: true,
        onClick: () => {
          actions.insertColumnLeft();
        },
      });
    } else if (target === 'cell' || target === 'selection') {
      // Cell/selection context: behavior depends on selection type
      if (actions.isFullRowSelection) {
        // Full row selection: "Insert" (direct action)
        items.push({
          id: 'insert',
          label: 'Insert',
          icon: <InsertRowAboveIcon />,
          disabled: !actions.isContiguousSelection,
          dividerAfter: true,
          onClick: actions.insertRowAbove,
        });
      } else if (actions.isFullColumnSelection) {
        // Full column selection: "Insert" (direct action)
        items.push({
          id: 'insert',
          label: 'Insert',
          icon: <InsertColLeftIcon />,
          disabled: !actions.isContiguousSelection,
          dividerAfter: true,
          onClick: actions.insertColumnLeft,
        });
      } else {
        // Cell range selection: "Insert..." (opens dialog)
        items.push({
          id: 'insert',
          label: 'Insert...',
          icon: <InsertCellsIcon />,
          disabled: !actions.isContiguousSelection,
          dividerAfter: true,
          onClick: actions.insertCells,
        });
      }
    }

    // === Delete Section (Selection-Type-Aware Delete Labels) ===
    // Excel behavior:
    // - Full row selection: "Delete" (directly deletes rows)
    // - Full column selection: "Delete" (directly deletes columns)
    // - Cell range selection: "Delete..." opens Delete Cells dialog
    // - Non-contiguous selection: disable Delete

    if (target === 'row-header') {
      // Row header: always show "Delete" (direct action)
      items.push({
        id: 'delete',
        label: actions.selectedRowCount > 1 ? `Delete ${actions.selectedRowCount} rows` : 'Delete',
        icon: <DeleteRowIcon />,
        danger: true,
        disabled: !actions.isContiguousSelection,
        dividerAfter: true,
        onClick: actions.deleteRows,
      });
    } else if (target === 'column-header') {
      // Column header: always show "Delete" (direct action)
      items.push({
        id: 'delete',
        label:
          actions.selectedColCount > 1 ? `Delete ${actions.selectedColCount} columns` : 'Delete',
        icon: <DeleteRowIcon />,
        danger: true,
        disabled: !actions.isContiguousSelection,
        dividerAfter: true,
        onClick: actions.deleteColumns,
      });
    } else if (target === 'cell' || target === 'selection') {
      // Cell/selection context: behavior depends on selection type
      if (actions.isFullRowSelection) {
        // Full row selection: "Delete" (direct action)
        items.push({
          id: 'delete',
          label:
            actions.selectedRowCount > 1 ? `Delete ${actions.selectedRowCount} rows` : 'Delete',
          icon: <DeleteRowIcon />,
          danger: true,
          disabled: !actions.isContiguousSelection,
          dividerAfter: true,
          onClick: actions.deleteRows,
        });
      } else if (actions.isFullColumnSelection) {
        // Full column selection: "Delete" (direct action)
        items.push({
          id: 'delete',
          label:
            actions.selectedColCount > 1 ? `Delete ${actions.selectedColCount} columns` : 'Delete',
          icon: <DeleteRowIcon />,
          danger: true,
          disabled: !actions.isContiguousSelection,
          dividerAfter: true,
          onClick: actions.deleteColumns,
        });
      } else {
        // Cell range selection: "Delete..." opens Delete Cells dialog
        items.push({
          id: 'delete',
          label: 'Delete...',
          icon: <DeleteRowIcon />,
          danger: true,
          disabled: !actions.isContiguousSelection,
          dividerAfter: true,
          onClick: actions.deleteCells,
        });
      }
    }

    // === Hide/Unhide Section ===
    if (target === 'row-header' || target === 'cell' || target === 'selection') {
      items.push({
        id: 'hideRows',
        label: actions.selectedRowCount > 1 ? `Hide ${actions.selectedRowCount} rows` : 'Hide row',
        icon: <HideIcon />,
        onClick: actions.hideRows,
      });

      if (actions.hasHiddenRowsInSelection) {
        items.push({
          id: 'unhideRows',
          label: 'Unhide rows',
          icon: <ShowIcon />,
          onClick: actions.unhideRows,
        });
      }
    }

    if (target === 'column-header' || target === 'cell' || target === 'selection') {
      items.push({
        id: 'hideColumns',
        label:
          actions.selectedColCount > 1 ? `Hide ${actions.selectedColCount} columns` : 'Hide column',
        icon: <HideIcon />,
        onClick: actions.hideColumns,
      });

      if (actions.hasHiddenColsInSelection) {
        items.push({
          id: 'unhideColumns',
          label: 'Unhide columns',
          icon: <ShowIcon />,
          dividerAfter: true,
          onClick: actions.unhideColumns,
        });
      }
    }

    // Add divider before grouping if not already there
    if (items.length > 0 && !items[items.length - 1].dividerAfter) {
      items[items.length - 1].dividerAfter = true;
    }

    // === Grouping Section (Grouping) ===
    if (target === 'row-header' || target === 'selection') {
      items.push({
        id: 'groupRows',
        label: 'Group rows',
        icon: <GroupIcon />,
        shortcut: 'Alt+Shift+→',
        disabled: !actions.canGroup,
        onClick: actions.groupRows,
      });

      items.push({
        id: 'ungroupRows',
        label: 'Ungroup rows',
        icon: <UngroupIcon />,
        shortcut: 'Alt+Shift+←',
        disabled: !actions.canUngroup,
        onClick: actions.ungroupRows,
      });
    }

    if (target === 'column-header' || target === 'selection') {
      items.push({
        id: 'groupColumns',
        label: 'Group columns',
        icon: <GroupIcon />,
        shortcut: 'Alt+Shift+→',
        disabled: !actions.canGroup,
        onClick: actions.groupColumns,
      });

      items.push({
        id: 'ungroupColumns',
        label: 'Ungroup columns',
        icon: <UngroupIcon />,
        shortcut: 'Alt+Shift+←',
        disabled: !actions.canUngroup,
        dividerAfter: true,
        onClick: actions.ungroupColumns,
      });
    }

    // === Resize Section ===
    if (target === 'row-header' || target === 'cell' || target === 'selection') {
      items.push({
        id: 'rowHeight',
        label: 'Row height...',
        icon: <ResizeIcon />,
        onClick: actions.openRowHeightDialog,
      });
    }

    if (target === 'column-header' || target === 'cell' || target === 'selection') {
      items.push({
        id: 'columnWidth',
        label: 'Column width...',
        icon: <ResizeIcon />,
        dividerAfter: true,
        onClick: actions.openColumnWidthDialog,
      });
    }

    // === Page Break Section ===
    // Only show in page break preview mode for row/column headers
    if (actions.isPageBreakPreviewMode) {
      // Row header: horizontal page breaks (breaks ABOVE the selected row)
      if (target === 'row-header') {
        // Add divider if there isn't one
        if (items.length > 0 && !items[items.length - 1].dividerAfter) {
          items[items.length - 1].dividerAfter = true;
        }

        if (actions.hasHorizontalPageBreakAtSelection) {
          items.push({
            id: 'removeHorizontalPageBreak',
            label: 'Remove page break',
            icon: <PageBreakIcon />,
            dividerAfter: true,
            onClick: actions.removeHorizontalPageBreak,
          });
        } else {
          items.push({
            id: 'insertHorizontalPageBreak',
            label: 'Insert page break',
            icon: <PageBreakIcon />,
            dividerAfter: true,
            onClick: actions.insertHorizontalPageBreak,
          });
        }
      }

      // Column header: vertical page breaks (breaks LEFT of the selected column)
      if (target === 'column-header') {
        // Add divider if there isn't one
        if (items.length > 0 && !items[items.length - 1].dividerAfter) {
          items[items.length - 1].dividerAfter = true;
        }

        if (actions.hasVerticalPageBreakAtSelection) {
          items.push({
            id: 'removeVerticalPageBreak',
            label: 'Remove page break',
            icon: <PageBreakIcon />,
            dividerAfter: true,
            onClick: actions.removeVerticalPageBreak,
          });
        } else {
          items.push({
            id: 'insertVerticalPageBreak',
            label: 'Insert page break',
            icon: <PageBreakIcon />,
            dividerAfter: true,
            onClick: actions.insertVerticalPageBreak,
          });
        }
      }
    }

    // === Sparkline Section ===
    if (actions.hasSparklineAtActiveCell && (target === 'cell' || target === 'selection')) {
      // Add divider before sparkline section if there isn't one
      if (items.length > 0 && !items[items.length - 1].dividerAfter) {
        items[items.length - 1].dividerAfter = true;
      }

      items.push({
        id: 'editSparkline',
        label: 'Edit Sparkline...',
        icon: <SparklineIcon />,
        onClick: actions.editSparkline,
      });

      // Ungroup sparklines - only show for sparklines in a group
      if (actions.isSparklineInGroup) {
        items.push({
          id: 'ungroupSparkline',
          label: 'Ungroup Sparklines',
          icon: <SparklineIcon />,
          onClick: actions.ungroupSparkline,
        });
      }

      items.push({
        id: 'clearSparkline',
        label: 'Clear Sparkline',
        icon: <SparklineIcon />,
        danger: true,
        dividerAfter: true,
        onClick: actions.clearSparkline,
      });
    }

    // === Merge Cells Section ===
    // Only show for cell/selection targets with multi-cell selection
    if ((target === 'cell' || target === 'selection') && (actions.canMerge || actions.canUnmerge)) {
      // Add divider before merge section if there isn't one
      if (items.length > 0 && !items[items.length - 1].dividerAfter) {
        items[items.length - 1].dividerAfter = true;
      }

      // Merge & Center
      items.push({
        id: 'mergeAndCenter',
        label: 'Merge & Center',
        icon: <MergeCellsIcon />,
        shortcut: 'Ctrl+Shift+M',
        disabled: !actions.canMerge,
        onClick: actions.mergeAndCenter,
      });

      // Merge Cells (without centering)
      items.push({
        id: 'mergeCells',
        label: 'Merge Cells',
        icon: <MergeCellsIcon />,
        disabled: !actions.canMerge,
        onClick: actions.mergeCells,
      });

      // Unmerge Cells
      items.push({
        id: 'unmergeCells',
        label: 'Unmerge Cells',
        icon: <UnmergeCellsIcon />,
        disabled: !actions.canUnmerge,
        dividerAfter: true,
        onClick: actions.unmergeCells,
      });
    }

    // === Sort/Filter Submenus ===
    // Only show for cell targets (not row/column headers - they have their own sort)
    if (target === 'cell' || target === 'selection') {
      // Add divider before sort/filter section if there isn't one
      if (items.length > 0 && !items[items.length - 1].dividerAfter) {
        items[items.length - 1].dividerAfter = true;
      }

      // Sort submenu
      items.push({
        id: 'sort',
        label: 'Sort',
        icon: <SortAscendingIcon />,
        onClick: () => {}, // Parent item - no direct action
        children: [
          {
            id: 'sortAscending',
            label: 'Sort A to Z',
            icon: <SortAscendingIcon />,
            onClick: actions.sortAscending,
          },
          {
            id: 'sortDescending',
            label: 'Sort Z to A',
            icon: <SortDescendingIcon />,
            onClick: actions.sortDescending,
          },
          // Sort by Color options
          {
            id: 'sortByCellColor',
            label: 'Sort by Cell Color',
            onClick: actions.sortByCellColor,
          },
          {
            id: 'sortByFontColor',
            label: 'Sort by Font Color',
            onClick: actions.sortByFontColor,
          },
          {
            id: 'customSort',
            label: 'Custom Sort...',
            icon: <CustomSortIcon />,
            onClick: actions.openCustomSortDialog,
          },
        ],
      });

      // Filter submenu
      items.push({
        id: 'filter',
        label: 'Filter',
        icon: <FilterIcon />,
        dividerAfter: true,
        onClick: () => {}, // Parent item - no direct action
        children: [
          {
            id: 'filterByValue',
            label: 'Filter by Selected Cell Value',
            icon: <FilterIcon />,
            onClick: actions.filterBySelectedValue,
          },
          {
            id: 'filterByColor',
            label: 'Filter by Cell Color',
            icon: <FilterIcon />,
            onClick: actions.filterByColor,
          },
          // Filter by Font Color
          {
            id: 'filterByFontColor',
            label: 'Filter by Font Color',
            icon: <FilterIcon />,
            onClick: actions.filterByFontColor,
          },
          // Re-apply Filter
          {
            id: 'reapplyFilter',
            label: 'Re-apply',
            icon: <FilterIcon />,
            onClick: actions.reapplyFilters,
          },
          {
            id: 'clearFilter',
            label: 'Clear Filter',
            icon: <ClearFilterIcon />,
            onClick: actions.clearFilter,
          },
        ],
      });
    }

    // === Hyperlink Section ===
    // Only show for cell targets (not row/column headers)
    if (target === 'cell' || target === 'selection') {
      // Add divider before hyperlink section if there isn't one
      if (items.length > 0 && !items[items.length - 1].dividerAfter) {
        items[items.length - 1].dividerAfter = true;
      }

      if (actions.hasHyperlinkAtActiveCell) {
        // Cell has hyperlink - show edit, copy, and remove options
        items.push({
          id: 'editHyperlink',
          label: 'Edit Hyperlink...',
          icon: <HyperlinkIcon />,
          shortcut: 'Ctrl+K',
          onClick: actions.editHyperlink,
        });
        // Copy Hyperlink URL
        items.push({
          id: 'copyHyperlink',
          label: 'Copy Hyperlink',
          icon: <CopyIcon />,
          onClick: actions.copyHyperlink,
        });
        items.push({
          id: 'removeHyperlink',
          label: 'Remove Hyperlink',
          icon: <HyperlinkIcon />,
          danger: true,
          dividerAfter: true,
          onClick: actions.removeHyperlink,
        });
      } else {
        // No hyperlink - show insert option
        items.push({
          id: 'insertHyperlink',
          label: 'Hyperlink...',
          icon: <HyperlinkIcon />,
          shortcut: 'Ctrl+K',
          dividerAfter: true,
          onClick: actions.insertHyperlink,
        });
      }
    }

    // === Table Context Menu Section ===
    // Only show when cell is inside a table
    if ((target === 'cell' || target === 'selection') && actions.isInTable) {
      // Add divider before table section if there isn't one
      if (items.length > 0 && !items[items.length - 1].dividerAfter) {
        items[items.length - 1].dividerAfter = true;
      }

      // Table Insert submenu
      items.push({
        id: 'tableInsert',
        label: 'Table Insert',
        icon: <InsertIcon />,
        onClick: () => {},
        children: [
          {
            id: 'insertTableRowAbove',
            label: 'Table Rows Above',
            onClick: actions.insertTableRowAbove,
          },
          {
            id: 'insertTableRowBelow',
            label: 'Table Rows Below',
            onClick: actions.insertTableRowBelow,
          },
          {
            id: 'insertTableColumnLeft',
            label: 'Table Columns to the Left',
            onClick: actions.insertTableColumnLeft,
          },
          {
            id: 'insertTableColumnRight',
            label: 'Table Columns to the Right',
            onClick: actions.insertTableColumnRight,
          },
        ],
      });

      // Table Delete submenu
      items.push({
        id: 'tableDelete',
        label: 'Table Delete',
        icon: <DeleteIcon />,
        onClick: () => {},
        children: [
          {
            id: 'deleteTableRows',
            label: 'Table Rows',
            onClick: actions.deleteTableRows,
          },
          {
            id: 'deleteTableColumns',
            label: 'Table Columns',
            onClick: actions.deleteTableColumns,
          },
        ],
      });

      // Select entire table
      items.push({
        id: 'selectTable',
        label: 'Select Table',
        onClick: actions.selectEntireTable,
      });

      // Convert to range
      items.push({
        id: 'convertToRange',
        label: 'Convert to Range',
        dividerAfter: true,
        onClick: actions.convertTableToRange,
      });
    }

    // === Comment Section ===
    // Only show for cell targets (not row/column headers)
    if (target === 'cell' || target === 'selection') {
      // Add divider before comment section if there isn't one
      if (items.length > 0 && !items[items.length - 1].dividerAfter) {
        items[items.length - 1].dividerAfter = true;
      }

      if (actions.hasCommentAtActiveCell) {
        // Cell has comment - show edit, show/hide, and delete options
        items.push({
          id: 'editComment',
          label: 'Edit Comment',
          icon: <EditCommentIcon />,
          shortcut: 'Shift+F2',
          onClick: actions.editComment,
        });
        // Show/Hide Comment option
        items.push({
          id: 'showHideComment',
          label: 'Show/Hide Comment',
          icon: <EditCommentIcon />,
          shortcut: 'Ctrl+Shift+O',
          onClick: actions.showHideComment,
        });
        items.push({
          id: 'deleteComment',
          label: 'Delete Comment',
          icon: <DeleteCommentIcon />,
          danger: true,
          dividerAfter: true,
          onClick: actions.deleteComment,
        });
      } else {
        // No comment - show insert option
        items.push({
          id: 'insertComment',
          label: 'New Comment',
          icon: <NewCommentIcon />,
          shortcut: 'Shift+F2',
          dividerAfter: true,
          onClick: actions.insertComment,
        });
      }
    }

    // === Format Cells Section (Context Menu Parity) ===
    // Add divider before format cells if there isn't one
    if (items.length > 0 && !items[items.length - 1].dividerAfter) {
      items[items.length - 1].dividerAfter = true;
    }

    items.push({
      id: 'formatCells',
      label: 'Format Cells...',
      icon: <FormatCellsIcon />,
      shortcut: formatCellsShortcut,
      onClick: actions.openFormatCellsDialog,
    });

    // === Data Validation Section ===
    // Only show for cell targets (not row/column headers)
    if (target === 'cell' || target === 'selection') {
      items.push({
        id: 'dataValidation',
        label: 'Data Validation...',
        icon: <FormatCellsIcon />,
        dividerAfter: !actions.hasDropdownAtActiveCell,
        onClick: actions.openDataValidationDialog,
      });

      // Show "Pick From Drop-down List..." if cell has list validation
      if (actions.hasDropdownAtActiveCell) {
        items.push({
          id: 'pickFromDropdown',
          label: 'Pick From Drop-down List...',
          shortcut: 'Alt+Down',
          dividerAfter: true,
          onClick: actions.openDropdown,
        });
      }
    } else {
      // For row/column headers, add divider after format cells
      items[items.length - 1].dividerAfter = true;
    }

    // === Define Name (for cell targets only) ===
    if (target === 'cell' || target === 'selection') {
      items.push({
        id: 'defineName',
        label: 'Define Name...',
        onClick: actions.openDefineNameDialog,
      });
    }

    // === Show Formulas Option ===
    // Available for all cell targets - shows checkmark when active
    if (target === 'cell' || target === 'selection') {
      items.push({
        id: 'showFormulas',
        label: 'Show Formulas',
        shortcut: 'Ctrl+`',
        checked: actions.isShowingFormulas,
        onClick: actions.toggleShowFormulas,
      });
    }

    // === Manage Rules (Conditional Formatting) ===
    // Show when cell has conditional formatting applied
    if ((target === 'cell' || target === 'selection') && actions.hasCFAtActiveCell) {
      items.push({
        id: 'manageCFRules',
        label: 'Manage Rules...',
        dividerAfter: true,
        onClick: actions.openCFRulesManager,
      });
    }

    // === Clear Section ===
    items.push({
      id: 'clearContents',
      label: 'Clear contents',
      icon: <ClearIcon />,
      onClick: actions.clearContents,
    });

    items.push({
      id: 'clearFormatting',
      label: 'Clear formatting',
      icon: <ClearIcon />,
      onClick: actions.clearFormatting,
    });

    // In read-only mode, filter to non-mutating items only
    if (readOnly) {
      return items.filter((item) => READ_ONLY_ALLOWED_IDS.has(item.id));
    }

    return items;
  }, [target, actions, readOnly, formatCellsShortcut]);

  return (
    <ContextMenuContent
      className="py-1 min-w-[200px]"
      data-testid="context-menu"
      onCloseAutoFocus={(e) => e.preventDefault()}
    >
      <MenuItemRenderer items={menuItems} onClose={onClose} />
    </ContextMenuContent>
  );
}
