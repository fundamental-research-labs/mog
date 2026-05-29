/**
 * InsertRibbon
 *
 * Insert tab content organized around Mog command groups:
 * 1. Tables (Pivot table, Table, Forms)
 * 2. Illustrations (Pictures, Shapes, Diagram, Screenshot - then Icons)
 * 3. Charts (full catalog dropdown + individual chart type galleries)
 * 4. Sparklines (Line, Column, Win/Loss - THREE separate buttons per Excel 365)
 * 5. Filters (Filter control, Date filter - stubs for now)
 * 6. Links
 * 7. Comments (New Comment)
 * 8. Text (Text Box, Header & Footer, Text effects, Object, Equation - stubs for now)
 *
 * Charts group uses a compact command-bar layout:
 * - "Charts" as a full-catalog dropdown
 * - Individual chart type buttons (Column, Line, Pie, etc.) as compact buttons,
 * each opening a gallery of chart subtypes
 *
 * Implementation
 * - Refactored to use useInsertActions hook with dispatch()
 * - All user interactions go through the Unified Action System
 * - Self-sufficient component - no props required for core actions
 *
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../../internal-api';

import type { ChartType } from '@mog/charts';
import {
  CHARTS_COLLAPSE_CONFIG,
  COMMENTS_INSERT_COLLAPSE_CONFIG,
  FILTERS_COLLAPSE_CONFIG,
  ILLUSTRATIONS_COLLAPSE_CONFIG,
  LINKS_COLLAPSE_CONFIG,
  SPARKLINES_COLLAPSE_CONFIG,
  TABLES_INSERT_COLLAPSE_CONFIG,
  TEXT_COLLAPSE_CONFIG,
} from '@mog-sdk/contracts/ribbon';
import { ChartsGroup } from '../../../components/charts/ChartsGroup';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { useSheetProtectionPermissions } from '../../../hooks/structure/use-sheet-protection';
import { useActiveCell } from '../../../hooks/selection/use-active-cell';
import { useSelectionRanges } from '../../../hooks/selection/use-granular-selection';
import { PRODUCT_VOCABULARY } from '../../../ux/product-vocabulary';
import { keyTipRegistry } from '../keytips';
import { RibbonButton } from '../primitives/RibbonButton';
import { RibbonDropdownItem, RibbonDropdownPanel } from '../primitives/RibbonDropdown';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import { RibbonVisibilityItem } from '../visibility/RibbonVisibilityContext';
import {
  ChartIcon,
  ColumnSparklineIcon,
  EquationIcon,
  FormsIcon,
  HeaderFooterIcon,
  HyperlinkIcon,
  IconsIcon,
  LineSparklineIcon,
  NewCommentIcon,
  ObjectIcon,
  PictureIcon,
  PivotTableIcon,
  ScreenshotIcon,
  ShapesIcon,
  SlicerIcon,
  DiagramIcon,
  TableIcon,
  TextBoxIcon,
  TimelineIcon,
  WinLossSparklineIcon,
  TextEffectIcon,
} from '../primitives/ToolbarIcons';

// =============================================================================
// Component
// =============================================================================

/**
 * InsertRibbon - self-sufficient ribbon component for the Insert tab.
 *
 * All state and actions come from useInsertActions hook using dispatch().
 * No props required for core functionality.
 */
