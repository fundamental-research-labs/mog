/**
 * DialogLayer Component
 *
 * Renders ALL self-subscribing dialogs for the SpreadsheetApp.
 * These dialogs subscribe to their own open state via UIStore hooks,
 * so they don't require props from parent components.
 *
 * Architecture:
 * - Apps own their chrome - dialogs ARE chrome
 * - Single source of truth - all dialogs in one place
 * - Self-subscribing pattern - dialogs manage their own visibility
 *
 */

// =============================================================================
// Navigation Dialogs
// =============================================================================
import { GoToDialog } from '../../dialogs/navigation/GoToDialog';
import { GoToSpecialDialog } from '../../dialogs/navigation/GoToSpecialDialog';

// =============================================================================
// Protection Dialogs
// =============================================================================
import { ProtectSheetDialog } from '../../dialogs/protection/ProtectSheetDialog';
import { ProtectWorkbookDialog } from '../../dialogs/protection/ProtectWorkbookDialog';
import { UnprotectSheetDialog } from '../../dialogs/protection/UnprotectSheetDialog';

// =============================================================================
// Warning/Conflict Dialogs
// =============================================================================
import { MergeWarningDialog } from '../../dialogs/confirmations/MergeWarningDialog';
import { DragDropOverwriteDialog } from '../../dialogs/fill/DragDropOverwriteDialog';

// =============================================================================
// Fill Dialogs
// =============================================================================
import { FillMergeConflictDialog } from '../../dialogs/fill/FillMergeConflictDialog';
import { FillSeriesDialog } from '../../dialogs/fill/FillSeriesDialog';

// =============================================================================
// Insert/Edit Dialogs
// =============================================================================
import { InsertCellsDialog } from '../../dialogs/insert/InsertCellsDialog';
import { InsertHyperlinkDialog } from '../../dialogs/insert/InsertHyperlinkDialog';

// =============================================================================
// Page Setup & Print Dialogs
// =============================================================================
import { PageSetupDialog } from '../../dialogs/print/PageSetupDialog';
import { PrintPdfDialogWrapper } from '../../dialogs/print/PrintPdfDialog';

// =============================================================================
// Format Dialogs
// =============================================================================
import { ColumnWidthDialogWrapper } from '../../dialogs/formatting/ColumnWidthDialog';
import { FormatCellsDialogWrapper } from '../../dialogs/formatting/FormatCellsDialog';
import { RowHeightDialogWrapper } from '../../dialogs/formatting/RowHeightDialog';

// =============================================================================
// Conditional Formatting Dialogs
// =============================================================================
import { CFRulesManager } from '../../dialogs/formatting/CFRulesManager';
import { ConditionalFormatDialogWrapper } from '../../dialogs/formatting/ConditionalFormatDialog';
import { HighlightRuleDialogs } from '../../dialogs/formatting/HighlightRuleDialogs';
import { TopBottomRuleDialogs } from '../../dialogs/formatting/TopBottomRuleDialogs';

// =============================================================================
// Data Validation Dialog
// =============================================================================
import { DataValidationDialogWrapper } from '../../dialogs/data/DataValidationDialog';

// =============================================================================
// Sort Dialog
// =============================================================================
import { SortDialog } from '../../dialogs/data/SortDialog';

// =============================================================================
// Filter Dialogs
// =============================================================================
import { AdvancedFilterDialog } from '../../dialogs/data/AdvancedFilterDialog';

// =============================================================================
// Chart Dialogs
// =============================================================================
import { SelectDataDialog } from '../../dialogs/charts/SelectDataDialog';
import { InsertChartWizardDialog } from '../../dialogs/insert/InsertChartWizardDialog';

// =============================================================================
// Pivot Table Dialog
// =============================================================================
import { CreatePivotDialog } from '../../components/pivot';

// =============================================================================
// Settings Dialogs
// =============================================================================
import { SpreadSettingsDialog } from '../../dialogs/settings/SpreadSettingsDialog';
import { SheetSettingsDialog } from '../../dialogs/sheet/SheetSettingsDialog';

// =============================================================================
// Named Ranges Dialogs
// =============================================================================
import { CreateNamesFromSelectionDialogWrapper } from '../../dialogs/formulas/CreateNamesFromSelectionDialog';
import { DefineNameDialogWrapper } from '../../dialogs/formulas/DefineNameDialog';
import { NameManagerDialog } from '../../dialogs/formulas/NameManagerDialog';

// =============================================================================
// Search & Command Dialogs
// =============================================================================
import { CommandPalette } from '../../dialogs/navigation/CommandPalette';
import { FindReplaceDialog } from '../../dialogs/navigation/FindReplaceDialog';

