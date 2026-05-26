/**
 * Internal API
 *
 * Canonical cross-module surface for `apps/spreadsheet/src/**`.
 *
 * Two-part contract:
 *
 * 1. Component prop interfaces + shared type aliases used internally by shell
 * components (Toolbar, FormulaBar, SheetTabs, BorderPicker, etc.).
 * 2. Re-exports of the ~30 hooks/utilities that internal modules used to pull
 * from `apps/spreadsheet/src/index.tsx` via `'../..'` / `'../../..'`.
 * Those imports created ~132 madge cycles because `index.tsx` also
 * re-exports the same files via `./exports`. This module is the
 * cycle-breaker: it imports each symbol from its owning source file
 * (never via a barrel that re-exports the consumers), so internal files
 * can depend on it without closing a loop through `index.tsx`.
 *
 * Rule: `internal-api.ts` is the *upstream* surface. It may be imported from
 * anywhere in `apps/spreadsheet/src/**`, but it must not itself import from
 * barrels (`./hooks`, `./exports`, `./coordinator`, `./infra/context`, etc.)
 * — only from the concrete source files. Adding a new re-export here
 * therefore requires picking the defining file directly.
 *
 */

import type { CSSProperties } from 'react';

// Re-export types from contracts that components need
import type { FunctionInfo as ContractFunctionInfo } from '@mog-sdk/contracts/api';
import type {
  CellAddress as ContractCellAddress,
  CellRange as ContractCellRange,
  SheetId,
} from '@mog-sdk/contracts/core';
import type { FunctionArgument as ContractFunctionArgument } from '@mog-sdk/contracts/utils';
import type { WorkflowCellValue } from '@mog-sdk/contracts/workflows';

export type FunctionInfo = ContractFunctionInfo;
export type FunctionArgument = ContractFunctionArgument;
export type CellAddress = ContractCellAddress;
export type CellRange = ContractCellRange;
export type { SheetId };
export type CellValue = WorkflowCellValue;

// =============================================================================
// Cross-module hook + utility surface
// =============================================================================
// Imported from their *source* files, never from barrels. Internal modules
// (chrome/**, components/**, dialogs/**) should import from `internal-api`
// instead of the app entry (`'../..'` / `'../../..'`) to avoid cycling
// through `index.tsx`.

// --- Action dispatch ---
export { dispatch } from './actions/dispatcher';

// --- Document / UI store context (per-document) ---
export {
  useActiveSheetId,
  useDocumentContext,
  useReadOnly,
  useUIStore,
  useUIStoreApi,
  useWorkbook,
  useZoomLevels,
} from './infra/context/document-context';

// --- Feature gates ---
export { useFeatureGate, useFeatureGates } from './infra/context/feature-gates-context';

// --- Selection hooks ---
export { useActiveCell } from './hooks/selection/use-active-cell';
export { useSelectionRanges } from './hooks/selection/use-granular-selection';

// --- Editor / clipboard hooks ---
export { useClipboard } from './hooks/editing/use-clipboard';
export { useEditorActions } from './hooks/editing/use-editor-actions';
export { useEditorState } from './hooks/editing/use-editor-state';

// --- Navigation hooks ---
export { useFindReplace } from './hooks/navigation/use-find-replace';
export { useFocus } from './hooks/navigation/use-focus';

// --- View / renderer hooks ---
export { useRendererActions } from './hooks/view/use-renderer-actions';

// --- Data hooks ---
export { useConditionalFormatting } from './hooks/data/use-conditional-formatting';
export { useSparklineManager } from './hooks/data/use-sparkline-manager';

// --- File IO hooks ---
export { usePrintSettings } from './hooks/file-io/use-sheet-print-settings';
export { usePrintArea } from './hooks/file-io/use-print-area';

// --- Settings hooks ---
export { useWorkbookSettings } from './hooks/settings/use-workbook-settings';

// --- Print/view state hooks (read-only) ---
export { usePageBreaks } from './hooks/view/use-page-breaks';
export { useSheetViewOptions } from './hooks/view/use-sheet-view-options';

// --- Shared / coordinator hooks ---
export { useCoordinator } from './hooks/shared/use-coordinator';
export {
  useCFDialog,
  useDVDialog,
  useIsRulesManagerOpen,
  useQuickRuleDialog,
} from './hooks/shared/ui-store-hooks';

