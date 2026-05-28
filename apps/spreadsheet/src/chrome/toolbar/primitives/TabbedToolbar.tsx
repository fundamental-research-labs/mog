/**
 * TabbedToolbar Component
 *
 * Excel-like ribbon toolbar with tabs:
 * - Home: Clipboard, Font, Alignment, Number formatting
 * - Insert: Charts, Pivot Tables
 * - Page Layout: Page setup, sheet options (stub)
 * - Formulas: Function library, formula auditing (stub)
 * - Data: Data validation, sort/filter
 * - Review: Comments, proofing (stub)
 * - View: Gridlines, zoom, freeze panes (stub)
 * - Table Design: Contextual tab (shown when selection is in a table)
 * - Chart Design: Contextual tab (shown when a chart is selected)
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders when parent re-renders.
 */

import type { RibbonTabId } from '@mog-sdk/contracts/actions';
import type { BorderStyle } from '@mog-sdk/contracts/core';
import type { TableStylePreset } from '@mog-sdk/contracts/tables';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { dispatch, useDocumentContext } from '../../../internal-api';
import { RIBBON_BASE_TABS, selectVisibleRibbonTabs } from '../../../ui-store/slices/ribbon';
import type { BorderSelection } from '../../../components/pickers/BorderPicker';
import { DiagramDesignTab } from '../../../components/diagram/DiagramDesignTab';
import { DiagramFormatTab } from '../../../components/diagram/DiagramFormatTab';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';
import type { ToolbarProps } from '../../../internal-api';
import type { UndoHistoryEntry } from '../../../ui-store';
import { RibbonCollapseProvider, useRibbonCollapse } from '../collapse';
import { useContextualTabs } from '../contextual';
import { ChartFormatRibbon } from '../contextual/ChartFormatRibbon';
import { ChartToolsRibbon } from '../contextual/ChartToolsRibbon';
import { PictureToolsRibbon } from '../contextual/PictureToolsRibbon';
import { PivotAnalyzeRibbon, PivotDesignRibbon } from '../contextual/PivotToolsRibbon';
import { SlicerToolsRibbon } from '../contextual/SlicerToolsRibbon';
import { SparklineToolsRibbon } from '../contextual/SparklineToolsRibbon';
import { KeyTipOverlay, KeyTipProvider } from '../keytips';
import { DataRibbon } from '../tabs/DataRibbon';
import { FormulasRibbon } from '../tabs/FormulasRibbon';
import { HomeRibbon } from '../tabs/HomeRibbon';
import { InsertRibbon } from '../tabs/InsertRibbon';
import { PageLayoutRibbon } from '../tabs/PageLayoutRibbon';
import { ReviewRibbon } from '../tabs/ReviewRibbon';
import { TableDesignRibbon } from '../tabs/TableDesignRibbon';
import { ViewRibbon } from '../tabs/ViewRibbon';
import { RibbonVisibilityTab } from '../visibility/RibbonVisibilityContext';
import { AutoHideRibbonTrigger, useAutoHideRibbon } from './AutoHideRibbonTrigger';
import { TabBar } from './TabBar';

// =============================================================================
// Types
// =============================================================================

type TabId =
  | 'home'
  | 'insert'
  | 'draw'
  | 'page'
  | 'formulas'
  | 'data'
  | 'review'
  | 'view'
  | 'table-design'
  | 'chart-design'
  | 'chart-format'
  | 'picture-tools'
  | 'slicer-tools'
  | 'sparkline-tools'
  | 'diagram-design'
  | 'diagram-format'
  | 'pivot-analyze'
  | 'pivot-design';