// =============================================================================
// Table Dialogs
// =============================================================================
import { TableStyleDialog } from '../../dialogs/formatting/TableStyleDialog';
import { ConfirmConvertToRangeDialog } from '../../dialogs/sheet/ConfirmConvertToRangeDialog';
import { DeleteSheetConfirmDialog } from '../../dialogs/sheet/DeleteSheetConfirmDialog';

// =============================================================================
// Data Analysis Dialogs
// =============================================================================
import { DataTableDialog } from '../../dialogs/data/DataTableDialog';
import { ConsolidateDialog } from '../../dialogs/data/ConsolidateDialog';
import { GoalSeekDialog } from '../../dialogs/formulas/GoalSeekDialog';
import { ScenarioManagerDialog } from '../../dialogs/tools/ScenarioManagerDialog';

// =============================================================================
// Formula Auditing & Proofing Dialogs
// =============================================================================
import { ErrorCheckingDialog } from '../../dialogs/formulas/ErrorCheckingDialog';
import { EvaluateFormulaDialog } from '../../dialogs/formulas/EvaluateFormulaDialog';
import { WatchWindow } from '../../dialogs/formulas/WatchWindow';
import { SpellingDialog } from '../../dialogs/tools/SpellingDialog';
import { ThesaurusDialog } from '../../dialogs/tools/ThesaurusDialog';
import { WorkbookStatisticsDialog } from '../../dialogs/tools/WorkbookStatisticsDialog';

// =============================================================================
// File menu view
// =============================================================================
import { BackstageView } from '../toolbar/backstage';

// =============================================================================
// Diagram, TextEffect & Equation Dialogs
// =============================================================================
import { TextEffectGallery } from '../../components/text-effects';
import { DiagramDialog } from '../../dialogs/charts/DiagramDialog';
import { EquationEditorDialog } from '../../dialogs/equation';

// =============================================================================
// Keyboard Shortcuts Dialog
// =============================================================================
import { KeyboardShortcutsDialogWrapper } from '../../dialogs/settings/KeyboardShortcutsDialog';

// =============================================================================
// Component
// =============================================================================

/**
 * DialogLayer - Renders all self-subscribing dialogs
 *
 * These dialogs subscribe to their own open state via UIStore hooks.
 * They don't need props to determine visibility - they manage it internally.
 *
 */
