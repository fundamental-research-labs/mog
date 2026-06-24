/**
 * Chart Editor Panel
 *
 * Configuration panel for editing chart properties.
 * Displays when a chart is selected and in edit mode.
 *
 * @module components/ChartEditor
 */

import { useCallback, useEffect, useState } from 'react';

import type {
  AreaSubType,
  BarSubType,
  ChartConfig,
  ChartType,
  LegendPosition,
  LineSubType,
  TrendlineType,
} from '@mog/charts';
import type { ChartAppModel, ChartAxisRole } from '@mog-sdk/contracts/data/chart-app-model';

import { Button, Checkbox, Input, SectionLabel, Select, Tabs } from '@mog/shell/components/ui';
import {
  normalizeAxisConfig,
  normalizeLegendConfig,
  normalizePieSliceConfig,
} from '../../adapters/charts/chart-config-adapter';

// =============================================================================
// Types
// =============================================================================

export interface ChartEditorProps {
  /** Chart configuration to edit */
  config: ChartConfig;
  /** Semantic chart model for first-party controls. */
  appModel?: ChartAppModel;
  /** Initial tab to show when opening the editor. */
  initialTab?: TabId;
  /** Called when config changes */
  onChange: (updates: Partial<ChartConfig>) => void;
  /** Called when legend visibility changes semantically. */
  onSetLegendVisible?: (visible: boolean) => void;
  /** Called when an axis title changes semantically. */
  onSetAxisTitle?: (axisRole: ChartAxisRole, title: string) => void;
  /** Called when editor should close */
  onClose: () => void;
  /** Called when chart should be deleted */
  onDelete: () => void;
}

type TabId = 'data' | 'style' | 'legend' | 'axis' | 'advanced';

// =============================================================================
// Constants
// =============================================================================

const CHART_EDITOR_TABS = [
  { id: 'data' as const, label: 'Data' },
  { id: 'style' as const, label: 'Style' },
  { id: 'legend' as const, label: 'Legend' },
  { id: 'axis' as const, label: 'Axis' },
  { id: 'advanced' as const, label: 'More' },
];

const CHART_TYPES: { type: ChartType; label: string }[] = [
  { type: 'column', label: 'Column' },
  { type: 'bar', label: 'Bar' },
  { type: 'line', label: 'Line' },
  { type: 'area', label: 'Area' },
  { type: 'pie', label: 'Pie' },
  { type: 'doughnut', label: 'Donut' },
  { type: 'scatter', label: 'Scatter' },
  { type: 'combo', label: 'Combo' },
];

const LEGEND_POSITIONS: { value: LegendPosition; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'none', label: 'Hidden' },
];

// First 6 colors match design token accents (ss-accent-1 through ss-accent-6).
// Extended chart palette - TODO: extract remaining colors to design tokens
const PRESET_COLORS = [
  '#4472C4', // ss-accent-1
  '#ED7D31', // ss-accent-2
  '#A5A5A5', // ss-accent-3
  '#FFC000', // ss-accent-4
  '#5B9BD5', // ss-accent-5
  '#70AD47', // ss-accent-6
  '#264478',
  '#9E480E',
  '#636363',
  '#997300',
  '#217346',
  '#34a853',
  '#fbbc04',
  '#ea4335',
  '#9334e6',
];

const TRENDLINE_TYPES: { value: TrendlineType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'moving-average', label: 'Moving Average' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'logarithmic', label: 'Logarithmic' },
  { value: 'polynomial', label: 'Polynomial' },
  { value: 'power', label: 'Power' },
];

// =============================================================================
// Chart Type Icons (Simplified)
// =============================================================================

function ChartTypeIcon({ type }: { type: ChartType }) {
  switch (type) {
    case 'column':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 9h4v11H4V9zm6-4h4v15h-4V5zm6 8h4v7h-4v-7z" />
        </svg>
      );
    case 'bar':
      return (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{ transform: 'rotate(90deg)' }}
        >
          <path d="M4 9h4v11H4V9zm6-4h4v15h-4V5zm6 8h4v7h-4v-7z" />
        </svg>
      );
    case 'line':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3.5 18.5L9.5 12.5L13.5 16.5L22 6.92L20.59 5.5L13.5 13.5L9.5 9.5L2 17L3.5 18.5Z" />
        </svg>
      );
    case 'area':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.5">
          <path d="M3 13.5L9 7.5L13 11.5L21 3V21H3V13.5Z" />
        </svg>
      );
    case 'pie':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11 2v9h9c0-4.97-4.03-9-9-9zm-1 10V3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9h-9z" />
        </svg>
      );
    case 'doughnut':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" />
        </svg>
      );
    case 'scatter':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="7" cy="14" r="2" />
          <circle cx="11" cy="8" r="2" />
          <circle cx="16" cy="16" r="2" />
          <circle cx="18" cy="9" r="2" />
        </svg>
      );
    case 'combo':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 12h3v8H4v-8zm6-4h3v12h-3V8z" />
          <path d="M3 15L8.5 10L12.5 14L20 6" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    default:
      return null;
  }
}