// --- Toolbar / action dependency hooks ---
export { useActionDependencies, useDispatch } from './hooks/toolbar/use-action-dependencies';

// --- UI components used across chrome/dialogs ---
export { CollapsibleRangeInput } from './components/ui/CollapsibleRangeInput';
export { MinimizableDialog } from './components/ui/radix/MinimizableDialog';

// =============================================================================
// Toolbar Types
// =============================================================================

/**
 * Text alignment values for cells
 */
export type TextAlign = 'left' | 'center' | 'right';

/**
 * Vertical alignment values for cells
 */
export type VerticalAlign = 'top' | 'middle' | 'bottom';

/**
 * Props for the Toolbar component.
 * Provides formatting state and callbacks for cell formatting controls.
 */
export interface ToolbarProps {
  // Font formatting state
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  isStrikethrough: boolean;

  // Alignment state
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  wordWrap: boolean;

  // Number format state
  numberFormat: string;

  // Font state
  fontFamily?: string;
  fontSize?: number;
  fontColor?: string;
  backgroundColor?: string;

  // Font formatting callbacks
  onBoldClick: () => void;
  onItalicClick: () => void;
  onUnderlineClick: () => void;
  onStrikethroughClick: () => void;

  // Alignment callbacks
  onTextAlignChange: (align: TextAlign) => void;
  onVerticalAlignChange: (align: VerticalAlign) => void;
  onWordWrapClick: () => void;

  // Number format callback
  onNumberFormatChange: (format: string) => void;

  // Font callbacks (optional for legacy toolbar)
  onFontFamilyChange?: (family: string) => void;
  onFontSizeChange?: (size: number) => void;
  onFontColorChange?: (color: string) => void;
  onBackgroundColorChange?: (color: string) => void;

  // Undo/redo state
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;

  // Export
  onExport?: () => void;
  isExporting?: boolean;

  // Conditional formatting
  onConditionalFormat?: () => void;
}

// =============================================================================
// Spreadsheet Types
// =============================================================================

/**
 * Initial data for populating the spreadsheet
 */
export interface SpreadsheetData {
  sheets?: Array<{
    id: string;
    name: string;
    data?: Array<Array<string | number | boolean | null>>;
  }>;
}

/**
 * Selection change event data
 */
export interface SelectionChangeEvent {
  sheetId: string;
  range: {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  };
}

/**
 * Props for the Spreadsheet component.
 * The main public component for rendering a spreadsheet.
 */
export interface SpreadsheetProps {
  /** Initial data to populate the spreadsheet */
  initialData?: SpreadsheetData;

  /** Callback when data changes */
  onChange?: (event: { sheetId: string }) => void;

  /** Callback when selection changes */
  onSelectionChange?: (event: SelectionChangeEvent) => void;

  /** Custom className for the root element */
  className?: string;

  /** Custom styles for the root element */
  style?: CSSProperties;
}

// =============================================================================
// Sheet Tab Types
// =============================================================================

/**
 * Information about a sheet tab
 */
export interface SheetTabInfo {
  /** Sheet ID */
  id: SheetId;
  /** Sheet name */
  name: string;
  /** Tab color (hex string) */
  color?: string | null;
  /** Tab color (alias for color, used by some components) */
  tabColor?: string | null;
  /** Whether the sheet is hidden */
  hidden?: boolean;
  /** Whether the sheet is protected */
  protected?: boolean;
}

/**
 * Props for the SheetTabs component.
 * Manages the tab strip at the bottom of the spreadsheet.
 */
export interface SheetTabsProps {
  /** Array of sheet tab info */
  sheets: SheetTabInfo[];
  /** Currently active sheet ID */
  activeSheetId: SheetId;
  /** Callback when a sheet is selected */
  onSelectSheet: (sheetId: SheetId) => void;
  /** Callback when a new sheet is added */
  onAddSheet: () => void;
  /** Callback when a sheet is renamed. Returns true on success, false on conflict. */
  onRenameSheet: (sheetId: SheetId, name: string) => Promise<boolean>;
  /** Callback when a sheet is deleted */
  onDeleteSheet: (sheetId: SheetId) => void;
  /** Callback when sheets are reordered (by source and target indices) */
  onReorderSheets?: (fromIndex: number, toIndex: number) => void;
  /** Callback when a sheet is copied */
  onCopySheet?: (sheetId: SheetId) => void;
  /** Callback when a sheet's tab color is changed */
  onSetTabColor?: (sheetId: SheetId, color: string | null) => void;
  /** Callback when a sheet is hidden */
  onHideSheet?: (sheetId: SheetId) => void;
  /** Callback when a sheet is unhidden */
  onUnhideSheet?: (sheetId: SheetId) => void;
  /** Array of hidden sheets (for unhide dialog) */
  hiddenSheets?: SheetTabInfo[];
  /** When true, all mutation affordances are hidden/disabled (add, rename, delete, reorder, copy, hide/unhide) */
  readOnly?: boolean;
}

