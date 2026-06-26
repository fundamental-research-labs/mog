/**
 * Dialog Components
 *
 * Modal dialogs for various spreadsheet features.
 */

export { DataValidationDialog } from './data/DataValidationDialog';
export { FillSeriesDialog } from './fill/FillSeriesDialog';
export { ConditionalFormatDialog } from './formatting/ConditionalFormatDialog';
export { FormatCellsDialog } from './formatting/FormatCellsDialog';
// Insert/Delete Cells Dialog
export { ValidationErrorDialog } from './data/ValidationErrorDialog';
export {
  ValidationWarningDialog,
  enforcementToErrorStyle,
  type ValidationErrorStyle,
} from './data/ValidationWarningDialog';
export {
  FormulaErrorDialog,
  useFormulaErrorDialog,
  type FormulaErrorState,
} from './formulas/FormulaErrorDialog';
export { InsertCellsDialog } from './insert/InsertCellsDialog';
export { GoToDialog } from './navigation/GoToDialog';
export { GoToSpecialDialog } from './navigation/GoToSpecialDialog';
export { PageSetupDialog, type PageSetupDialogProps } from './print/PageSetupDialog';
export { PrintPdfDialog, type PrintPdfDialogProps } from './print/PrintPdfDialog';
export {
  MoveOrCopySheetDialog,
  type MoveOrCopySheetDialogProps,
} from '../chrome/sheet-tabs/MoveOrCopySheetDialog';

// Conditional Formatting Quick Dialogs ( & 3)

// Conditional Formatting Presets

// Conditional Formatting Rules Manager

// Row/Column Resize Dialogs

// Data Tools Dialogs

// Settings Dialogs (Settings & Toggles)

// Hyperlink Dialog
export { InsertHyperlinkDialog } from './insert/InsertHyperlinkDialog';

// Command Palette

// Insert Sparkline Dialog

// Edit Sparkline Dialog

// Insert Picture Dialog

// Format Picture & Edit Alt Text Dialogs (Excel Parity Quick Wins - B2)
export { EditAltTextDialog } from './charts/EditAltTextDialog';
export { FormatPictureDialog } from './charts/FormatPictureDialog';

// Insert Table Dialog

// Subtotals Dialog

// Insert Slicer Dialog
export { InsertSlicerDialog } from './insert/InsertSlicerDialog';

// Protect Sheet Dialog
export { ProtectSheetDialog } from './protection/ProtectSheetDialog';

// Unprotect Sheet Dialog
export { UnprotectSheetDialog } from './protection/UnprotectSheetDialog';

// Protect Workbook Dialog
export { ProtectWorkbookDialog } from './protection/ProtectWorkbookDialog';

// Merge Warning Dialog
export { MergeWarningDialog } from './confirmations/MergeWarningDialog';

// Paste Size Mismatch Dialog
export { PasteSizeMismatchDialog } from './paste/PasteSizeMismatchDialog';

// Advanced Filter Dialog
export { AdvancedFilterDialog } from './data/AdvancedFilterDialog';

// Insert Chart Wizard Dialog
export { InsertChartWizardDialog } from './insert/InsertChartWizardDialog';

// Select Data Dialog (Chart Data/Series Management)
export { SelectDataDialog } from './charts/SelectDataDialog';

// Drag-Drop Overwrite Warning Dialog
export { DragDropOverwriteDialog } from './fill/DragDropOverwriteDialog';

// Paste Validation Summary Dialog
export { PasteValidationSummaryDialog } from './paste/PasteValidationSummaryDialog';

// Table Dialogs
export { ConfirmConvertToRangeDialog } from './sheet/ConfirmConvertToRangeDialog';
export { ResizeTableDialog } from './sheet/ResizeTableDialog';

// Slicer Dialogs
export { SlicerConnectionsDialog } from './connections/SlicerConnectionsDialog';

// Fill Dialogs
export { FillMergeConflictDialog } from './fill/FillMergeConflictDialog';
export { LargeFillConfirmationDialog } from './fill/LargeFillConfirmationDialog';
// Thesaurus Dialog
export { ThesaurusDialog } from './tools/ThesaurusDialog';

// Paste Special Dialog
export { PasteSpecialDialog } from './paste/PasteSpecialDialog';

// Diagram Insert Dialog
export { DiagramDialog } from './charts/DiagramDialog';

// Equation Editor Dialog
export {
  ALL_EQUATION_TEMPLATES,
  CATEGORY_DISPLAY_NAMES,
  EQUATION_TEMPLATES_BY_CATEGORY,
  EquationEditorDialog,
  EquationPreview,
  EquationPreviewSmall,
  EquationTemplateGallery,
  getRecentTemplates,
  getTemplateById,
  getTemplatesForCategory,
} from './equation';
export type {
  EquationEditorDialogProps,
  EquationPreviewProps,
  EquationPreviewSmallProps,
  EquationTemplateGalleryProps,
} from './equation';

// Keyboard Shortcuts Dialog
export {
  KeyboardShortcutsDialog,
  KeyboardShortcutsDialogWrapper,
  useKeyboardShortcutsDialogStore,
} from './settings/KeyboardShortcutsDialog';
export type { KeyboardShortcutsDialogProps } from './settings/KeyboardShortcutsDialog';