// =============================================================================
// Component
// =============================================================================

export function ChartEditor({
  config,
  appModel,
  initialTab = 'data',
  onChange,
  onSetLegendVisible,
  onSetAxisTitle,
  onClose,
  onDelete,
}: ChartEditorProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const resolvedLegendVisible = appModel?.legend.visible ?? config.legend?.show !== false;
  const resolvedCategoryAxisTitle = appModel
    ? (appModel.axes.category.title ?? '')
    : (config.axis?.categoryAxis?.title ?? config.axis?.xAxis?.title ?? '');
  const resolvedValueAxisTitle = appModel
    ? (appModel.axes.value.title ?? '')
    : (config.axis?.valueAxis?.title ?? config.axis?.yAxis?.title ?? '');
  const [legendVisibleDraft, setLegendVisibleDraft] = useState(resolvedLegendVisible);
  const [categoryAxisTitleDraft, setCategoryAxisTitleDraft] = useState(resolvedCategoryAxisTitle);
  const [valueAxisTitleDraft, setValueAxisTitleDraft] = useState(resolvedValueAxisTitle);

  useEffect(() => {
    setLegendVisibleDraft(resolvedLegendVisible);
  }, [resolvedLegendVisible]);

  useEffect(() => {
    setCategoryAxisTitleDraft(resolvedCategoryAxisTitle);
  }, [resolvedCategoryAxisTitle]);

  useEffect(() => {
    setValueAxisTitleDraft(resolvedValueAxisTitle);
  }, [resolvedValueAxisTitle]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Handlers
  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ title: e.target.value });
    },
    [onChange],
  );

  const handleDataRangeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ dataRange: e.target.value.toUpperCase() });
    },
    [onChange],
  );

  const handleTypeChange = useCallback(
    (type: ChartType) => {
      onChange({ type });
    },
    [onChange],
  );

  const handleSubTypeChange = useCallback(
    (value: string) => {
      const next = value as BarSubType | LineSubType | AreaSubType | '';
      onChange({ subType: next || undefined });
    },
    [onChange],
  );

  const handleLegendShowChange = useCallback(
    (checked: boolean) => {
      setLegendVisibleDraft(checked);
      if (onSetLegendVisible) {
        onSetLegendVisible(checked);
        return;
      }
      onChange({
        legend: normalizeLegendConfig({
          ...config.legend,
          show: checked,
          position: config.legend?.position || 'bottom',
        }),
      });
    },
    [config.legend, onChange, onSetLegendVisible],
  );

  const handleLegendPositionChange = useCallback(
    (value: string) => {
      const position = value as LegendPosition;
      onChange({
        legend: normalizeLegendConfig({
          ...config.legend,
          show: position !== 'none',
          position,
        }),
      });
    },
    [config.legend, onChange],
  );

  const handleDataLabelsChange = useCallback(
    (checked: boolean) => {
      onChange({
        dataLabels: {
          ...config.dataLabels,
          show: checked,
        },
      });
    },
    [config.dataLabels, onChange],
  );

  const handleColorChange = useCallback(
    (colorIndex: number, color: string) => {
      const newColors = [...(config.colors || PRESET_COLORS.slice(0, 10))];
      newColors[colorIndex] = color;
      onChange({ colors: newColors });
    },
    [config.colors, onChange],
  );

  const handleAxisTitleChange = useCallback((axisRole: 'category' | 'value', title: string) => {
    if (axisRole === 'category') {
      setCategoryAxisTitleDraft(title);
    } else {
      setValueAxisTitleDraft(title);
    }
  }, []);

  const commitAxisTitle = useCallback(
    (axisRole: 'category' | 'value', title: string) => {
      if (onSetAxisTitle) {
        onSetAxisTitle(axisRole, title);
        return;
      }
      const axis = axisRole === 'category' ? 'categoryAxis' : 'valueAxis';
      const alias = axisRole === 'category' ? 'xAxis' : 'yAxis';
      const nextAxis = {
        ...(config.axis?.[axis] ?? config.axis?.[alias]),
        title,
      };
      onChange({
        axis: normalizeAxisConfig({
          ...config.axis,
          [axis]: nextAxis,
          [alias]: nextAxis,
        }),
      });
    },
    [config.axis, onChange, onSetAxisTitle],
  );

  const handleAxisTitleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }
  }, []);

  const handleGridLinesChange = useCallback(
    (axisRole: 'category' | 'value', show: boolean) => {
      const axis = axisRole === 'category' ? 'categoryAxis' : 'valueAxis';
      const alias = axisRole === 'category' ? 'xAxis' : 'yAxis';
      const nextAxis = {
        ...(config.axis?.[axis] ?? config.axis?.[alias]),
        gridLines: show,
      };
      onChange({
        axis: normalizeAxisConfig({
          ...config.axis,
          [axis]: nextAxis,
          [alias]: nextAxis,
        }),
      });
    },
    [config.axis, onChange],
  );

  const handleMinorGridLinesChange = useCallback(
    (axisRole: 'category' | 'value', show: boolean) => {
      const axis = axisRole === 'category' ? 'categoryAxis' : 'valueAxis';
      const alias = axisRole === 'category' ? 'xAxis' : 'yAxis';
      const nextAxis = {
        ...(config.axis?.[axis] ?? config.axis?.[alias]),
        minorGridLines: show,
      };
      onChange({
        axis: normalizeAxisConfig({
          ...config.axis,
          [axis]: nextAxis,
          [alias]: nextAxis,
        }),
      });
    },
    [config.axis, onChange],
  );

  // Pie slice handlers
  const handleExplodedIndexChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      const index = value === '' ? undefined : parseInt(value, 10);
      onChange({
        pieSlice: normalizePieSliceConfig({
          ...config.pieSlice,
          explodedIndices: Number.isNaN(index) || index === undefined ? undefined : [index],
        }),
      });
    },
    [config.pieSlice, onChange],
  );

  const handleExplodeOffsetChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseFloat(e.target.value);
      onChange({
        pieSlice: {
          ...config.pieSlice,
          explodeOffset: isNaN(value) ? 0.1 : value,
        },
      });
    },
    [config.pieSlice, onChange],
  );

  // Trendline handlers
  const handleTrendlineShowChange = useCallback(
    (checked: boolean) => {
      onChange({
        trendline: {
          ...config.trendline,
          show: checked,
          type: config.trendline?.type || 'linear',
        },
      });
    },
    [config.trendline, onChange],
  );

  const handleTrendlineTypeChange = useCallback(
    (value: string) => {
      onChange({
        trendline: {
          ...config.trendline,
          show: config.trendline?.show ?? true,
          type: value as TrendlineType,
        },
      });
    },
    [config.trendline, onChange],
  );

  const handleTrendlineR2Change = useCallback(
    (checked: boolean) => {
      onChange({
        trendline: {
          ...config.trendline,
          show: config.trendline?.show ?? true,
          type: config.trendline?.type || 'linear',
          showR2: checked,
        },
      });
    },
    [config.trendline, onChange],
  );

  // Render subtypes based on chart type
  const renderSubTypeSelect = () => {
    let options: { value: string; label: string }[] = [];

    switch (config.type) {
      case 'bar':
      case 'column':
        options = [
          { value: 'default', label: 'Default' },
          { value: 'clustered', label: 'Clustered' },
          { value: 'stacked', label: 'Stacked' },
          { value: 'percentStacked', label: '100% Stacked' },
        ];
        break;
      case 'line':
        options = [
          { value: 'default', label: 'Default' },
          { value: 'straight', label: 'Straight' },
          { value: 'smooth', label: 'Smooth' },
          { value: 'stepped', label: 'Stepped' },
        ];
        break;
      case 'area':
        options = [
          { value: 'default', label: 'Default' },
          { value: 'standard', label: 'Standard' },
          { value: 'stacked', label: 'Stacked' },
          { value: 'percentStacked', label: '100% Stacked' },
        ];
        break;
      default:
        return null;
    }

    return (
      <div className="mb-4">
        <SectionLabel size="md" uppercase className="mb-2">
          Variant
        </SectionLabel>
        <Select
          value={config.subType || 'default'}
          onChange={handleSubTypeChange}
          options={options}
          className="w-full"
        />
      </div>
    );
  };

  return (
    <div
      data-testid="chart-editor-panel"
      className="w-[280px] bg-ss-surface rounded-ss-lg shadow-ss-md border border-ss-border overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ss-border bg-ss-surface-secondary">
        <span className="text-body-lg font-semibold text-text">Edit Chart</span>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center w-6 h-6 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary hover:bg-ss-surface-hover transition-colors"
          aria-label="Close"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={CHART_EDITOR_TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as TabId)}
        size="sm"
      />

      {/* Content */}
      <div className="p-4 max-h-[400px] overflow-y-auto">
        {activeTab === 'data' && (
          <>
            <div className="mb-4">
              <SectionLabel size="md" uppercase className="mb-2">
                Chart Type
              </SectionLabel>
              <div className="grid grid-cols-4 gap-2">
                {CHART_TYPES.map((ct) => (
                  <button
                    key={ct.type}
                    type="button"
                    onClick={() => handleTypeChange(ct.type)}
                    className={`flex flex-col items-center p-2 border rounded cursor-pointer transition-all ${
                      config.type === ct.type
                        ? 'border-ss-primary bg-ss-primary-light'
                        : 'border-ss-border bg-transparent hover:bg-ss-surface-hover'
                    }`}
                  >
                    <div className="mb-1 text-ss-text-secondary">
                      <ChartTypeIcon type={ct.type} />
                    </div>
                    <span className="text-ribbon-group text-ss-text-secondary">{ct.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {renderSubTypeSelect()}

            <div className="mb-4">
              <SectionLabel size="md" uppercase className="mb-2">
                Title
              </SectionLabel>
              <Input
                value={config.title || ''}
                onChange={handleTitleChange}
                placeholder="Chart title"
              />
            </div>

            <div className="mb-4">
              <SectionLabel size="md" uppercase className="mb-2">
                Data Range
              </SectionLabel>
              <Input
                value={config.dataRange || ''}
                onChange={handleDataRangeChange}
                placeholder="e.g., A1:D10"
              />
            </div>
          </>
        )}

        {activeTab === 'style' && (
          <>
            <div className="mb-4">
              <SectionLabel size="md" uppercase className="mb-2">
                Colors
              </SectionLabel>
              <div className="grid grid-cols-5 gap-1">
                {(config.colors || PRESET_COLORS.slice(0, 10)).slice(0, 10).map((color, idx) => (
                  <input
                    key={idx}
                    type="color"
                    value={color}
                    onChange={(e) => handleColorChange(idx, e.target.value)}
                    className="w-7 h-7 rounded border-2 border-transparent cursor-pointer transition-transform hover:scale-110"
                    style={{ backgroundColor: color }}
                    title={`Series ${idx + 1} color`}
                  />
                ))}
              </div>
            </div>

            <div className="mb-4">
              <Checkbox
                checked={config.dataLabels?.show || false}
                onChange={handleDataLabelsChange}
                label="Show data labels"
              />
            </div>
          </>
        )}

        {activeTab === 'legend' && (
          <>
            <div className="mb-4">
              <Checkbox
                checked={legendVisibleDraft}
                onChange={handleLegendShowChange}
                label="Show legend"
              />
            </div>

            <div className="mb-4">
              <SectionLabel size="md" uppercase className="mb-2">
                Position
              </SectionLabel>
              <Select
                value={config.legend?.position || 'bottom'}
                onChange={handleLegendPositionChange}
                options={LEGEND_POSITIONS.map((pos) => ({ value: pos.value, label: pos.label }))}
                disabled={!legendVisibleDraft}
              />
            </div>
          </>
        )}

        {activeTab === 'axis' && (
          <>
            <div className="mb-4">
              <SectionLabel size="md" uppercase className="mb-2">
                X-Axis Title
              </SectionLabel>
              <Input
                value={categoryAxisTitleDraft}
                onChange={(e) => handleAxisTitleChange('category', e.target.value)}
                onBlur={(e) => commitAxisTitle('category', e.target.value)}
                onKeyDown={handleAxisTitleKeyDown}
                placeholder="X-axis title"
              />
            </div>

            <div className="mb-4">
              <SectionLabel size="md" uppercase className="mb-2">
                Y-Axis Title
              </SectionLabel>
              <Input
                value={valueAxisTitleDraft}
                onChange={(e) => handleAxisTitleChange('value', e.target.value)}
                onBlur={(e) => commitAxisTitle('value', e.target.value)}
                onKeyDown={handleAxisTitleKeyDown}
                placeholder="Y-axis title"
              />
            </div>

            <div className="mb-4">
              <Checkbox
                checked={
                  config.axis?.categoryAxis?.gridLines ?? config.axis?.xAxis?.gridLines ?? false
                }
                onChange={(checked) => handleGridLinesChange('category', checked)}
                label="X-axis grid lines"
              />
            </div>

            <div className="mb-4">
              <Checkbox
                checked={
                  config.axis?.categoryAxis?.minorGridLines ??
                  config.axis?.xAxis?.minorGridLines ??
                  false
                }
                onChange={(checked) => handleMinorGridLinesChange('category', checked)}
                label="X-axis minor grid lines"
                disabled={!(config.axis?.categoryAxis?.gridLines ?? config.axis?.xAxis?.gridLines)}
              />
            </div>

            <div className="mb-4">
              <Checkbox
                checked={config.axis?.valueAxis?.gridLines ?? config.axis?.yAxis?.gridLines ?? true}
                onChange={(checked) => handleGridLinesChange('value', checked)}
                label="Y-axis grid lines"
              />
            </div>

            <div className="mb-4">
              <Checkbox
                checked={
                  config.axis?.valueAxis?.minorGridLines ??
                  config.axis?.yAxis?.minorGridLines ??
                  false
                }
                onChange={(checked) => handleMinorGridLinesChange('value', checked)}
                label="Y-axis minor grid lines"
                disabled={
                  (config.axis?.valueAxis?.gridLines ?? config.axis?.yAxis?.gridLines) === false
                }
              />
            </div>
          </>
        )}

        {activeTab === 'advanced' && (
          <>
            {/* Pie/Doughnut specific options */}
            {(config.type === 'pie' || config.type === 'doughnut') && (
              <>
                <div className="mb-4">
                  <SectionLabel size="md" uppercase className="mb-2">
                    Exploded Slice
                  </SectionLabel>
                  <Input
                    type="number"
                    value={config.pieSlice?.explodedIndices?.[0] ?? ''}
                    onChange={handleExplodedIndexChange}
                    placeholder="Slice index (0-based)"
                    min={0}
                  />
                  <span className="text-hint text-ss-text-secondary mt-1 block">
                    Enter the index of the slice to explode (pull out)
                  </span>
                </div>

                <div className="mb-4">
                  <SectionLabel size="md" uppercase className="mb-2">
                    Explode Distance
                  </SectionLabel>
                  <input
                    type="range"
                    min={0}
                    max={0.3}
                    step={0.01}
                    value={config.pieSlice?.explodeOffset ?? 0.1}
                    onChange={handleExplodeOffsetChange}
                    className="w-full"
                  />
                  <span className="text-hint text-ss-text-secondary">
                    {((config.pieSlice?.explodeOffset ?? 0.1) * 100).toFixed(0)}%
                  </span>
                </div>
              </>
            )}

            {/* Scatter specific options */}
            {(config.type === 'scatter' || config.type === 'bubble') && (
              <>
                <div className="mb-4">
                  <Checkbox
                    checked={config.trendline?.show || false}
                    onChange={handleTrendlineShowChange}
                    label="Show trendline"
                  />
                </div>

                {config.trendline?.show && (
                  <>
                    <div className="mb-4">
                      <SectionLabel size="md" uppercase className="mb-2">
                        Trendline Type
                      </SectionLabel>
                      <Select
                        value={config.trendline?.type || 'linear'}
                        onChange={handleTrendlineTypeChange}
                        options={TRENDLINE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                      />
                    </div>

                    <div className="mb-4">
                      <Checkbox
                        checked={config.trendline?.showR2 || false}
                        onChange={handleTrendlineR2Change}
                        label="Show R² value"
                      />
                    </div>
                  </>
                )}
              </>
            )}

            {/* Message for other chart types */}
            {config.type !== 'pie' &&
              config.type !== 'doughnut' &&
              config.type !== 'scatter' &&
              config.type !== 'bubble' && (
                <div className="text-ss-text-secondary text-body-sm text-center p-5">
                  Advanced options are available for Pie, Doughnut, Scatter, and Bubble charts.
                </div>
              )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-between px-4 py-3 border-t border-ss-border bg-ss-surface-secondary">
        <Button variant="ghost" onClick={onDelete} className="text-ss-error hover:bg-ss-error-bg">
          Delete
        </Button>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