export function DialogLayer() {
  return (
    <>
      {/* ===================================================================== */}
      {/* Navigation Dialogs */}
      {/* ===================================================================== */}
      {/* Go To Dialog (F5 / Ctrl+G - Excel Parity A7) */}
      <GoToDialog />
      {/* Go To Special Dialog (Excel Parity 14.1) */}
      <GoToSpecialDialog />

      {/* ===================================================================== */}
      {/* Protection Dialogs */}
      {/* ===================================================================== */}
      {/* Protect Sheet Dialog */}
      <ProtectSheetDialog />
      {/* Unprotect Sheet Dialog */}
      <UnprotectSheetDialog />
      {/* Protect Workbook Dialog */}
      <ProtectWorkbookDialog />

      {/* ===================================================================== */}
      {/* Warning/Conflict Dialogs */}
      {/* ===================================================================== */}
      {/* Merge Warning Dialog */}
      <MergeWarningDialog />
      {/* Drag-Drop Overwrite Warning Dialog */}
      <DragDropOverwriteDialog />

      {/* ===================================================================== */}
      {/* Fill Dialogs */}
      {/* ===================================================================== */}
      {/* Fill Series Dialog (Excel Parity A9) */}
      <FillSeriesDialog />
      {/* Fill Merge Conflict Dialog */}
      <FillMergeConflictDialog />

      {/* ===================================================================== */}
      {/* Insert/Edit Dialogs */}
      {/* ===================================================================== */}
      {/* Insert/Delete Cells Dialog */}
      <InsertCellsDialog />
      {/* Insert Hyperlink Dialog */}
      <InsertHyperlinkDialog />

      {/* ===================================================================== */}
      {/* Page Setup Dialog */}
      {/* ===================================================================== */}
      {/* Page Setup Dialog (Excel Parity A10) */}
      <PageSetupDialog />
      {/* Print / Export PDF Dialog */}
      <PrintPdfDialogWrapper />

      {/* ===================================================================== */}
      {/* Format Dialogs */}
      {/* ===================================================================== */}
      {/* Format Cells Dialog (Ctrl+1 - Excel Parity A6) */}
      <FormatCellsDialogWrapper />
      {/* Row Height / Column Width Dialogs (Format menu + context menu) */}
      <RowHeightDialogWrapper />
      <ColumnWidthDialogWrapper />

      {/* ===================================================================== */}
      {/* Conditional Formatting Dialogs */}
      {/* ===================================================================== */}
      {/* Conditional Formatting Dialog */}
      <ConditionalFormatDialogWrapper />
      {/* Conditional Formatting Quick Dialogs ( & 3) */}
      <HighlightRuleDialogs />
      <TopBottomRuleDialogs />
      {/* Conditional Formatting Rules Manager */}
      <CFRulesManager />

      {/* ===================================================================== */}
      {/* Data Validation Dialog */}
      {/* ===================================================================== */}
      {/* Data Validation Dialog */}
      <DataValidationDialogWrapper />

      {/* ===================================================================== */}
      {/* Sort Dialogs */}
      {/* ===================================================================== */}
      {/* Sort Dialog (multi-column custom sort —) */}
      <SortDialog />

      {/* ===================================================================== */}
      {/* Filter Dialogs */}
      {/* ===================================================================== */}
      {/* Advanced Filter Dialog */}
      <AdvancedFilterDialog />
      {/* ===================================================================== */}
      {/* Chart Dialogs */}
      {/* ===================================================================== */}
      {/* Select Data Dialog (Chart Data/Series Management) */}
      <SelectDataDialog />
      {/* Insert Chart Wizard Dialog */}
      <InsertChartWizardDialog />

      {/* ===================================================================== */}
      {/* Pivot Table Dialog */}
      {/* ===================================================================== */}
      {/* Pivot Table Dialog */}
      <CreatePivotDialog />

      {/* ===================================================================== */}
      {/* Settings Dialogs */}
      {/* ===================================================================== */}
      {/* Settings Dialogs (Settings & Toggles) */}
      <SpreadSettingsDialog />
      <SheetSettingsDialog />

      {/* ===================================================================== */}
      {/* Named Ranges Dialogs */}
      {/* ===================================================================== */}
      {/* Named Ranges Dialogs */}
      <DefineNameDialogWrapper />
      <NameManagerDialog />
      {/* Create Names from Selection Dialog */}
      <CreateNamesFromSelectionDialogWrapper />

      {/* ===================================================================== */}
      {/* Search & Command Dialogs */}
      {/* ===================================================================== */}
      {/* Command Palette */}
      <CommandPalette />
      {/* Find & Replace Dialog */}
      <FindReplaceDialog />

      {/* ===================================================================== */}
      {/* Table Dialogs */}
      {/* ===================================================================== */}
      {/* Custom Table Styles */}
      <TableStyleDialog />
      {/* Convert to Range Confirmation */}
      <ConfirmConvertToRangeDialog />
      {/* Delete Sheet Confirmation */}
      <DeleteSheetConfirmDialog />

      {/* ===================================================================== */}
      {/* Data Analysis Dialogs */}
      {/* ===================================================================== */}
      {/* Goal Seek Dialog */}
      <GoalSeekDialog />
      {/* Data Table Dialog */}
      <DataTableDialog />
      {/* Consolidate Dialog */}
      <ConsolidateDialog />
      {/* Scenario Manager Dialog */}
      <ScenarioManagerDialog />

      {/* ===================================================================== */}
      {/* Formula Auditing & Proofing Dialogs */}
      {/* ===================================================================== */}
      {/* Watch Window */}
      <WatchWindow />
      {/* Spelling Dialog */}
      <SpellingDialog />
      {/* Thesaurus Dialog */}
      <ThesaurusDialog />
      {/* Error Checking Dialog */}
      <ErrorCheckingDialog />
      {/* Evaluate Formula Dialog */}
      <EvaluateFormulaDialog />
      {/* Workbook Statistics Dialog */}
      <WorkbookStatisticsDialog />

      {/* ===================================================================== */}
      {/* File menu view */}
      {/* ===================================================================== */}
      {/* File menu view */}
      <BackstageView />

      {/* ===================================================================== */}
      {/* Diagram, TextEffect & Equation Dialogs */}
      {/* ===================================================================== */}
      {/* Diagram Insert Dialog (Excel Parity - Diagram Feature) */}
      <DiagramDialog />
      {/* TextEffect Gallery (Excel Parity - TextEffect Feature) */}
      <TextEffectGallery />
      {/* Equation Editor Dialog (Excel Parity - Equation Feature) */}
      <EquationEditorDialog />

      {/* ===================================================================== */}
      {/* Keyboard Shortcuts Dialog */}
      {/* ===================================================================== */}
      {/* Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialogWrapper />
    </>
  );
}
