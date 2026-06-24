/**
 * ChartEditorContainer
 *
 * Container component that wires ChartEditor with XState selection context.
 * Must be rendered inside SpreadsheetCoordinatorProvider to access coordinator hooks.
 *
 * This container exists because useChartEditorActions depends on useSelection
 * which requires the coordinator context.
 */

import { useUIStore } from '../../internal-api';
import { useChartEditorActions } from '../../hooks/charts/use-chart-editor-actions';
import { ChartEditor } from './ChartEditor';

export function ChartEditorContainer() {
  const chartEditorTab = useUIStore((s) => s.chartEditorTab);
  const {
    editingChart,
    handleChartEditorChange,
    handleChartLegendVisibleChange,
    handleChartAxisTitleChange,
    handleChartEditorClose,
    handleChartEditorDelete,
  } = useChartEditorActions();

  if (!editingChart) {
    return null;
  }

  return (
    <div className="absolute top-12 right-4 z-ss-overlay">
      <ChartEditor
        config={editingChart.config}
        appModel={editingChart.appModel}
        initialTab={chartEditorTab === 'style' ? 'style' : 'data'}
        onChange={handleChartEditorChange}
        onSetLegendVisible={handleChartLegendVisibleChange}
        onSetAxisTitle={handleChartAxisTitleChange}
        onClose={handleChartEditorClose}
        onDelete={handleChartEditorDelete}
      />
    </div>
  );
}
