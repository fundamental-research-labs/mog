/**
 * Built-in Commands Registration
 *
 * Registers all built-in commands for the Command Palette.
 * Commands are organized by category (Edit, Format, View, Insert, Data, Formulas).
 *
 * Usage:
 * ```typescript
 * // In a React component with access to all action handlers:
 * useEffect(() => {
 * registerBuiltInCommands(actions);
 * return => unregisterBuiltInCommands;
 * }, [actions]);
 * ```
 *
 * Design notes:
 * - Commands are registered with their keyboard shortcuts for display
 * - Handlers are passed in from the calling component (no hooks at module scope)
 * - Commands can be enabled/disabled based on application state
 */

import type { Command, CommandRegistration } from '@mog-sdk/contracts/commands';

import { commandRegistry } from './command-registry';

// =============================================================================
// Command Action Handlers Interface
// =============================================================================

/**
 * All action handlers that can be registered as commands.
 * These are typically provided by hooks like useToolbarActions, useGridKeyboard, etc.
 */
export interface CommandActions {
  // ===========================================================================
  // Edit
  // ===========================================================================
  copy?: () => void;
  cut?: () => void;
  paste?: () => void;
  pasteSpecial?: () => void;
  undo?: () => void;
  redo?: () => void;
  deleteSelection?: () => void;
  selectAll?: () => void;
  clearFormat?: () => void;

  // ===========================================================================
  // Format - Text
  // ===========================================================================
  toggleBold?: () => void;
  toggleItalic?: () => void;
  toggleUnderline?: () => void;
  toggleStrikethrough?: () => void;

  // ===========================================================================
  // Format - Alignment
  // ===========================================================================
  alignLeft?: () => void;
  alignCenter?: () => void;
  alignRight?: () => void;
  alignTop?: () => void;
  alignMiddle?: () => void;
  alignBottom?: () => void;
  toggleWordWrap?: () => void;

  // ===========================================================================
  // Format - Number
  // ===========================================================================
  formatGeneral?: () => void;
  formatNumber?: () => void;
  formatCurrency?: () => void;
  formatPercentage?: () => void;
  formatDate?: () => void;
  formatTime?: () => void;
  formatScientific?: () => void;

  // ===========================================================================
  // View
  // ===========================================================================
  toggleShowFormulas?: () => void;
  toggleGridlines?: () => void;
  toggleRowHeaders?: () => void;
  toggleColumnHeaders?: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  zoomReset?: () => void;
  zoomToSelection?: () => void;
  freezePanes?: () => void;
  freezeTopRow?: () => void;
  freezeFirstColumn?: () => void;
  unfreezePanes?: () => void;

  // ===========================================================================
  // Insert
  // ===========================================================================
  insertRowAbove?: () => void;
  insertRowBelow?: () => void;
  insertColumnLeft?: () => void;
  insertColumnRight?: () => void;
  insertChart?: () => void;
  insertPivotTable?: () => void;
  insertFunction?: () => void;
  insertHyperlink?: () => void;

  // ===========================================================================
  // Data
  // ===========================================================================
  sortAscending?: () => void;
  sortDescending?: () => void;
  removeDuplicates?: () => void;
  textToColumns?: () => void;

  // ===========================================================================
  // Formulas
  // ===========================================================================
  calculateNow?: () => void;
  calculateSheet?: () => void;
  openInsertFunctionDialog?: () => void;
  toggleCalculationMode?: () => void;

  // ===========================================================================
  // Selection
  // ===========================================================================
  goToCell?: () => void;
  findAndReplace?: () => void;

  // ===========================================================================
  // File
  // ===========================================================================
  exportXlsx?: () => void;
  print?: () => void;
  printPreview?: () => void;

  // ===========================================================================
  // Help
  // ===========================================================================
  showKeyboardShortcuts?: () => void;
}

// =============================================================================
// Built-in Command Definitions
// =============================================================================

/**
 * Creates all built-in command definitions.
 * Commands are defined separately from handlers to allow static analysis.
 */
