/**
 * Quick Analysis Panel Component
 *
 * Context Menus Parity - Quick Analysis Panel
 *
 * The Quick Analysis panel appears when pressing Ctrl+Q on a selection.
 * It provides quick access to formatting, charting, and analysis options
 * based on the current selection.
 *
 * Features:
 * - Formatting tab: Conditional formatting quick options
 * - Charts tab: Quick chart creation from selection
 * - Totals tab: Quick total row/column insertion
 * - Tables tab: Convert to table option
 * - Sparklines tab: Insert sparklines
 *
 * Architecture notes:
 * - Panel positions itself relative to the selection anchor
 * - Actions route through dispatch() for Unified Action System compliance
 * - Uses tab-based navigation with keyboard support
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Unified Action System pattern
 *
 * @module components/quick-analysis/QuickAnalysisPanel
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ChartSvg,
  ConditionalFormatSvg,
  SparklineLineSvg,
  TableAddSvg,
  wrapIcon,
} from '@mog/icons';
import type { Tab } from '@mog/shell';
import { TabPanel, Tabs } from '@mog/shell';

import { dispatch } from '../../actions';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';

// =============================================================================
// Types
// =============================================================================

export interface QuickAnalysisPanelProps {
  /** X position for the panel */
  x: number;
  /** Y position for the panel */
  y: number;
  /** Called when panel should close */
  onClose: () => void;
  /** Number of rows in selection */
  selectionRowCount: number;
  /** Number of columns in selection */
  selectionColCount: number;
  /** Whether selection contains numeric data */
  hasNumericData: boolean;
}

type TabId = 'formatting' | 'charts' | 'totals' | 'tables' | 'sparklines';

// =============================================================================
// Icon Components
// =============================================================================

const ChartIcon = wrapIcon(ChartSvg, 'toolbar');
const TableIcon = wrapIcon(TableAddSvg, 'toolbar');
const SparklineIcon = wrapIcon(SparklineLineSvg, 'toolbar');
const ConditionalFormatIcon = wrapIcon(ConditionalFormatSvg, 'toolbar');

// Sum icon (for totals)
const SumIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 4H6v2l6.5 6L6 18v2h12v-3h-7l5-5-5-5h7V4z" />
  </svg>
);

// =============================================================================
// Tabs Configuration
// =============================================================================

const TABS: Tab[] = [
  {
    id: 'formatting',
    label: (
      <span className="flex flex-col items-center gap-1">
        <ConditionalFormatIcon />
        <span>Formatting</span>
      </span>
    ),
    title: 'Formatting',
  },
  {
    id: 'charts',
    label: (
      <span className="flex flex-col items-center gap-1">
        <ChartIcon />
        <span>Charts</span>
      </span>
    ),
    title: 'Charts',
  },
  {
    id: 'totals',
    label: (
      <span className="flex flex-col items-center gap-1">
        <SumIcon />
        <span>Totals</span>
      </span>
    ),
    title: 'Totals',
  },
  {
    id: 'tables',
    label: (
      <span className="flex flex-col items-center gap-1">
        <TableIcon />
        <span>Tables</span>
      </span>
    ),
    title: 'Tables',
  },
  {
    id: 'sparklines',
    label: (
      <span className="flex flex-col items-center gap-1">
        <SparklineIcon />
        <span>Sparklines</span>
      </span>
    ),
    title: 'Sparklines',
  },
];

// =============================================================================
// Component
// =============================================================================

