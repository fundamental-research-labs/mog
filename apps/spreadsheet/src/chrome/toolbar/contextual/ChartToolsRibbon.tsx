/**
 * ChartToolsRibbon
 *
 * Contextual ribbon tab shown when a chart is selected.
 * Provides chart type, data, and element controls.
 *
 * Groups:
 * - Type: Change chart type button/dropdown
 * - Data: Select Data, Switch Row/Column buttons
 * - Chart Elements: Add/remove title, legend, labels (toggles)
 * - Arrange: Z-order controls (Bring Forward, Send Backward, etc.)
 */

import { useCallback, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { dispatch, useDocumentContext } from '../../../internal-api';

import type { ChartType } from '@mog/charts';

import { Checkbox } from '@mog/shell';
import { useChartUI } from '../../../hooks/charts/use-chart';
import { useCharts } from '../../../hooks/charts/use-charts';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';
import { RibbonButton } from '../primitives/RibbonButton';
import { RibbonDropdownItem, RibbonDropdownPanel } from '../primitives/RibbonDropdown';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import {
  BringForwardIcon,
  BringToFrontIcon,
  ChartBarIcon,
  ChartColumnIcon,
  ChartIcon,
  ChartLineIcon,
  ChartPieIcon,
  DeleteIcon,
  DropdownArrowIcon,
  SendBackwardIcon,
  SendToBackIcon,
} from '../primitives/ToolbarIcons';
import type { ContextualTabProps } from './contextual-tab-registry';

// =============================================================================
// Types
// =============================================================================

interface ChartTypeOption {
  type: ChartType;
  label: string;
}

// =============================================================================
// Constants
// =============================================================================

const CHART_TYPES: ChartTypeOption[] = [
  { type: 'column', label: 'Column' },
  { type: 'bar', label: 'Bar' },
  { type: 'line', label: 'Line' },
  { type: 'area', label: 'Area' },
  { type: 'pie', label: 'Pie' },
  { type: 'doughnut', label: 'Doughnut' },
  { type: 'scatter', label: 'Scatter' },
  { type: 'combo', label: 'Combo' },
];

interface OptimisticTitleToggle {
  chartId: string;
  checked: boolean;
}

interface OptimisticLegendToggle {
  chartId: string;
  checked: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function ChartToolsRibbon(_props: ContextualTabProps) {
  const deps = useActionDependencies();
  const { uiStore } = useDocumentContext();
  const activeSheetId = useStore(uiStore, (s) => s.activeSheetId);
  const { selectedChartId, deleteSelectedChart } = useChartUI();
  const { charts, setChartTitleVisible, setLegendVisible, switchSeriesOrientation } = useCharts({
    sheetId: activeSheetId,
  });
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [optimisticTitleToggle, setOptimisticTitleToggle] = useState<OptimisticTitleToggle | null>(
    null,
  );
  const [optimisticLegendToggle, setOptimisticLegendToggle] =
    useState<OptimisticLegendToggle | null>(null);

  // Get the selected chart
  const selectedChart = charts.find((c) => c.id === selectedChartId);
  const currentType = selectedChart?.type ?? 'column';

  // Check if chart has title/legend
  const observedHasTitle =
    selectedChart?.appModel?.title.visible ??
    (selectedChart?.config.autoTitleDeleted === true
      ? false
      : Boolean(selectedChart?.config.title));
  const hasTitle =
    optimisticTitleToggle && optimisticTitleToggle.chartId === selectedChartId
      ? optimisticTitleToggle.checked
      : observedHasTitle;
  const observedHasLegend = selectedChart
    ? (selectedChart.appModel?.legend.visible ?? selectedChart.config.legend?.show !== false)
    : false;
  const hasLegend =
    optimisticLegendToggle && optimisticLegendToggle.chartId === selectedChartId
      ? optimisticLegendToggle.checked
      : observedHasLegend;

  useEffect(() => {
    if (!optimisticTitleToggle) {
      return;
    }

    if (!selectedChart || !selectedChartId || optimisticTitleToggle.chartId !== selectedChartId) {
      setOptimisticTitleToggle(null);
      return;
    }

    if (optimisticTitleToggle.checked === observedHasTitle) {
      setOptimisticTitleToggle(null);
    }
  }, [optimisticTitleToggle, observedHasTitle, selectedChart, selectedChartId]);

  useEffect(() => {
    if (!optimisticLegendToggle) {
      return;
    }

    if (!selectedChart || !selectedChartId || optimisticLegendToggle.chartId !== selectedChartId) {
      setOptimisticLegendToggle(null);
      return;
    }

    if (optimisticLegendToggle.checked === observedHasLegend) {
      setOptimisticLegendToggle(null);
    }
  }, [optimisticLegendToggle, observedHasLegend, selectedChart, selectedChartId]);

  const clearOptimisticTitleToggle = useCallback((chartId: string, checked: boolean) => {
    setOptimisticTitleToggle((current) =>
      current?.chartId === chartId && current.checked === checked ? null : current,
    );
  }, []);

  const clearOptimisticLegendToggle = useCallback((chartId: string, checked: boolean) => {
    setOptimisticLegendToggle((current) =>
      current?.chartId === chartId && current.checked === checked ? null : current,
    );
  }, []);

  const getSelectedChartIdForCommand = useCallback(
    () => deps.accessors.object.getFirstSelectedId() ?? selectedChartId,
    [deps, selectedChartId],
  );

  // ==========================================================================
  // Handlers
  // ==========================================================================

  const handleChangeType = useCallback(
    (type: ChartType) => {
      if (selectedChartId) {
        dispatch('CHANGE_CHART_TYPE', deps, { chartId: selectedChartId, chartType: type });
      }
      setTypeDropdownOpen(false);
    },
    [selectedChartId, deps],
  );

  const handleToggleTitle = useCallback(
    (checked: boolean) => {
      if (selectedChartId && selectedChart) {
        const chartId = selectedChartId;
        setOptimisticTitleToggle({ chartId, checked });
        void setChartTitleVisible(chartId, checked)
          .then((receipt) => {
            if (receipt.status !== 'applied') {
              clearOptimisticTitleToggle(chartId, checked);
            }
          })
          .catch(() => clearOptimisticTitleToggle(chartId, checked));
      }
    },
    [clearOptimisticTitleToggle, selectedChartId, selectedChart, setChartTitleVisible],
  );

  const handleToggleLegend = useCallback(
    (checked: boolean) => {
      if (selectedChartId) {
        const chartId = selectedChartId;
        setOptimisticLegendToggle({ chartId, checked });
        void setLegendVisible(chartId, checked)
          .then((receipt) => {
            if (receipt.status !== 'applied') {
              clearOptimisticLegendToggle(chartId, checked);
            }
          })
          .catch(() => clearOptimisticLegendToggle(chartId, checked));
      }
    },
    [clearOptimisticLegendToggle, selectedChartId, setLegendVisible],
  );

  const handleSwitchRowColumn = useCallback(() => {
    const chartId = getSelectedChartIdForCommand();
    if (chartId) {
      void switchSeriesOrientation(chartId);
    }
  }, [getSelectedChartIdForCommand, switchSeriesOrientation]);

  const handleSelectData = useCallback(() => {
    const chartId = getSelectedChartIdForCommand();
    if (chartId) {
      // Open the chart editor which allows data range selection
      dispatch('EDIT_CHART', deps, { chartId });
    }
  }, [getSelectedChartIdForCommand, deps]);

  const handleBringToFront = useCallback(() => {
    dispatch('BRING_CHART_TO_FRONT', deps);
  }, [deps]);

  const handleSendToBack = useCallback(() => {
    dispatch('SEND_CHART_TO_BACK', deps);
  }, [deps]);

  const handleBringForward = useCallback(() => {
    dispatch('BRING_CHART_FORWARD', deps);
  }, [deps]);

  const handleSendBackward = useCallback(() => {
    dispatch('SEND_CHART_BACKWARD', deps);
  }, [deps]);

  const handleDelete = useCallback(() => {
    deleteSelectedChart();
  }, [deleteSelectedChart]);

  // Get icon for current chart type
  const getChartTypeIcon = () => {
    switch (currentType) {
      case 'column':
        return <ChartColumnIcon />;
      case 'bar':
        return <ChartBarIcon />;
      case 'line':
        return <ChartLineIcon />;
      case 'pie':
      case 'doughnut':
        return <ChartPieIcon />;
      default:
        return <ChartIcon />;
    }
  };

  return (
    <>
      {/* Type Group */}
      <ToolbarGroup label="Type">
        <div className="relative inline-flex">
          <RibbonButton
            layout="vertical"
            height="full"
            data-testid="ribbon-dropdown-chart-type"
            icon={getChartTypeIcon()}
            label="Change Type"
            hasDropdown
            isOpen={typeDropdownOpen}
            onClick={() => setTypeDropdownOpen(!typeDropdownOpen)}
            title="Change chart type"
            aria-label="Change chart type"
          />

          <RibbonDropdownPanel open={typeDropdownOpen} onClose={() => setTypeDropdownOpen(false)}>
            <div
              data-testid="ribbon-dropdown-menu-chart-type"
              className="bg-ss-surface border border-ss-border rounded shadow-ss-md py-1 min-w-[140px]"
            >
              {CHART_TYPES.map((ct) => (
                <RibbonDropdownItem
                  key={ct.type}
                  dataValue={ct.type}
                  onClick={() => handleChangeType(ct.type)}
                  isSelected={currentType === ct.type}
                  closeOnClick
                >
                  {ct.label}
                </RibbonDropdownItem>
              ))}
            </div>
          </RibbonDropdownPanel>
        </div>
      </ToolbarGroup>

      {/* Data Group */}
      <ToolbarGroup label="Data">
        <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
          <RibbonButton
            layout="horizontal"
            height="half"
            icon={<DropdownArrowIcon />}
            label="Select Data"
            onClick={handleSelectData}
            title="Select data range for the chart"
            aria-label="Select Data"
          />
          <RibbonButton
            layout="horizontal"
            height="half"
            icon={<DropdownArrowIcon />}
            label="Switch Row/Column"
            onClick={handleSwitchRowColumn}
            title="Switch between rows and columns as data series"
            aria-label="Switch Row/Column"
          />
        </div>
      </ToolbarGroup>

      {/* Chart Elements Group */}
      <ToolbarGroup label="Chart Elements">
        <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
          <Checkbox
            checked={hasTitle}
            onChange={handleToggleTitle}
            label="Chart Title"
            className="text-ribbon"
          />
          <Checkbox
            checked={hasLegend}
            onChange={handleToggleLegend}
            label="Legend"
            className="text-ribbon"
          />
        </div>
      </ToolbarGroup>

      {/* Arrange Group - Z-Order controls */}
      <ToolbarGroup label="Arrange">
        <div className="flex items-center gap-[var(--ribbon-button-inline-gap)]">
          <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<BringToFrontIcon />}
              label="Bring to Front"
              onClick={handleBringToFront}
              title="Bring chart to front (highest layer)"
              aria-label="Bring to Front"
            />
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<SendToBackIcon />}
              label="Send to Back"
              onClick={handleSendToBack}
              title="Send chart to back (lowest layer)"
              aria-label="Send to Back"
            />
          </div>
          <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<BringForwardIcon />}
              label="Bring Forward"
              onClick={handleBringForward}
              title="Bring chart forward one layer"
              aria-label="Bring Forward"
            />
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<SendBackwardIcon />}
              label="Send Backward"
              onClick={handleSendBackward}
              title="Send chart backward one layer"
              aria-label="Send Backward"
            />
          </div>
        </div>
      </ToolbarGroup>

      {/* Delete Group */}
      <ToolbarGroup label="Actions" isLast>
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<DeleteIcon />}
          label="Delete"
          onClick={handleDelete}
          title="Delete selected chart"
          aria-label="Delete Chart"
        />
      </ToolbarGroup>
    </>
  );
}