function createBuiltInCommands(actions: CommandActions): CommandRegistration[] {
  const registrations: CommandRegistration[] = [];

  // Helper to add a command only if its handler exists
  const addCommand = (command: Command, handler: (() => void) | undefined) => {
    if (handler) {
      registrations.push({ command, handler });
    }
  };

  // ===========================================================================
  // Edit Commands
  // ===========================================================================

  addCommand(
    {
      id: 'edit.copy',
      label: 'Copy',
      category: 'Edit',
      shortcut: 'Ctrl+C',
      icon: 'copy',
      description: 'Copy selection to clipboard',
      keywords: ['clipboard', 'duplicate'],
    },
    actions.copy,
  );

  addCommand(
    {
      id: 'edit.cut',
      label: 'Cut',
      category: 'Edit',
      shortcut: 'Ctrl+X',
      icon: 'cut',
      description: 'Cut selection to clipboard',
      keywords: ['clipboard', 'move'],
    },
    actions.cut,
  );

  addCommand(
    {
      id: 'edit.paste',
      label: 'Paste',
      category: 'Edit',
      shortcut: 'Ctrl+V',
      icon: 'paste',
      description: 'Paste from clipboard',
      keywords: ['clipboard'],
    },
    actions.paste,
  );

  addCommand(
    {
      id: 'edit.pasteSpecial',
      label: 'Paste Special...',
      category: 'Edit',
      shortcut: 'Ctrl+Shift+V',
      icon: 'paste',
      description: 'Paste with options (values, formulas, formatting)',
      keywords: ['clipboard', 'values', 'formulas', 'formatting'],
    },
    actions.pasteSpecial,
  );

  addCommand(
    {
      id: 'edit.undo',
      label: 'Undo',
      category: 'Edit',
      shortcut: 'Ctrl+Z',
      icon: 'undo',
      description: 'Undo last action',
      keywords: ['revert', 'back'],
    },
    actions.undo,
  );

  addCommand(
    {
      id: 'edit.redo',
      label: 'Redo',
      category: 'Edit',
      shortcut: 'Ctrl+Y',
      icon: 'redo',
      description: 'Redo last undone action',
      keywords: ['forward'],
    },
    actions.redo,
  );

  addCommand(
    {
      id: 'edit.delete',
      label: 'Delete Selection',
      category: 'Edit',
      shortcut: 'Delete',
      icon: 'delete',
      description: 'Clear contents of selected cells',
      keywords: ['clear', 'remove', 'backspace'],
    },
    actions.deleteSelection,
  );

  addCommand(
    {
      id: 'edit.selectAll',
      label: 'Select All',
      category: 'Edit',
      shortcut: 'Ctrl+A',
      icon: 'selectAll',
      description: 'Select all cells in the sheet',
      keywords: ['highlight', 'entire'],
    },
    actions.selectAll,
  );

  addCommand(
    {
      id: 'edit.clearFormat',
      label: 'Clear Formatting',
      category: 'Edit',
      icon: 'clearFormat',
      description: 'Remove all formatting from selected cells',
      keywords: ['reset', 'remove', 'style'],
    },
    actions.clearFormat,
  );

  // ===========================================================================
  // Format - Text Commands
  // ===========================================================================

  addCommand(
    {
      id: 'format.bold',
      label: 'Toggle Bold',
      category: 'Format',
      shortcut: 'Ctrl+B',
      icon: 'bold',
      description: 'Make text bold or remove bold',
      keywords: ['font', 'weight', 'strong'],
    },
    actions.toggleBold,
  );

  addCommand(
    {
      id: 'format.italic',
      label: 'Toggle Italic',
      category: 'Format',
      shortcut: 'Ctrl+I',
      icon: 'italic',
      description: 'Make text italic or remove italic',
      keywords: ['font', 'slant', 'emphasis'],
    },
    actions.toggleItalic,
  );

  addCommand(
    {
      id: 'format.underlineType',
      label: 'Toggle Underline',
      category: 'Format',
      shortcut: 'Ctrl+U',
      icon: 'underline',
      description: 'Underline text or remove underline',
      keywords: ['font', 'line'],
    },
    actions.toggleUnderline,
  );

  addCommand(
    {
      id: 'format.strikethrough',
      label: 'Toggle Strikethrough',
      category: 'Format',
      icon: 'strikethrough',
      description: 'Apply or remove strikethrough',
      keywords: ['font', 'line', 'cross'],
    },
    actions.toggleStrikethrough,
  );

  // ===========================================================================
  // Format - Alignment Commands
  // ===========================================================================

  addCommand(
    {
      id: 'format.alignLeft',
      label: 'Align Left',
      category: 'Format',
      icon: 'alignLeft',
      description: 'Align cell contents to the left',
      keywords: ['horizontal', 'text'],
    },
    actions.alignLeft,
  );

  addCommand(
    {
      id: 'format.alignCenter',
      label: 'Align Center',
      category: 'Format',
      icon: 'alignCenter',
      description: 'Center cell contents horizontally',
      keywords: ['horizontal', 'text', 'middle'],
    },
    actions.alignCenter,
  );

  addCommand(
    {
      id: 'format.alignRight',
      label: 'Align Right',
      category: 'Format',
      icon: 'alignRight',
      description: 'Align cell contents to the right',
      keywords: ['horizontal', 'text'],
    },
    actions.alignRight,
  );

  addCommand(
    {
      id: 'format.alignTop',
      label: 'Align Top',
      category: 'Format',
      icon: 'alignTop',
      description: 'Align cell contents to the top',
      keywords: ['vertical', 'text'],
    },
    actions.alignTop,
  );

  addCommand(
    {
      id: 'format.alignMiddle',
      label: 'Align Middle',
      category: 'Format',
      icon: 'alignMiddle',
      description: 'Center cell contents vertically',
      keywords: ['vertical', 'text', 'center'],
    },
    actions.alignMiddle,
  );

  addCommand(
    {
      id: 'format.alignBottom',
      label: 'Align Bottom',
      category: 'Format',
      icon: 'alignBottom',
      description: 'Align cell contents to the bottom',
      keywords: ['vertical', 'text'],
    },
    actions.alignBottom,
  );

  addCommand(
    {
      id: 'format.wordWrap',
      label: 'Toggle Word Wrap',
      category: 'Format',
      icon: 'wordWrap',
      description: 'Wrap text within the cell',
      keywords: ['text', 'multiline', 'break'],
    },
    actions.toggleWordWrap,
  );

  // ===========================================================================
  // Format - Number Commands
  // ===========================================================================

  addCommand(
    {
      id: 'format.general',
      label: 'Format as General',
      category: 'Format',
      description: 'Apply general number format',
      keywords: ['number', 'default'],
    },
    actions.formatGeneral,
  );

  addCommand(
    {
      id: 'format.number',
      label: 'Format as Number',
      category: 'Format',
      shortcut: 'Ctrl+Shift+1',
      description: 'Apply number format with thousands separator',
      keywords: ['decimal', 'thousands'],
    },
    actions.formatNumber,
  );

  addCommand(
    {
      id: 'format.currency',
      label: 'Format as Currency',
      category: 'Format',
      shortcut: 'Ctrl+Shift+4',
      description: 'Apply currency format',
      keywords: ['money', 'dollar', 'accounting'],
    },
    actions.formatCurrency,
  );

  addCommand(
    {
      id: 'format.percentage',
      label: 'Format as Percentage',
      category: 'Format',
      shortcut: 'Ctrl+Shift+5',
      description: 'Apply percentage format',
      keywords: ['percent', '%'],
    },
    actions.formatPercentage,
  );

  addCommand(
    {
      id: 'format.date',
      label: 'Format as Date',
      category: 'Format',
      shortcut: 'Ctrl+Shift+3',
      description: 'Apply date format',
      keywords: ['day', 'month', 'year'],
    },
    actions.formatDate,
  );

  addCommand(
    {
      id: 'format.time',
      label: 'Format as Time',
      category: 'Format',
      shortcut: 'Ctrl+Shift+2',
      description: 'Apply time format',
      keywords: ['hour', 'minute', 'second'],
    },
    actions.formatTime,
  );

  addCommand(
    {
      id: 'format.scientific',
      label: 'Format as Scientific',
      category: 'Format',
      shortcut: 'Ctrl+Shift+6',
      description: 'Apply scientific notation format',
      keywords: ['exponent', 'exponential'],
    },
    actions.formatScientific,
  );

  // ===========================================================================
  // View Commands
  // ===========================================================================

  addCommand(
    {
      id: 'view.showFormulas',
      label: 'Show Formulas',
      category: 'View',
      shortcut: 'Ctrl+`',
      icon: 'formula',
      description: 'Toggle between showing formulas and values',
      keywords: ['display', 'toggle'],
    },
    actions.toggleShowFormulas,
  );

  addCommand(
    {
      id: 'view.gridlines',
      label: 'Toggle Gridlines',
      category: 'View',
      icon: 'grid',
      description: 'Show or hide cell gridlines',
      keywords: ['lines', 'border', 'display'],
    },
    actions.toggleGridlines,
  );

  addCommand(
    {
      id: 'view.rowHeaders',
      label: 'Toggle Row Headers',
      category: 'View',
      description: 'Show or hide row numbers',
      keywords: ['numbers', 'display'],
    },
    actions.toggleRowHeaders,
  );

  addCommand(
    {
      id: 'view.columnHeaders',
      label: 'Toggle Column Headers',
      category: 'View',
      description: 'Show or hide column letters',
      keywords: ['letters', 'display'],
    },
    actions.toggleColumnHeaders,
  );

  addCommand(
    {
      id: 'view.zoomIn',
      label: 'Zoom In',
      category: 'View',
      shortcut: 'Ctrl++',
      icon: 'zoomIn',
      description: 'Increase zoom level',
      keywords: ['magnify', 'enlarge'],
    },
    actions.zoomIn,
  );

  addCommand(
    {
      id: 'view.zoomOut',
      label: 'Zoom Out',
      category: 'View',
      shortcut: 'Ctrl+-',
      icon: 'zoomOut',
      description: 'Decrease zoom level',
      keywords: ['shrink', 'reduce'],
    },
    actions.zoomOut,
  );

  addCommand(
    {
      id: 'view.zoomReset',
      label: 'Reset Zoom',
      category: 'View',
      shortcut: 'Ctrl+0',
      description: 'Reset zoom to 100%',
      keywords: ['original', 'default'],
    },
    actions.zoomReset,
  );

  addCommand(
    {
      id: 'view.zoomToSelection',
      label: 'Zoom to Selection',
      category: 'View',
      description: 'Zoom and scroll to fit the current selection in view',
      keywords: ['fit', 'selection', 'zoom', 'focus'],
    },
    actions.zoomToSelection,
  );

  addCommand(
    {
      id: 'view.freezePanes',
      label: 'Freeze Panes',
      category: 'View',
      icon: 'freeze',
      description: 'Freeze rows and columns at current selection',
      keywords: ['lock', 'fix', 'scroll'],
    },
    actions.freezePanes,
  );

  addCommand(
    {
      id: 'view.freezeTopRow',
      label: 'Freeze Top Row',
      category: 'View',
      description: 'Freeze the first row',
      keywords: ['lock', 'header'],
    },
    actions.freezeTopRow,
  );

  addCommand(
    {
      id: 'view.freezeFirstColumn',
      label: 'Freeze First Column',
      category: 'View',
      description: 'Freeze the first column',
      keywords: ['lock', 'header'],
    },
    actions.freezeFirstColumn,
  );

  addCommand(
    {
      id: 'view.unfreezePanes',
      label: 'Unfreeze Panes',
      category: 'View',
      description: 'Remove all frozen rows and columns',
      keywords: ['unlock', 'thaw'],
    },
    actions.unfreezePanes,
  );

  // ===========================================================================
  // Insert Commands
  // ===========================================================================

  addCommand(
    {
      id: 'insert.rowAbove',
      label: 'Insert Row Above',
      category: 'Insert',
      icon: 'insertRow',
      description: 'Insert a new row above the current row',
      keywords: ['add', 'new'],
    },
    actions.insertRowAbove,
  );

  addCommand(
    {
      id: 'insert.rowBelow',
      label: 'Insert Row Below',
      category: 'Insert',
      icon: 'insertRow',
      description: 'Insert a new row below the current row',
      keywords: ['add', 'new'],
    },
    actions.insertRowBelow,
  );

  addCommand(
    {
      id: 'insert.columnLeft',
      label: 'Insert Column Left',
      category: 'Insert',
      icon: 'insertColumn',
      description: 'Insert a new column to the left',
      keywords: ['add', 'new'],
    },
    actions.insertColumnLeft,
  );

  addCommand(
    {
      id: 'insert.columnRight',
      label: 'Insert Column Right',
      category: 'Insert',
      icon: 'insertColumn',
      description: 'Insert a new column to the right',
      keywords: ['add', 'new'],
    },
    actions.insertColumnRight,
  );

  addCommand(
    {
      id: 'insert.chart',
      label: 'Insert Chart',
      category: 'Insert',
      icon: 'chart',
      description: 'Create a new chart from selected data',
      keywords: ['graph', 'visualization', 'bar', 'line', 'pie'],
    },
    actions.insertChart,
  );

  addCommand(
    {
      id: 'insert.pivotTable',
      label: 'Insert Pivot Table',
      category: 'Insert',
      shortcut: 'Alt+Shift+P',
      icon: 'pivotTable',
      description: 'Create a new pivot table from selected data',
      keywords: ['summary', 'aggregate', 'analysis'],
    },
    actions.insertPivotTable,
  );

  addCommand(
    {
      id: 'insert.function',
      label: 'Insert Function',
      category: 'Insert',
      icon: 'function',
      description: 'Open the Insert Function dialog',
      keywords: ['formula', 'sum', 'average', 'count'],
    },
    actions.insertFunction,
  );

  addCommand(
    {
      id: 'insert.hyperlink',
      label: 'Insert Hyperlink',
      category: 'Insert',
      shortcut: 'Ctrl+K',
      icon: 'link',
      description: 'Add a hyperlink to the selected cell',
      keywords: ['link', 'url', 'web'],
    },
    actions.insertHyperlink,
  );

  // ===========================================================================
  // Data Commands
  // ===========================================================================

  addCommand(
    {
      id: 'data.sortAscending',
      label: 'Sort Ascending (A-Z)',
      category: 'Data',
      icon: 'sortAsc',
      description: 'Sort selected range from smallest to largest',
      keywords: ['order', 'arrange', 'alphabetical'],
    },
    actions.sortAscending,
  );

  addCommand(
    {
      id: 'data.sortDescending',
      label: 'Sort Descending (Z-A)',
      category: 'Data',
      icon: 'sortDesc',
      description: 'Sort selected range from largest to smallest',
      keywords: ['order', 'arrange', 'reverse'],
    },
    actions.sortDescending,
  );

  addCommand(
    {
      id: 'data.removeDuplicates',
      label: 'Remove Duplicates',
      category: 'Data',
      icon: 'removeDuplicates',
      description: 'Remove duplicate rows from selected range',
      keywords: ['unique', 'distinct', 'clean'],
    },
    actions.removeDuplicates,
  );

  addCommand(
    {
      id: 'data.textToColumns',
      label: 'Text to Columns',
      category: 'Data',
      icon: 'textToColumns',
      description: 'Split text into multiple columns',
      keywords: ['split', 'parse', 'delimiter', 'csv'],
    },
    actions.textToColumns,
  );

  // ===========================================================================
  // Formulas Commands
  // ===========================================================================

  addCommand(
    {
      id: 'formulas.calculateNow',
      label: 'Calculate Now',
      category: 'Formulas',
      shortcut: 'F9',
      icon: 'calculate',
      description: 'Recalculate all formulas in the workbook',
      keywords: ['recalc', 'refresh', 'update'],
    },
    actions.calculateNow,
  );

  addCommand(
    {
      id: 'formulas.calculateSheet',
      label: 'Calculate Sheet',
      category: 'Formulas',
      shortcut: 'Shift+F9',
      icon: 'calculate',
      description: 'Recalculate all formulas in the current sheet',
      keywords: ['recalc', 'refresh', 'update'],
    },
    actions.calculateSheet,
  );

  addCommand(
    {
      id: 'formulas.insertFunction',
      label: 'Insert Function...',
      category: 'Formulas',
      icon: 'function',
      description: 'Open the function browser to insert a formula',
      keywords: ['sum', 'average', 'count', 'vlookup', 'if'],
    },
    actions.openInsertFunctionDialog,
  );

  addCommand(
    {
      id: 'formulas.toggleCalculationMode',
      label: 'Toggle Calculation Mode',
      category: 'Formulas',
      description: 'Switch between automatic and manual calculation',
      keywords: ['auto', 'manual', 'recalc'],
    },
    actions.toggleCalculationMode,
  );

  // ===========================================================================
  // Selection/Navigation Commands
  // ===========================================================================

  addCommand(
    {
      id: 'navigation.goToCell',
      label: 'Go To Cell...',
      category: 'Navigation',
      shortcut: 'Ctrl+G',
      icon: 'goTo',
      description: 'Navigate to a specific cell',
      keywords: ['jump', 'navigate', 'address'],
    },
    actions.goToCell,
  );

  addCommand(
    {
      id: 'navigation.findReplace',
      label: 'Find and Replace...',
      category: 'Navigation',
      shortcut: 'Ctrl+H',
      icon: 'findReplace',
      description: 'Find and replace text in cells',
      keywords: ['search', 'substitute'],
    },
    actions.findAndReplace,
  );

  // ===========================================================================
  // File Commands
  // ===========================================================================

  addCommand(
    {
      id: 'file.export',
      label: 'Export to XLSX',
      category: 'File',
      shortcut: 'Ctrl+Shift+S',
      icon: 'download',
      description: 'Export workbook as XLSX file',
      keywords: ['save', 'download', 'xlsx'],
    },
    actions.exportXlsx,
  );

  addCommand(
    {
      id: 'file.print',
      label: 'Print',
      category: 'File',
      shortcut: 'Ctrl+P',
      icon: 'print',
      description: 'Print the current sheet',
      keywords: ['pdf', 'paper'],
    },
    actions.print,
  );

  addCommand(
    {
      id: 'file.printPreview',
      label: 'Print Preview',
      category: 'File',
      icon: 'printPreview',
      description: 'Preview how the sheet will look when printed',
      keywords: ['pdf', 'page'],
    },
    actions.printPreview,
  );

  // ===========================================================================
  // Help Commands
  // ===========================================================================

  addCommand(
    {
      id: 'help.keyboardShortcuts',
      label: 'Keyboard Shortcuts',
      category: 'Help',
      icon: 'keyboard',
      description: 'Show all keyboard shortcuts',
      keywords: ['hotkeys', 'bindings'],
    },
    actions.showKeyboardShortcuts,
  );

  return registrations;
}