export function QuickAnalysisPanel({
  x,
  y,
  onClose,
  selectionRowCount,
  selectionColCount,
  hasNumericData,
}: QuickAnalysisPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<TabId>('formatting');
  const deps = useActionDependencies();

  // Adjust position to keep panel in viewport
  const adjustedPosition = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return { x, y };

    const rect = panel.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    // Adjust horizontal position
    if (x + rect.width > viewportWidth - 16) {
      adjustedX = viewportWidth - rect.width - 16;
    }

    // Adjust vertical position
    if (y + rect.height > viewportHeight - 16) {
      adjustedY = y - rect.height - 16;
    }

    return { x: adjustedX, y: adjustedY };
  }, [x, y]);

  // Close on escape key (arrow key navigation is handled by Radix Tabs)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const pos = adjustedPosition();

  // =============================================================================
  // Action Handlers
  // =============================================================================

  const handleConditionalFormat = useCallback(
    (_type: string) => {
      onClose();
      dispatch('OPEN_CF_MENU', deps);
    },
    [onClose, deps],
  );

  const handleInsertChart = useCallback(
    (_chartType: string) => {
      onClose();
      dispatch('OPEN_INSERT_CHART_WIZARD_DIALOG', deps);
    },
    [onClose, deps],
  );

  const handleInsertTotal = useCallback(
    (aggregateType: string, location: 'row' | 'column') => {
      onClose();
      // For now, log the action
      // Full implementation would insert the specific total
      console.log('[QuickAnalysis] Insert total:', { aggregateType, location });
    },
    [onClose],
  );

  /**
   * One-click table creation from Quick Analysis panel.
   * Opens the Insert Table dialog with the current selection pre-populated.
   */
  const handleConvertToTable = useCallback(() => {
    onClose();
    void dispatch('INSERT_TABLE', deps);
  }, [onClose, deps]);

  const handleInsertSparkline = useCallback(
    (sparklineType: string) => {
      onClose();
      // For now, log the action
      // Full implementation would insert the specific sparkline
      console.log('[QuickAnalysis] Insert sparkline:', sparklineType);
    },
    [onClose],
  );

  // =============================================================================
  // Tab Content Renderers
  // =============================================================================

  const renderFormattingTab = () => (
    <div className="flex gap-2">
      <QuickOption
        label="Data Bars"
        icon={<DataBarsIcon />}
        onClick={() => handleConditionalFormat('dataBars')}
      />
      <QuickOption
        label="Color Scale"
        icon={<ColorScaleIcon />}
        onClick={() => handleConditionalFormat('colorScale')}
      />
      <QuickOption
        label="Icon Set"
        icon={<IconSetIcon />}
        onClick={() => handleConditionalFormat('iconSet')}
      />
      <QuickOption
        label="Greater Than"
        icon={<GreaterThanIcon />}
        onClick={() => handleConditionalFormat('greaterThan')}
      />
      <QuickOption
        label="Top 10%"
        icon={<Top10Icon />}
        onClick={() => handleConditionalFormat('top10')}
      />
      <QuickOption
        label="Clear"
        icon={<ClearIcon />}
        onClick={() => handleConditionalFormat('clear')}
      />
    </div>
  );

  const renderChartsTab = () => (
    <div className="flex gap-2">
      <QuickOption
        label="Column"
        icon={<ColumnChartIcon />}
        onClick={() => handleInsertChart('column')}
      />
      <QuickOption
        label="Line"
        icon={<LineChartIcon />}
        onClick={() => handleInsertChart('line')}
      />
      <QuickOption label="Pie" icon={<PieChartIcon />} onClick={() => handleInsertChart('pie')} />
      <QuickOption
        label="Scatter"
        icon={<ScatterChartIcon />}
        onClick={() => handleInsertChart('scatter')}
      />
      <QuickOption
        label="Area"
        icon={<AreaChartIcon />}
        onClick={() => handleInsertChart('area')}
      />
    </div>
  );

  const renderTotalsTab = () => (
    <div className="flex gap-2">
      <QuickOption
        label="Sum"
        icon={<SumIcon />}
        onClick={() => handleInsertTotal('sum', 'row')}
        disabled={!hasNumericData}
      />
      <QuickOption
        label="Average"
        icon={<AverageIcon />}
        onClick={() => handleInsertTotal('average', 'row')}
        disabled={!hasNumericData}
      />
      <QuickOption
        label="Count"
        icon={<CountIcon />}
        onClick={() => handleInsertTotal('count', 'row')}
      />
      <QuickOption
        label="% Total"
        icon={<PercentIcon />}
        onClick={() => handleInsertTotal('percentTotal', 'row')}
        disabled={!hasNumericData}
      />
      <QuickOption
        label="Running Total"
        icon={<RunningTotalIcon />}
        onClick={() => handleInsertTotal('runningTotal', 'row')}
        disabled={!hasNumericData}
      />
    </div>
  );

  const renderTablesTab = () => (
    <div className="flex gap-2">
      <QuickOption label="Table" icon={<TableIcon />} onClick={handleConvertToTable} />
      <QuickOption
        label="Pivot table"
        icon={<PivotTableIcon />}
        onClick={() => {
          onClose();
          // Log for now - OPEN_PIVOT_WIZARD_DIALOG needs to be added
          console.log('[QuickAnalysis] Create pivot table');
        }}
        disabled={selectionRowCount < 2 || selectionColCount < 1}
      />
    </div>
  );

  const renderSparklinesTab = () => (
    <div className="flex gap-2">
      <QuickOption
        label="Line"
        icon={<SparklineIcon />}
        onClick={() => handleInsertSparkline('line')}
        disabled={selectionColCount < 2}
      />
      <QuickOption
        label="Column"
        icon={<SparklineColumnIcon />}
        onClick={() => handleInsertSparkline('column')}
        disabled={selectionColCount < 2}
      />
      <QuickOption
        label="Win/Loss"
        icon={<SparklineWinLossIcon />}
        onClick={() => handleInsertSparkline('winLoss')}
        disabled={selectionColCount < 2}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-ss-tooltip" onClick={onClose}>
      <div
        ref={panelRef}
        className="absolute bg-ss-surface rounded-ss-lg shadow-ss-lg border border-ss-border z-ss-tooltip"
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
        data-testid="quick-analysis-panel"
      >
        <Tabs
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as TabId)}
          ariaLabel="Quick analysis"
          size="sm"
        >
          <TabPanel tabId="formatting" className="p-3">
            {renderFormattingTab()}
          </TabPanel>
          <TabPanel tabId="charts" className="p-3">
            {renderChartsTab()}
          </TabPanel>
          <TabPanel tabId="totals" className="p-3">
            {renderTotalsTab()}
          </TabPanel>
          <TabPanel tabId="tables" className="p-3">
            {renderTablesTab()}
          </TabPanel>
          <TabPanel tabId="sparklines" className="p-3">
            {renderSparklinesTab()}
          </TabPanel>
        </Tabs>
      </div>
    </div>
  );
}