// =============================================================================
// Formula Bar Types
// =============================================================================

/**
 * Reference color range for formula highlighting.
 * Maps character position ranges in the formula to colors.
 * Used to sync formula bar syntax highlighting with grid range box colors.
 */
export interface ReferenceColorRange {
  /** Start position in formula string (0-indexed) */
  startPos: number;
  /** End position in formula string (exclusive) */
  endPos: number;
  /** Color for this reference (from FORMULA_RANGE_COLORS) */
  color: string;
}

/**
 * Props for the FormulaBar component.
 * Displays and edits the formula/value of the selected cell.
 */
export interface FormulaBarProps {
  /** Cell address display value (e.g., "A1") - now handled by NameBoxDropdown internally */
  cellAddress?: string;
  /** The displayed formula or value */
  value: string;
  /** Whether the cell is currently being edited */
  isEditing: boolean;
  /**
   * Callback when the value changes. Receives the new string and the DOM
   * caret position (selectionStart) so the editor machine can mirror the
   * real cursor instead of inventing one. See
   */
  onChange: (value: string, cursorPosition: number) => void;
  /** Callback when Enter is pressed to commit */
  onCommit?: () => void;
  /** Callback when Escape is pressed to cancel */
  onCancel?: () => void;
  /** Callback when formula bar gains focus */
  onFocus?: (cursorPosition?: number) => void;
  /** Callback when fx button is clicked */
  onFxClick?: () => void;
  /** Callback for keydown events */
  onKeyDown?: (event: React.KeyboardEvent) => void;
  /** Ref for the input element */
  inputRef?: (el: HTMLInputElement | null) => void;
  /** Callback for context menu */
  onContextMenu?: (event: React.MouseEvent) => void;
  /** Whether the formula bar is expanded (multiline mode) */
  isExpanded?: boolean;
  /** Callback when expand/collapse is toggled */
  onToggleExpand?: () => void;
  /** IME composition start handler - called when composition begins */
  onCompositionStart?: () => void;
  /** IME composition update handler - receives composition text */
  onCompositionUpdate?: (compositionText: string) => void;
  /** IME composition end handler - receives final text */
  onCompositionEnd?: (finalText: string) => void;
  /** Reference color ranges for formula syntax highlighting */
  referenceColors?: ReferenceColorRange[];
  /** When true, formula bar is display-only (no editing, no confirm/cancel buttons) */
  readOnly?: boolean;
}

// =============================================================================
// Border Types
// =============================================================================

/**
 * Border style types matching Excel's 13 border styles
 */
export type BorderStyleType =
  | 'none'
  | 'thin'
  | 'medium'
  | 'thick'
  | 'dashed'
  | 'dotted'
  | 'double'
  | 'hair'
  | 'mediumDashed'
  | 'dashDot'
  | 'mediumDashDot'
  | 'dashDotDot'
  | 'mediumDashDotDot'
  | 'slantDashDot';

/**
 * Border definition for a single side
 */
export interface BorderSide {
  width: number;
  style: BorderStyleType;
  color: string;
}

/**
 * Border selection for the BorderPicker component.
 * Defines which borders to apply and their styles.
 */
export interface BorderSelection {
  /** Top border */
  top?: BorderSide | null;
  /** Right border */
  right?: BorderSide | null;
  /** Bottom border */
  bottom?: BorderSide | null;
  /** Left border */
  left?: BorderSide | null;
  /** Inside horizontal borders (for multi-cell selection) */
  insideHorizontal?: BorderSide | null;
  /** Inside vertical borders (for multi-cell selection) */
  insideVertical?: BorderSide | null;
  /** Diagonal down border */
  diagonalDown?: BorderSide | null;
  /** Diagonal up border */
  diagonalUp?: BorderSide | null;
}
