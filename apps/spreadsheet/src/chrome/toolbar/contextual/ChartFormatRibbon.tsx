import { useCallback } from 'react';
import { useStore } from 'zustand';
import { dispatch, useDocumentContext } from '../../../internal-api';

import { useChartUI } from '../../../hooks/charts/use-chart';
import { useCharts } from '../../../hooks/charts/use-charts';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';
import { RibbonButton } from '../primitives/RibbonButton';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import {
  BringForwardIcon,
  BringToFrontIcon,
  DeleteIcon,
  SendBackwardIcon,
  SendToBackIcon,
} from '../primitives/ToolbarIcons';
import type { ContextualTabProps } from './contextual-tab-registry';

export function ChartFormatRibbon(_props: ContextualTabProps) {
  const deps = useActionDependencies();
  const { uiStore } = useDocumentContext();
  const activeSheetId = useStore(uiStore, (s) => s.activeSheetId);
  const { selectedChartId, deleteSelectedChart } = useChartUI();
  const { charts, updateChart } = useCharts({ sheetId: activeSheetId });
  const selectedChart = charts.find((c) => c.id === selectedChartId);

  const handleOpenFormat = useCallback(() => {
    if (selectedChartId) {
      dispatch('OPEN_FORMAT_CHART_AREA', deps, { chartId: selectedChartId });
    }
  }, [deps, selectedChartId]);

  const handleResetStyle = useCallback(() => {
    if (selectedChartId) {
      dispatch('RESET_CHART_STYLE', deps, { chartId: selectedChartId });
    }
  }, [deps, selectedChartId]);

  const updateSize = useCallback(
    (field: 'width' | 'height', value: string) => {
      if (!selectedChartId) return;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      updateChart(selectedChartId, { [field]: parsed });
    },
    [selectedChartId, updateChart],
  );

  const dispatchChartCommand = useCallback(
    (
      action:
        | 'BRING_CHART_TO_FRONT'
        | 'SEND_CHART_TO_BACK'
        | 'BRING_CHART_FORWARD'
        | 'SEND_CHART_BACKWARD',
    ) => {
      if (selectedChartId) {
        dispatch(action, deps, { chartId: selectedChartId });
      }
    },
    [deps, selectedChartId],
  );

  return (
    <>
      <ToolbarGroup label="Format">
        <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
          <RibbonButton
            layout="text"
            height="half"
            label="Format Chart Area"
            onClick={handleOpenFormat}
            title="Format chart area"
            aria-label="Format Chart Area"
          />
          <RibbonButton
            layout="text"
            height="half"
            label="Reset Style"
            onClick={handleResetStyle}
            title="Reset chart style"
            aria-label="Reset Chart Style"
          />
        </div>
      </ToolbarGroup>

      <ToolbarGroup label="Size">
        <div className="flex flex-col gap-[var(--ribbon-button-gap)] text-ribbon">
          <label className="flex items-center gap-1">
            <span className="w-10">Width</span>
            <input
              className="h-6 w-16 rounded border border-ss-border px-1"
              type="number"
              min={1}
              value={selectedChart?.config.width ?? ''}
              onChange={(event) => updateSize('width', event.currentTarget.value)}
              aria-label="Chart width"
            />
          </label>
          <label className="flex items-center gap-1">
            <span className="w-10">Height</span>
            <input
              className="h-6 w-16 rounded border border-ss-border px-1"
              type="number"
              min={1}
              value={selectedChart?.config.height ?? ''}
              onChange={(event) => updateSize('height', event.currentTarget.value)}
              aria-label="Chart height"
            />
          </label>
        </div>
      </ToolbarGroup>

      <ToolbarGroup label="Arrange">
        <div className="flex items-center gap-[var(--ribbon-button-inline-gap)]">
          <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<BringToFrontIcon />}
              label="Bring to Front"
              onClick={() => dispatchChartCommand('BRING_CHART_TO_FRONT')}
              title="Bring chart to front"
              aria-label="Bring to Front"
            />
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<SendToBackIcon />}
              label="Send to Back"
              onClick={() => dispatchChartCommand('SEND_CHART_TO_BACK')}
              title="Send chart to back"
              aria-label="Send to Back"
            />
          </div>
          <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<BringForwardIcon />}
              label="Bring Forward"
              onClick={() => dispatchChartCommand('BRING_CHART_FORWARD')}
              title="Bring chart forward"
              aria-label="Bring Forward"
            />
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<SendBackwardIcon />}
              label="Send Backward"
              onClick={() => dispatchChartCommand('SEND_CHART_BACKWARD')}
              title="Send chart backward"
              aria-label="Send Backward"
            />
          </div>
        </div>
      </ToolbarGroup>

      <ToolbarGroup label="Actions" isLast>
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<DeleteIcon />}
          label="Delete"
          onClick={deleteSelectedChart}
          title="Delete selected chart"
          aria-label="Delete Chart"
        />
      </ToolbarGroup>
    </>
  );
}