// NOTE: TabbedToolbarProps now uses Partial<ToolbarProps> because HomeRibbon, InsertRibbon, and PageLayoutRibbon are self-sufficient.
// They get their state from hooks and context, not from props.
// The undo/redo props are still used by TabBar.
export interface TabbedToolbarProps extends Partial<ToolbarProps> {
  borderTop?: BorderStyle;
  borderRight?: BorderStyle;
  borderBottom?: BorderStyle;
  borderLeft?: BorderStyle;
  onBorderChange?: (borders: BorderSelection) => void;
  onCut?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onPasteValues?: () => void;
  onPasteFormulas?: () => void;
  onPasteFormats?: () => void;
  onPasteSpecial?: () => void;
  hasClipboard?: boolean;
  onClearFormat?: () => void;
  onFormatPainter?: () => void;
  isFormatPainterActive?: boolean;
  onSave?: () => void;
  isSaving?: boolean;
  onPrint?: () => void;
  isPrinting?: boolean;
  onPdfExport?: () => void;
  isPdfExporting?: boolean;
  onOpenPrintDialog?: () => void;
  onDataValidation?: () => void;
  onRemoveDuplicates?: () => void;
  onTextToColumns?: () => void;
  // Undo history dropdown
  undoHistory?: UndoHistoryEntry[];
  undoDropdownOpen?: boolean;
  onOpenUndoDropdown?: () => void;
  onCloseUndoDropdown?: () => void;
  onUndoToEntry?: (entryId: string) => void;
  /** Current zoom level (0.1 to 4.0) */
  currentZoom?: number;
  /** Called when zoom in button is clicked */
  onZoomIn?: () => void;
  /** Called when zoom out button is clicked */
  onZoomOut?: () => void;
  /** Called when zoom level is changed via dropdown */
  onZoomChange?: (zoom: number) => void;
  /** Called when "Zoom to Selection" is clicked */
  onZoomToSelection?: () => void;
  /** Whether there is a selection to zoom to */
  hasSelection?: boolean;
  // Freeze panes
  /** Number of frozen rows (0 = none) */
  frozenRows?: number;
  /** Number of frozen columns (0 = none) */
  frozenCols?: number;
  /** Called when "Freeze Panes" is clicked (freeze at current selection) */
  onFreezePanes?: () => void;
  /** Called when "Freeze Top Row" is clicked */
  onFreezeTopRow?: () => void;
  /** Called when "Freeze First Column" is clicked */
  onFreezeFirstColumn?: () => void;
  /** Called when "Unfreeze Panes" is clicked */
  onUnfreeze?: () => void;
  // View options (Freeze Panes & View Options)
  /** Whether gridlines are shown */
  showGridlines?: boolean;
  /** Called when gridlines toggle is clicked */
  onToggleGridlines?: () => void;
  /** Whether headings (row/column headers) are shown */
  showHeadings?: boolean;
  /** Called when headings toggle is clicked */
  onToggleHeadings?: () => void;
  /** Whether the formula bar is shown */
  showFormulaBar?: boolean;
  /** Called when formula bar toggle is clicked */
  onToggleFormulaBar?: () => void;
  // Scrollbar visibility (Issue 7: View Options)
  /** Whether horizontal scrollbar is shown */
  showHorizontalScrollbar?: boolean;
  /** Called when horizontal scrollbar toggle is clicked */
  onToggleHorizontalScrollbar?: () => void;
  /** Whether vertical scrollbar is shown */
  showVerticalScrollbar?: boolean;
  /** Called when vertical scrollbar toggle is clicked */
  onToggleVerticalScrollbar?: () => void;
  // Settings
  /** Called when "Spread Settings" button is clicked */
  onOpenSpreadSettings?: () => void;
  /** Called when "Sheet Settings" button is clicked */
  onOpenSheetSettings?: () => void;
  // Page Break Preview
  /** Whether page break preview mode is enabled */
  pageBreakPreviewMode?: boolean;
  /** Called when page break preview toggle is clicked */
  onTogglePageBreakPreview?: () => void;
  // NOTE: InsertRibbon props removed - InsertRibbon is now self-sufficient
  // Chart, sparkline, hyperlink, comment, picture, shapes, textbox, slicer operations are handled by useInsertActions hook
  // NOTE: PageLayoutRibbon props removed - PageLayoutRibbon is now self-sufficient.
  // Print area, page breaks, page setup, print settings dispatch via the Unified
  // Action System (Page Layout dispatch); read state via usePrintArea /
  // usePrintSettings / usePageBreaks / useSheetViewOptions in each group.
  // Table Design
  /** Whether selection is inside a table */
  isInTable?: boolean;
  /** Table name (for Table Design tab) */
  tableName?: string | null;
  /** Table style preset */
  tableStylePreset?: TableStylePreset;
  /** Table style options */
  tableShowBandedRows?: boolean;
  tableShowBandedColumns?: boolean;
  tableShowFirstColumnHighlight?: boolean;
  tableShowLastColumnHighlight?: boolean;
  tableHasHeaderRow?: boolean;
  tableHasTotalRow?: boolean;
  /** Filter Button visibility */
  tableShowFilterButtons?: boolean;
  // Table Design actions
  onRenameTable?: (name: string) => void;
  onSetTableStylePreset?: (preset: TableStylePreset) => void;
  onToggleTableBandedRows?: () => void;
  onToggleTableBandedColumns?: () => void;
  onToggleTableFirstColumnHighlight?: () => void;
  onToggleTableLastColumnHighlight?: () => void;
  onToggleTableHeaderRow?: () => void;
  onToggleTableTotalRow?: () => void;
  /** Toggle filter button visibility */
  onToggleTableFilterButtons?: () => void;
  onDeleteTable?: () => void;
  onConvertTableToRange?: () => void;
}