// =============================================================================
// Quick Option Component
// =============================================================================

interface QuickOptionProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

function QuickOption({ label, icon, onClick, disabled }: QuickOptionProps) {
  return (
    <button
      type="button"
      className={`flex flex-col items-center gap-1 p-2 rounded text-caption transition-colors min-w-[60px] ${
        disabled
          ? 'opacity-50 cursor-not-allowed text-ss-text-secondary'
          : 'hover:bg-ss-surface-hover text-text cursor-pointer'
      }`}
      onClick={disabled ? undefined : onClick}
      title={label}
      disabled={disabled}
    >
      <div className="w-6 h-6 flex items-center justify-center">{icon}</div>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

// =============================================================================
// Mini Icons for Quick Analysis Options
// =============================================================================

const DataBarsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <rect x="3" y="14" width="18" height="2" />
    <rect x="3" y="10" width="14" height="2" />
    <rect x="3" y="6" width="10" height="2" />
  </svg>
);

const ColorScaleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24">
    <rect x="3" y="8" width="4" height="8" fill="var(--color-ss-success)" />
    <rect x="8" y="8" width="4" height="8" fill="var(--color-ss-warning)" />
    <rect x="13" y="8" width="4" height="8" fill="var(--color-ss-warning)" />
    <rect x="18" y="8" width="4" height="8" fill="var(--color-ss-error)" />
  </svg>
);

const IconSetIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="6" cy="12" r="3" fill="var(--color-ss-success)" />
    <circle cx="12" cy="12" r="3" fill="var(--color-ss-warning)" />
    <circle cx="18" cy="12" r="3" fill="var(--color-ss-error)" />
  </svg>
);

const GreaterThanIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
  </svg>
);

const Top10Icon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2L4 12l8 10 8-10L12 2zm0 3.5L17.5 12 12 18.5 6.5 12 12 5.5z" />
  </svg>
);

const ClearIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
  </svg>
);

const ColumnChartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="14" width="4" height="6" />
    <rect x="10" y="8" width="4" height="12" />
    <rect x="16" y="4" width="4" height="16" />
  </svg>
);

const LineChartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 17l5-5 4 4 9-9v3l-9 9-4-4-5 5v-3z" />
  </svg>
);

const PieChartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8v8l6.93 4A7.96 7.96 0 0012 20z" />
  </svg>
);

const ScatterChartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="6" cy="18" r="2" />
    <circle cx="10" cy="14" r="2" />
    <circle cx="14" cy="10" r="2" />
    <circle cx="18" cy="6" r="2" />
  </svg>
);

const AreaChartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 20h18V4L3 20zm3-4l4-4 4 4 6-8v8H6z" opacity="0.3" />
    <path d="M3 20l8-8 4 4 6-8" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const AverageIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
  </svg>
);

const CountIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14h-2V9h2v8zm-2-10V5h2v2h-2z" />
  </svg>
);

const PercentIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M7.5 4C5.57 4 4 5.57 4 7.5S5.57 11 7.5 11 11 9.43 11 7.5 9.43 4 7.5 4zm0 5C6.67 9 6 8.33 6 7.5S6.67 6 7.5 6 9 6.67 9 7.5 8.33 9 7.5 9zM16.5 13c-1.93 0-3.5 1.57-3.5 3.5s1.57 3.5 3.5 3.5 3.5-1.57 3.5-3.5-1.57-3.5-3.5-3.5zm0 5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5.41 20L4 18.59 18.59 4 20 5.41 5.41 20z" />
  </svg>
);

const RunningTotalIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 3h18v2H3V3zm0 8h12v2H3v-2zm0 8h6v2H3v-2zm14-4l4 4-4 4v-3h-4v-2h4v-3z" />
  </svg>
);

const PivotTableIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M10 8v8l5-4-5-4zm9-5H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z" />
  </svg>
);

const SparklineColumnIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="12" width="3" height="8" />
    <rect x="9" y="8" width="3" height="12" />
    <rect x="14" y="4" width="3" height="16" />
  </svg>
);

const SparklineWinLossIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="3" height="8" fill="var(--color-ss-success)" />
    <rect x="9" y="12" width="3" height="8" fill="var(--color-ss-error)" />
    <rect x="14" y="4" width="3" height="8" fill="var(--color-ss-success)" />
  </svg>
);