// =============================================================================
// Registration Functions
// =============================================================================

/** Track registered command IDs for cleanup */
let registeredCommandIds: string[] = [];

/**
 * Register all built-in commands with the command registry.
 * Call this from a React component that has access to all action handlers.
 *
 * @param actions - Object containing all action handler functions
 * @returns The list of registered command IDs
 *
 * @example
 * ```typescript
 * const toolbarActions = useToolbarActions();
 * const clipboard = useClipboard();
 *
 * useEffect(() => {
 * const ids = registerBuiltInCommands({
 * copy: clipboard.copySelection,
 * paste: clipboard.pasteToSelection,
 * toggleBold: toolbarActions.handleBoldClick,
 * // ... etc
 * });
 * return => unregisterBuiltInCommands;
 * }, [toolbarActions, clipboard]);
 * ```
 */
export function registerBuiltInCommands(actions: CommandActions): string[] {
  // Unregister any previously registered commands
  unregisterBuiltInCommands();

  // Create and register new commands
  const registrations = createBuiltInCommands(actions);
  commandRegistry.registerMany(registrations);

  // Track registered IDs
  registeredCommandIds = registrations.map((r) => r.command.id);

  return registeredCommandIds;
}

/**
 * Unregister all built-in commands.
 * Call this in cleanup (e.g., useEffect return).
 */
export function unregisterBuiltInCommands(): void {
  for (const id of registeredCommandIds) {
    commandRegistry.unregister(id);
  }
  registeredCommandIds = [];
}

/**
 * Get the list of currently registered built-in command IDs.
 */
export function getRegisteredBuiltInCommandIds(): readonly string[] {
  return registeredCommandIds;
}