export function InsertRibbon() {
  // ===========================================================================
  // Dispatch + derived state
  // ===========================================================================

  const dispatchAction = useDispatch();
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  const { row: activeRow, col: activeCol } = useActiveCell();
  const ranges = useSelectionRanges();
  const sheetPermissions = useSheetProtectionPermissions(activeSheetId);

  // UIStore action for the inline shapes menu (anchored popover, not a
  // dialog). The visible ribbon click records an anchor; keytips open the
  // same menu through the generic ribbonDropdowns slice below.
  const openInsertShapeMenu = useUIStore((s) => s.openInsertShapeMenu);
  const openRibbonDropdown = useUIStore((s) => s.openRibbonDropdown);
  const closeRibbonDropdown = useUIStore((s) => s.closeRibbonDropdown);

  // Slicer is enabled only when the active cell is inside a table. This
  // mirrors the prior `useInsertActions` derivation; it stays here as a
  // granular state read at the call site.
  const [selectionIsInTable, setSelectionIsInTable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ws = wb.getSheetById(activeSheetId);
        const table = await ws.tables.getAtCell(activeRow, activeCol);
        if (!cancelled) setSelectionIsInTable(table != null);
      } catch {
        if (!cancelled) setSelectionIsInTable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wb, activeSheetId, activeRow, activeCol]);

  // Chart is disabled if there's no selection range
  const chartDisabled = useMemo(() => ranges.length === 0, [ranges]);
  // Slicer is disabled if not in a table
  const slicerDisabled = !selectionIsInTable;

  // Bound action callbacks
  const insertTable = useCallback(() => dispatchAction('INSERT_TABLE'), [dispatchAction]);
  const insertPivotTable = useCallback(() => dispatchAction('OPEN_PIVOT_DIALOG'), [dispatchAction]);
  const insertPicture = useCallback(() => {
    dispatchAction('INSERT_PICTURE');
  }, [dispatchAction]);
  const insertCheckboxFormControl = useCallback(
    () => dispatchAction('INSERT_FORM_CONTROL_CHECKBOX'),
    [dispatchAction],
  );
  const insertComboBoxFormControl = useCallback(
    () => dispatchAction('INSERT_FORM_CONTROL_COMBOBOX'),
    [dispatchAction],
  );
  const insertShapes = useCallback(
    (e: React.MouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openInsertShapeMenu(rect.left, rect.bottom);
      openRibbonDropdown('insert.shapes');
    },
    [openInsertShapeMenu, openRibbonDropdown],
  );
  const openDiagramDialog = useCallback(
    () => dispatchAction('OPEN_DIAGRAM_DIALOG'),
    [dispatchAction],
  );
  const insertChart = useCallback(
    (type: ChartType, subType?: string, config?: Record<string, unknown>) => {
      dispatchAction('CREATE_EMBEDDED_CHART', { type, subType, config });
    },
    [dispatchAction],
  );
  const openChartWizard = useCallback(
    () => dispatchAction('OPEN_INSERT_CHART_WIZARD_DIALOG'),
    [dispatchAction],
  );
  const insertSparkline = useCallback(
    (type: 'line' | 'column' | 'winLoss') => {
      dispatchAction('OPEN_SPARKLINE_DIALOG', { type });
    },
    [dispatchAction],
  );
  const insertSlicer = useCallback(
    () => dispatchAction('OPEN_INSERT_SLICER_DIALOG'),
    [dispatchAction],
  );
  const insertHyperlink = useCallback(
    () => dispatchAction('OPEN_HYPERLINK_DIALOG'),
    [dispatchAction],
  );
  const insertComment = useCallback(() => dispatchAction('INSERT_COMMENT'), [dispatchAction]);
  const insertTextBox = useCallback(() => dispatchAction('INSERT_TEXTBOX'), [dispatchAction]);
  const openHeaderFooter = useCallback(
    () => dispatchAction('OPEN_PAGE_SETUP_DIALOG', { initialTab: 'headerFooter' }),
    [dispatchAction],
  );
  const insertEquation = useCallback(() => dispatchAction('INSERT_EQUATION'), [dispatchAction]);
  const openTextEffectGallery = useCallback(
    () => dispatchAction('OPEN_TEXT_EFFECT_GALLERY'),
    [dispatchAction],
  );

  // ===========================================================================
  // Local UI State
  // ===========================================================================

  // Shapes and sparkline dropdowns are lifted into the ribbonDropdowns slice
  // so keytip chords can open the same visible menus as ribbon clicks.
  const isShapesDropdownOpen = useUIStore((s) => s.ribbonDropdowns['insert.shapes'] ?? false);
  const isSparklineDropdownOpen = useUIStore((s) => s.ribbonDropdowns['insert.sparkline'] ?? false);
  useEffect(() => {
    if (!isShapesDropdownOpen) return;

    const anchor = document.getElementById('insert-shapes')?.getBoundingClientRect();
    openInsertShapeMenu(anchor?.left ?? 16, anchor?.bottom ?? 120);
  }, [isShapesDropdownOpen, openInsertShapeMenu]);
  const setIsSparklineDropdownOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('insert.sparkline') : closeRibbonDropdown('insert.sparkline'),
    [openRibbonDropdown, closeRibbonDropdown],
  );

  // ===========================================================================
  // KeyTip Registration (display-only — keytip overlay reads `key`,
  // `tabId`, `elementId` here; the unified keyboard system fires the action
  // via typed `KeyboardShortcut` entries in
  // `keyboard/definitions/keytips-insert.ts`.)
  // ===========================================================================

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    keyTipRegistry.register({ key: 'T', tabId: 'insert', elementId: 'insert-table' });
    cleanups.push(() => keyTipRegistry.unregister('T', 'insert'));

    keyTipRegistry.register({ key: 'P', tabId: 'insert', elementId: 'insert-picture' });
    cleanups.push(() => keyTipRegistry.unregister('P', 'insert'));

    keyTipRegistry.register({
      key: 'F',
      tabId: 'insert',
      elementId: 'insert-form-control-checkbox',
    });
    cleanups.push(() => keyTipRegistry.unregister('F', 'insert'));

    keyTipRegistry.register({
      key: 'B',
      tabId: 'insert',
      elementId: 'insert-form-control-combobox',
    });
    cleanups.push(() => keyTipRegistry.unregister('B', 'insert'));

    keyTipRegistry.register({ key: 'H', tabId: 'insert', elementId: 'insert-shapes' });
    cleanups.push(() => keyTipRegistry.unregister('H', 'insert'));

    keyTipRegistry.register({ key: 'C', tabId: 'insert', elementId: 'insert-chart' });
    cleanups.push(() => keyTipRegistry.unregister('C', 'insert'));

    keyTipRegistry.register({ key: 'K', tabId: 'insert', elementId: 'insert-sparkline' });
    cleanups.push(() => keyTipRegistry.unregister('K', 'insert'));

    keyTipRegistry.register({ key: 'L', tabId: 'insert', elementId: 'insert-hyperlink' });
    cleanups.push(() => keyTipRegistry.unregister('L', 'insert'));

    keyTipRegistry.register({ key: 'M', tabId: 'insert', elementId: 'insert-comment' });
    cleanups.push(() => keyTipRegistry.unregister('M', 'insert'));

    keyTipRegistry.register({ key: 'X', tabId: 'insert', elementId: 'insert-textbox' });
    cleanups.push(() => keyTipRegistry.unregister('X', 'insert'));

    keyTipRegistry.register({ key: 'W', tabId: 'insert', elementId: 'insert-text-effects' });
    cleanups.push(() => keyTipRegistry.unregister('W', 'insert'));

    keyTipRegistry.register({ key: 'E', tabId: 'insert', elementId: 'insert-equation' });
    cleanups.push(() => keyTipRegistry.unregister('E', 'insert'));

    return () => cleanups.forEach((c) => c());
  }, []);

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <>
      {/* 1. Tables Group */}
      <ToolbarGroup
        label="Tables"
        collapseConfig={TABLES_INSERT_COLLAPSE_CONFIG}
        dropdownIcon={<TableIcon />}
      >
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<PivotTableIcon />}
          label={PRODUCT_VOCABULARY.pivotTable.label}
          onClick={insertPivotTable}
          title="Insert pivot table (Alt+D P)"
          aria-label="Insert pivot table"
        />
        <RibbonButton
          id="insert-table"
          layout="vertical"
          height="full"
          icon={<TableIcon />}
          label="Table"
          onClick={insertTable}
          title="Insert Table (Ctrl+T)"
          aria-label="Insert Table"
        />
        <RibbonButton
          id="insert-form-control-checkbox"
          layout="vertical"
          height="full"
          icon={<FormsIcon />}
          label="Check Box"
          onClick={insertCheckboxFormControl}
          disabled={!sheetPermissions.editObject}
          title="Insert Checkbox Form Control"
          aria-label="Insert Checkbox Form Control"
        />
        <RibbonButton
          id="insert-form-control-combobox"
          layout="vertical"
          height="full"
          icon={<FormsIcon />}
          label="Combo Box"
          onClick={insertComboBoxFormControl}
          disabled={!sheetPermissions.editObject}
          title="Insert Combo Box Form Control"
          aria-label="Insert Combo Box Form Control"
        />
      </ToolbarGroup>

      {/* 2. Illustrations Group */}
      <ToolbarGroup
        label="Illustrations"
        collapseConfig={ILLUSTRATIONS_COLLAPSE_CONFIG}
        dropdownIcon={<PictureIcon />}
      >
        <RibbonButton
          id="insert-picture"
          layout="vertical"
          height="full"
          icon={<PictureIcon />}
          label="Pictures"
          onClick={insertPicture}
          title="Insert Picture"
          aria-label="Insert Picture"
        />
        <RibbonButton
          id="insert-shapes"
          layout="vertical"
          height="full"
          data-testid="ribbon-dropdown-shapes"
          icon={<ShapesIcon />}
          label="Shapes"
          hasDropdown
          dropdownPosition="inline"
          onClick={insertShapes}
          title="Insert Shape"
          aria-label="Insert Shape"
        />
        <RibbonButton
          id="insert-diagram"
          layout="vertical"
          height="full"
          icon={<DiagramIcon />}
          label={PRODUCT_VOCABULARY.diagram.label}
          onClick={openDiagramDialog}
          title={`Insert ${PRODUCT_VOCABULARY.diagram.label.toLowerCase()}`}
          aria-label={`Insert ${PRODUCT_VOCABULARY.diagram.label.toLowerCase()}`}
        />
        {/* Screenshot stub - disabled */}
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<ScreenshotIcon />}
          label="Screenshot"
          hasDropdown
          dropdownPosition="inline"
          disabled
          title="Insert Screenshot (coming soon)"
          aria-label="Insert Screenshot"
        />
        {/* Icons stub - disabled */}
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<IconsIcon />}
          label="Icons"
          disabled
          title="Insert Icons (coming soon)"
          aria-label="Insert Icons"
        />
      </ToolbarGroup>

      {/* 3. Charts Group */}
      <ToolbarGroup
        label="Charts"
        collapseConfig={CHARTS_COLLAPSE_CONFIG}
        dropdownIcon={<ChartIcon />}
      >
        <ChartsGroup
          disabled={chartDisabled}
          onInsertChart={insertChart}
          onOpenChartWizard={openChartWizard}
        />
      </ToolbarGroup>

      {/* 4. Sparklines Group - Single dropdown button (consolidated for space efficiency) */}
      <ToolbarGroup
        label="Sparklines"
        collapseConfig={SPARKLINES_COLLAPSE_CONFIG}
        dropdownIcon={<ColumnSparklineIcon />}
      >
        <div className="relative inline-flex">
          <RibbonButton
            id="insert-sparkline"
            layout="vertical"
            height="full"
            data-testid="ribbon-dropdown-sparkline"
            icon={<ColumnSparklineIcon />}
            label="Sparklines"
            hasDropdown
            dropdownPosition="inline"
            isOpen={isSparklineDropdownOpen}
            onClick={() => setIsSparklineDropdownOpen(!isSparklineDropdownOpen)}
            title="Insert Sparkline"
            aria-label="Insert Sparkline"
            aria-expanded={isSparklineDropdownOpen}
            aria-haspopup="menu"
            visibilityKey="sparklines"
          />
          <RibbonDropdownPanel
            open={isSparklineDropdownOpen}
            onClose={() => setIsSparklineDropdownOpen(false)}
          >
            <div
              data-testid="ribbon-dropdown-menu-sparkline"
              className="bg-ss-surface rounded shadow-ss-md border border-ss-border min-w-[160px] py-1"
              role="menu"
            >
              <RibbonVisibilityItem item="line">
                <RibbonDropdownItem
                  dataValue="line"
                  icon={<LineSparklineIcon />}
                  onClick={() => {
                    insertSparkline('line');
                    setIsSparklineDropdownOpen(false);
                  }}
                >
                  Line
                </RibbonDropdownItem>
              </RibbonVisibilityItem>
              <RibbonVisibilityItem item="column">
                <RibbonDropdownItem
                  dataValue="column"
                  icon={<ColumnSparklineIcon />}
                  onClick={() => {
                    insertSparkline('column');
                    setIsSparklineDropdownOpen(false);
                  }}
                >
                  Column
                </RibbonDropdownItem>
              </RibbonVisibilityItem>
              <RibbonVisibilityItem item="winLoss">
                <RibbonDropdownItem
                  dataValue="winLoss"
                  icon={<WinLossSparklineIcon />}
                  onClick={() => {
                    insertSparkline('winLoss');
                    setIsSparklineDropdownOpen(false);
                  }}
                >
                  Win/Loss
                </RibbonDropdownItem>
              </RibbonVisibilityItem>
            </div>
          </RibbonDropdownPanel>
        </div>
      </ToolbarGroup>

      {/* 5. Filters Group */}
      <ToolbarGroup
        label="Filters"
        collapseConfig={FILTERS_COLLAPSE_CONFIG}
        dropdownIcon={<SlicerIcon />}
      >
        <RibbonButton
          id="insert-filter-control"
          layout="vertical"
          height="full"
          icon={<SlicerIcon />}
          label={PRODUCT_VOCABULARY.filterControl.label}
          onClick={insertSlicer}
          disabled={slicerDisabled}
          title={
            slicerDisabled
              ? `Insert ${PRODUCT_VOCABULARY.filterControl.label.toLowerCase()} (select a table first)`
              : `Insert ${PRODUCT_VOCABULARY.filterControl.label.toLowerCase()}`
          }
          aria-label={`Insert ${PRODUCT_VOCABULARY.filterControl.label.toLowerCase()}`}
          visibilityKey="filterControl"
        />
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<TimelineIcon />}
          label={PRODUCT_VOCABULARY.dateFilter.label}
          disabled
          title={`Insert ${PRODUCT_VOCABULARY.dateFilter.label.toLowerCase()} (coming soon)`}
          aria-label={`Insert ${PRODUCT_VOCABULARY.dateFilter.label.toLowerCase()}`}
          visibilityKey="dateFilter"
        />
      </ToolbarGroup>

      {/* 6. Links Group */}
      <ToolbarGroup
        label="Links"
        collapseConfig={LINKS_COLLAPSE_CONFIG}
        dropdownIcon={<HyperlinkIcon />}
      >
        <RibbonButton
          id="insert-hyperlink"
          layout="vertical"
          height="full"
          icon={<HyperlinkIcon />}
          label="Link"
          onClick={insertHyperlink}
          title="Insert Hyperlink (Ctrl+K)"
          aria-label="Insert Hyperlink"
        />
      </ToolbarGroup>

      {/* 7. Comments Group - New Comment button */}
      <ToolbarGroup
        label="Comments"
        collapseConfig={COMMENTS_INSERT_COLLAPSE_CONFIG}
        dropdownIcon={<NewCommentIcon />}
      >
        <RibbonButton
          id="insert-comment"
          layout="vertical"
          height="full"
          icon={<NewCommentIcon />}
          label="Comment"
          onClick={insertComment}
          title="Insert Comment"
          aria-label="Insert Comment"
        />
      </ToolbarGroup>

      {/* 8. Text Group - TextBox + stubs (Header & Footer, Text effects, Object, Equation) */}
      <ToolbarGroup
        label="Text"
        isLast
        collapseConfig={TEXT_COLLAPSE_CONFIG}
        dropdownIcon={<TextBoxIcon />}
      >
        <RibbonButton
          id="insert-textbox"
          layout="vertical"
          height="full"
          icon={<TextBoxIcon />}
          label="Text Box"
          onClick={insertTextBox}
          title="Insert Text Box"
          aria-label="Insert Text Box"
        />
        {/* Header & Footer - opens Page Setup dialog on Header/Footer tab */}
        {/* Multi-line label matches Excel ribbon display */}
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<HeaderFooterIcon />}
          label={'Header &\nFooter'}
          onClick={openHeaderFooter}
          title="Edit Header & Footer"
          aria-label="Edit Header & Footer"
        />
        {/* Opens the text effects gallery for preset selection. Gallery handles insertion. */}
        <RibbonButton
          id="insert-text-effects"
          layout="vertical"
          height="full"
          data-testid="ribbon-dropdown-text-effects"
          icon={<TextEffectIcon />}
          label={PRODUCT_VOCABULARY.textEffects.label}
          hasDropdown
          dropdownPosition="inline"
          onClick={openTextEffectGallery}
          title={`Insert ${PRODUCT_VOCABULARY.textEffects.label.toLowerCase()}`}
          aria-label={`Insert ${PRODUCT_VOCABULARY.textEffects.label.toLowerCase()}`}
          visibilityKey="textEffects"
        />
        {/* Object stub - disabled */}
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<ObjectIcon />}
          label="Object"
          disabled
          title="Insert Object (coming soon)"
          aria-label="Insert Object"
        />
        {/* Equation - Insert mathematical equation ( */}
        <RibbonButton
          id="insert-equation"
          layout="vertical"
          height="full"
          icon={<EquationIcon />}
          label="Equation"
          onClick={insertEquation}
          title="Insert Equation (Alt+N+E)"
          aria-label="Insert Equation"
          visibilityKey="equation"
        />
      </ToolbarGroup>
    </>
  );
}