// NOTE: The base tab list now lives in the ribbon slice as
// `RIBBON_BASE_TABS` (visible-tabs ownership). Membership of "the visible
// ribbon tabs" is no longer a React-side computation; the slice owns
// it and `setActiveRibbonTab` validates against it. See
// `apps/spreadsheet/src/ui-store/slices/ribbon/active-tab.ts`.
//
// ribbon-collapse control: the File affordance is rendered as a standalone
// backstage-trigger button in TabBar, not as a ribbon tab. It is not
// in `RIBBON_BASE_TABS` and `'file'` is not a `RibbonTabId`.

// =============================================================================
// Component
// =============================================================================

/**
 * TabbedToolbar - memoized to prevent re-renders when parent re-renders.
 * Combined with ToolbarContainer memoization, this prevents cascading renders
 * to all 394 child fibers when selection state changes.
 */
export const TabbedToolbar = React.memo(function TabbedToolbar({
  // Undo/Redo (used by TabBar)
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  // Export (used by TabBar)
  onExport,
  isExporting = false,
  // Save (used by TabBar)
  onSave,
  isSaving = false,
  // Print/PDF (used by TabBar)
  onPrint,
  isPrinting = false,
  onPdfExport,
  isPdfExporting = false,
  onOpenPrintDialog,
  // Data Validation
  onDataValidation,
  // Data Tools
  onRemoveDuplicates,
  onTextToColumns,
  // Undo history dropdown
  undoHistory,
  undoDropdownOpen,
  onOpenUndoDropdown,
  onCloseUndoDropdown,
  onUndoToEntry,
  // Zoom
  currentZoom,
  onZoomIn,
  onZoomOut,
  onZoomChange,
  onZoomToSelection,
  hasSelection,
  // Freeze panes
  frozenRows,
  frozenCols,
  onFreezePanes,
  onFreezeTopRow,
  onFreezeFirstColumn,
  onUnfreeze,
  // View options
  showGridlines,
  onToggleGridlines,
  showHeadings,
  onToggleHeadings,
  showFormulaBar,
  onToggleFormulaBar,
  // Scrollbar visibility (Issue 7: View Options)
  showHorizontalScrollbar,
  onToggleHorizontalScrollbar,
  showVerticalScrollbar,
  onToggleVerticalScrollbar,
  // Settings
  onOpenSpreadSettings,
  onOpenSheetSettings,
  // Page Break Preview
  pageBreakPreviewMode,
  onTogglePageBreakPreview,
  // NOTE: InsertRibbon props removed - InsertRibbon is now self-sufficient
  // NOTE: PageLayoutRibbon props removed - PageLayoutRibbon is now self-sufficient
  // Table Design
  isInTable = false,
  tableName,
  tableStylePreset,
  tableShowBandedRows = true,
  tableShowBandedColumns = false,
  tableShowFirstColumnHighlight = false,
  tableShowLastColumnHighlight = false,
  tableHasHeaderRow = true,
  tableHasTotalRow = false,
  tableShowFilterButtons = true, // Default to showing filter buttons
  onRenameTable,
  onSetTableStylePreset,
  onToggleTableBandedRows,
  onToggleTableBandedColumns,
  onToggleTableFirstColumnHighlight,
  onToggleTableLastColumnHighlight,
  onToggleTableHeaderRow,
  onToggleTableTotalRow,
  onToggleTableFilterButtons, //
  onDeleteTable,
  onConvertTableToRange,
  // NOTE: HomeRibbon callbacks removed - HomeRibbon is now self-sufficient
  // Font, alignment, number format, clipboard callbacks are handled by group hooks
}: TabbedToolbarProps) {
  const deps = useActionDependencies();
  const { uiStore } = useDocumentContext();

  // unified keytip router: active ribbon tab lives in the uiStore
  // (`activeRibbonTab` slice). The slice setter is the single write
  // path — both the click handler (UI event source) and the keyboard
  // chord (`SWITCH_RIBBON_TAB` action handler) call it directly. The
  // setter validates against `selectVisibleRibbonTabs` and rejects
  // gated/unknown ids (visible-tabs ownership).
  const activeTab = useStore(uiStore, (s) => s.activeRibbonTab) as TabId;
  const setActiveTab = useStore(uiStore, (s) => s.setActiveRibbonTab) as (tabId: TabId) => void;

  // Read ribbon collapsed state from UIStore
  const ribbonCollapsed = useStore(uiStore, (s) => s.ribbonCollapsed);

  // Read display mode and temporary show state
  const displayMode = useStore(uiStore, (s) => s.displayMode);
  const temporaryShow = useStore(uiStore, (s) => s.temporaryShow);

  // Ref for ribbon content area (used for auto-hide click-outside detection)
  const ribbonContentRef = useRef<HTMLDivElement>(null);

  // Set up auto-hide behavior
  useAutoHideRibbon(ribbonContentRef);

  // Get contextual tabs from the framework
  const contextualTabConfigs = useContextualTabs();

  // Handle File tab click - opens backstage view (mouse path).
  // The keyboard path (`Alt+F`) dispatches `OPEN_BACKSTAGE` directly via
  // the keyboard shortcut definition; both paths converge on the same
  // backstage slice without going through `activeRibbonTab`.
  const handleFileClick = useCallback(() => {
    dispatch('OPEN_BACKSTAGE', deps);
  }, [deps]);

  // Ribbon collapse coordinator - computes collapse level from container width
  // This is the SINGLE SOURCE OF TRUTH for collapse state
  const containerRef = useRef<HTMLDivElement>(null);
  const collapseState = useRibbonCollapse(containerRef);

  // visible-tabs ownership: visible tabs are owned by the slice. The slice
  // exposes `selectVisibleRibbonTabs(state) =
  // [...visibleBaseTabs, ...contextualTabIds]`; the React side only
  // joins those ids with their display labels (from RIBBON_BASE_TABS
  // and the contextual configs). The previous gate-fallback
  // `useEffect` and the contextual-disappear branch are gone — the
  // validating setter and the atomic `setContextualTabIds` make those
  // repair paths unreachable.
  // `selectVisibleRibbonTabs` returns a fresh array `[...base, ...ctx]`
  // each call. Wrap with `useShallow` so the consumer only re-renders
  // when the contents actually change — without this, every unrelated
  // store update re-renders TabbedToolbar. (Same array length + same
  // ids in same order ⇒ shallow-equal ⇒ no render.)
  const visibleRibbonTabs = useStore(uiStore, useShallow(selectVisibleRibbonTabs));
  const tabs = useMemo(() => {
    const baseLabels = new Map<RibbonTabId, string>();
    for (const t of RIBBON_BASE_TABS) baseLabels.set(t.id, t.label);
    const contextualLabels = new Map<string, string>();
    for (const c of contextualTabConfigs) contextualLabels.set(c.id, c.label);
    return visibleRibbonTabs.map((id): { id: TabId; label: string; isContextual?: boolean } => {
      const baseLabel = baseLabels.get(id);
      if (baseLabel != null) {
        return { id: id as TabId, label: baseLabel };
      }
      // Not in base ⇒ must be a contextual tab. Fall back to the id
      // itself if the label hasn't propagated yet (transient).
      return {
        id: id as TabId,
        label: contextualLabels.get(id) ?? id,
        isContextual: true,
      };
    });
  }, [visibleRibbonTabs, contextualTabConfigs]);

  // Auto-promote: when a contextual tab appears and the user is on
  // Home, switch to the new contextual tab — Excel behavior for Table
  // Design / Chart Design / etc. This is UX policy, not an invariant
  // fixup, so it stays as a `useEffect`.
  //
  // BOUNDED-CASCADE NOTE (visible-tabs ownership): when contextual tabs
  // change, the slice's atomic `setContextualTabIds` runs first and
  // may reset `activeRibbonTab` to `'home'` if the active tab
  // disappeared (single `set()`, single emission). This auto-promote
  // effect then runs on the next render and may promote `'home'` to a
  // newly-appeared contextual tab. That is at most TWO slice writes
  // across two renders — each terminal in its own concern (one
  // invariant repair, one UX promotion). It is NOT the cascade
  // pattern — the original cascade fired SIX writes
  // from a single user action, each write triggering the next via
  // chained useEffects observing each other's outputs. If you grep
  // for "useEffect that writes activeRibbonTab" and land here, this
  // is the only one that survived; any other would be a regression.
  useEffect(() => {
    if (contextualTabConfigs.length > 0 && activeTab === 'home') {
      const firstContextualTab = contextualTabConfigs[0];
      if (firstContextualTab) {
        setActiveTab(firstContextualTab.id as TabId);
      }
    }
  }, [contextualTabConfigs, activeTab, setActiveTab]);

  // tab activation from keytip chords flows through the typed
  // `SWITCH_RIBBON_TAB` action (handler at
  // `actions/handlers/ui/keytip-handlers.ts`), which writes
  // `activeRibbonTab` directly into the uiStore. The pre-
  // `onTabActivated` callback was a duplicate setter on top of the
  // same uiStore field; deleting it removes the second writer without
  // losing any behavior.

  return (
    <KeyTipProvider>
      <div ref={containerRef} className="flex flex-col bg-ss-surface-secondary overflow-hidden">
        <TabBar
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onFileClick={handleFileClick}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={onUndo}
          onRedo={onRedo}
          undoHistory={undoHistory}
          undoDropdownOpen={undoDropdownOpen}
          onOpenUndoDropdown={onOpenUndoDropdown}
          onCloseUndoDropdown={onCloseUndoDropdown}
          onUndoToEntry={onUndoToEntry}
          onSave={onSave}
          isSaving={isSaving}
          onPrint={onPrint}
          isPrinting={isPrinting}
          onPdfExport={onPdfExport}
          isPdfExporting={isPdfExporting}
          onExport={onExport}
          isExporting={isExporting}
          onPrintClick={onOpenPrintDialog}
        />

        {/* Auto-hide trigger strip - shown when ribbon is in auto-hide mode */}
        <AutoHideRibbonTrigger />

        {/* Ribbon content area - border-t connects to active tab's bottom edge */}
        {/* RibbonCollapseProvider broadcasts collapse level to all groups */}
        {/* Toolbar state is now managed via UIStore Zustand slice (see TOOLBAR-ZUSTAND-REFACTOR.md) */}
        {/* Hide ribbon content when collapsed (Ctrl+Shift+F1) */}
        {/* Show content when:
 - Not collapsed (Ctrl+Shift+F1) AND
 - Either in full mode, OR
 - In tabs-only/auto-hide mode with temporaryShow active */}
        {!ribbonCollapsed && (displayMode === 'full' || temporaryShow) && (
          <RibbonCollapseProvider value={collapseState}>
            <div
              ref={ribbonContentRef}
              data-testid="panel-ribbon"
              className={`
 flex items-stretch px-[var(--ribbon-padding-x)] py-[var(--ribbon-padding-y)]
 bg-ss-surface gap-[var(--ribbon-section-gap)] h-[var(--ribbon-height)]
 border-t border-ss-border-light overflow-hidden min-w-0
 ${temporaryShow ? 'shadow-ss-lg' : ''}
 `}
            >
              {/* HomeRibbon is now self-sufficient - no props needed */}
              {activeTab === 'home' && (
                <RibbonVisibilityTab tab="home">
                  <HomeRibbon />
                </RibbonVisibilityTab>
              )}

              {/* InsertRibbon is now self-sufficient - no props needed */}
              {activeTab === 'insert' && (
                <RibbonVisibilityTab tab="insert">
                  <InsertRibbon />
                </RibbonVisibilityTab>
              )}

              {/* PageLayoutRibbon is now self-sufficient - no props needed. */}
              {activeTab === 'page' && (
                <RibbonVisibilityTab tab="pageLayout">
                  <PageLayoutRibbon />
                </RibbonVisibilityTab>
              )}

              {activeTab === 'formulas' && (
                <RibbonVisibilityTab tab="formulas">
                  <FormulasRibbon />
                </RibbonVisibilityTab>
              )}

              {activeTab === 'data' && (
                <RibbonVisibilityTab tab="data">
                  <DataRibbon
                    onDataValidation={onDataValidation}
                    onRemoveDuplicates={onRemoveDuplicates}
                    onTextToColumns={onTextToColumns}
                  />
                </RibbonVisibilityTab>
              )}

              {activeTab === 'review' && (
                <RibbonVisibilityTab tab="review">
                  <ReviewRibbon />
                </RibbonVisibilityTab>
              )}

              {activeTab === 'view' && (
                <RibbonVisibilityTab tab="view">
                  <ViewRibbon
                    showGridlines={showGridlines}
                    onToggleGridlines={onToggleGridlines}
                    showHeadings={showHeadings}
                    onToggleHeadings={onToggleHeadings}
                    showFormulaBar={showFormulaBar}
                    onToggleFormulaBar={onToggleFormulaBar}
                    // Scrollbar visibility (Issue 7: View Options)
                    showHorizontalScrollbar={showHorizontalScrollbar}
                    onToggleHorizontalScrollbar={onToggleHorizontalScrollbar}
                    showVerticalScrollbar={showVerticalScrollbar}
                    onToggleVerticalScrollbar={onToggleVerticalScrollbar}
                    currentZoom={currentZoom}
                    onZoomIn={onZoomIn}
                    onZoomOut={onZoomOut}
                    onZoomChange={onZoomChange}
                    onZoomToSelection={onZoomToSelection}
                    hasSelection={hasSelection}
                    frozenRows={frozenRows}
                    frozenCols={frozenCols}
                    onFreezePanes={onFreezePanes}
                    onFreezeTopRow={onFreezeTopRow}
                    onFreezeFirstColumn={onFreezeFirstColumn}
                    onUnfreeze={onUnfreeze}
                    onOpenSpreadSettings={onOpenSpreadSettings}
                    onOpenSheetSettings={onOpenSheetSettings}
                    pageBreakPreviewMode={pageBreakPreviewMode}
                    onTogglePageBreakPreview={onTogglePageBreakPreview}
                  />
                </RibbonVisibilityTab>
              )}

              {activeTab === 'table-design' && isInTable && (
                <RibbonVisibilityTab tab="tableDesign">
                  <TableDesignRibbon
                    tableName={tableName ?? null}
                    stylePreset={tableStylePreset}
                    showBandedRows={tableShowBandedRows}
                    showBandedColumns={tableShowBandedColumns}
                    showFirstColumnHighlight={tableShowFirstColumnHighlight}
                    showLastColumnHighlight={tableShowLastColumnHighlight}
                    hasHeaderRow={tableHasHeaderRow}
                    hasTotalRow={tableHasTotalRow}
                    showFilterButtons={tableShowFilterButtons}
                    onRenameTable={onRenameTable ?? (() => {})}
                    onSetStylePreset={onSetTableStylePreset ?? (() => {})}
                    onToggleBandedRows={onToggleTableBandedRows ?? (() => {})}
                    onToggleBandedColumns={onToggleTableBandedColumns ?? (() => {})}
                    onToggleFirstColumnHighlight={onToggleTableFirstColumnHighlight ?? (() => {})}
                    onToggleLastColumnHighlight={onToggleTableLastColumnHighlight ?? (() => {})}
                    onToggleHeaderRow={onToggleTableHeaderRow ?? (() => {})}
                    onToggleTotalRow={onToggleTableTotalRow ?? (() => {})}
                    onToggleFilterButtons={onToggleTableFilterButtons ?? (() => {})}
                    onDeleteTable={onDeleteTable ?? (() => {})}
                    onConvertToRange={onConvertTableToRange ?? (() => {})}
                  />
                </RibbonVisibilityTab>
              )}

              {activeTab === 'chart-design' && (
                <RibbonVisibilityTab tab="chartDesign">
                  <ChartToolsRibbon />
                </RibbonVisibilityTab>
              )}

              {activeTab === 'chart-format' && <ChartFormatRibbon />}

              {activeTab === 'picture-tools' && (
                <RibbonVisibilityTab tab="pictureTools">
                  <PictureToolsRibbon />
                </RibbonVisibilityTab>
              )}

              {activeTab === 'slicer-tools' && (
                <RibbonVisibilityTab tab="slicerTools">
                  <SlicerToolsRibbon />
                </RibbonVisibilityTab>
              )}

              {activeTab === 'sparkline-tools' && (
                <RibbonVisibilityTab tab="sparklineTools">
                  <SparklineToolsRibbon />
                </RibbonVisibilityTab>
              )}

              {/* Diagram contextual tabs */}
              {activeTab === 'diagram-design' && (
                <RibbonVisibilityTab tab="diagramDesign">
                  <DiagramDesignTab />
                </RibbonVisibilityTab>
              )}

              {activeTab === 'diagram-format' && (
                <RibbonVisibilityTab tab="diagramFormat">
                  <DiagramFormatTab />
                </RibbonVisibilityTab>
              )}

              {activeTab === 'pivot-analyze' && <PivotAnalyzeRibbon />}

              {activeTab === 'pivot-design' && <PivotDesignRibbon />}
            </div>
          </RibbonCollapseProvider>
        )}

        {/* KeyTip overlay - renders keytip badges when Alt is pressed */}
        <KeyTipOverlay />
      </div>
    </KeyTipProvider>
  );
});
