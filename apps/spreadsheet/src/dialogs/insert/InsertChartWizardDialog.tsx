/**
 * Insert Chart Wizard Dialog
 *
 * Multi-step wizard for creating charts with full configuration options.
 * Provides more control than the quick-insert from toolbar dropdowns.
 *
 * Steps:
 * 1. Chart Type Selection - Browse all chart types and variants
 * 2. Data Configuration - Set data range, series orientation, header options
 * 3. Chart Options - Title, legend, axes, data labels
 *
 */

import { useCallback, useMemo } from 'react';
import { CollapsibleRangeInput, dispatch, useUIStore } from '../../internal-api';

import type { ChartData, ChartType, StoredChartConfig } from '@mog/charts';

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  Label,
  Select,
} from '@mog/shell';
import {
  CHART_CATEGORIES,
  type ChartCategory,
  type ChartVariant,
} from '../../components/charts/chart-variants';
import { ChartPreview, generateSampleData } from '../../components/charts/ChartPreview';
import { ChartVariantThumbnail } from '../../components/charts/ChartVariantThumbnail';
import { normalizeStoredChartConfig } from '../../adapters/charts/chart-config-adapter';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useRangeSelectionEnterGuard } from '../../hooks/dialogs/use-range-selection-enter-guard';
import type { ChartWizardStep } from '../../ui-store/slices/dialogs/insert-chart-wizard-dialog';

// =============================================================================
// Constants
// =============================================================================

const STEP_TITLES: Record<ChartWizardStep, string> = {
  type: 'Select Chart Type',
  data: 'Configure Data',
  options: 'Chart Options',
  preview: 'Preview',
};

const LEGEND_POSITION_OPTIONS = [
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

// =============================================================================
// Step Components
// =============================================================================

interface StepTypeSelectionProps {
  selectedVariantId: string | null;
  onSelectVariant: (type: ChartType, variantId: string) => void;
}

function StepTypeSelection({ selectedVariantId, onSelectVariant }: StepTypeSelectionProps) {
  return (
    <div className="space-y-4">
      <p className="text-body text-ss-text-secondary">
        Choose a chart type that best represents your data.
      </p>

      {CHART_CATEGORIES.map((category: ChartCategory) => (
        <div key={category.id} className="space-y-2">
          <Label className="text-label font-medium">{category.label}</Label>
          <p className="text-body-sm text-ss-text-tertiary">{category.description}</p>
          <div className="grid grid-cols-4 gap-2">
            {category.variants.map((variant: ChartVariant) => (
              <button
                key={variant.id}
                type="button"
                onClick={() => onSelectVariant(variant.type, variant.id)}
                className={`
 flex flex-col items-center p-2 rounded border transition-colors
 ${
   selectedVariantId === variant.id
     ? 'border-ss-primary bg-ss-primary/5'
     : 'border-ss-border hover:border-ss-primary/50 hover:bg-ss-surface-hover'
 }
 `}
                title={variant.description}
              >
                <ChartVariantThumbnail variantId={variant.id} size={48} />
                <span className="mt-1 text-body-sm text-ss-text truncate w-full text-center">
                  {variant.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface StepDataConfigurationProps {
  dataRange: string;
  seriesInRows: boolean;
  hasHeaderRow: boolean;
  hasLabelColumn: boolean;
  onDataRangeChange: (value: string) => void;
  onSeriesInRowsChange: (value: boolean) => void;
  onHasHeaderRowChange: (value: boolean) => void;
  onHasLabelColumnChange: (value: boolean) => void;
}

function StepDataConfiguration({
  dataRange,
  seriesInRows,
  hasHeaderRow,
  hasLabelColumn,
  onDataRangeChange,
  onSeriesInRowsChange,
  onHasHeaderRowChange,
  onHasLabelColumnChange,
}: StepDataConfigurationProps) {
  return (
    <div className="space-y-4">
      <p className="text-body text-ss-text-secondary">Configure how your data is organized.</p>

      {/* Data Range */}
      <FormField label="Data Range" required>
        <CollapsibleRangeInput
          value={dataRange}
          onChange={onDataRangeChange}
          dialogId="insert-chart-wizard-dialog"
          inputId="data-range"
          placeholder="$A$1:$D$10"
          label="Data Range"
        />
      </FormField>

      {/* Series orientation */}
      <FormField label="Data series in">
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="series-orientation"
              checked={!seriesInRows}
              onChange={() => onSeriesInRowsChange(false)}
              className="text-ss-primary"
            />
            <span className="text-body">Columns</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="series-orientation"
              checked={seriesInRows}
              onChange={() => onSeriesInRowsChange(true)}
              className="text-ss-primary"
            />
            <span className="text-body">Rows</span>
          </label>
        </div>
      </FormField>

      {/* Header options */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="has-header-row"
            checked={hasHeaderRow}
            onChange={(checked) => onHasHeaderRowChange(checked)}
          />
          <Label htmlFor="has-header-row">First row contains series names</Label>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="has-label-column"
            checked={hasLabelColumn}
            onChange={(checked) => onHasLabelColumnChange(checked)}
          />
          <Label htmlFor="has-label-column">First column contains category labels</Label>
        </div>
      </div>

      {/* Switch Row/Column button */}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          onSeriesInRowsChange(!seriesInRows);
          // Swap header/label settings
          const tempHeader = hasHeaderRow;
          onHasHeaderRowChange(hasLabelColumn);
          onHasLabelColumnChange(tempHeader);
        }}
      >
        Switch Row/Column
      </Button>
    </div>
  );
}

interface StepChartOptionsProps {
  title: string;
  xAxisTitle: string;
  yAxisTitle: string;
  showLegend: boolean;
  legendPosition: 'top' | 'bottom' | 'left' | 'right';
  showDataLabels: boolean;
  showXGridlines: boolean;
  showYGridlines: boolean;
  onTitleChange: (value: string) => void;
  onXAxisTitleChange: (value: string) => void;
  onYAxisTitleChange: (value: string) => void;
  onShowLegendChange: (value: boolean) => void;
  onLegendPositionChange: (value: 'top' | 'bottom' | 'left' | 'right') => void;
  onShowDataLabelsChange: (value: boolean) => void;
  onXGridlinesChange: (value: boolean) => void;
  onYGridlinesChange: (value: boolean) => void;
}

function StepChartOptions({
  title,
  xAxisTitle,
  yAxisTitle,
  showLegend,
  legendPosition,
  showDataLabels,
  showXGridlines,
  showYGridlines,
  onTitleChange,
  onXAxisTitleChange,
  onYAxisTitleChange,
  onShowLegendChange,
  onLegendPositionChange,
  onShowDataLabelsChange,
  onXGridlinesChange,
  onYGridlinesChange,
}: StepChartOptionsProps) {
  return (
    <div className="space-y-4">
      <p className="text-body text-ss-text-secondary">Customize the appearance of your chart.</p>

      {/* Chart Title */}
      <FormField label="Chart Title">
        <Input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Enter chart title"
        />
      </FormField>

      {/* Axis Titles */}
      <div className="grid grid-cols-2 gap-4">
        <FormField label="X-Axis Title">
          <Input
            value={xAxisTitle}
            onChange={(e) => onXAxisTitleChange(e.target.value)}
            placeholder="X-axis label"
          />
        </FormField>
        <FormField label="Y-Axis Title">
          <Input
            value={yAxisTitle}
            onChange={(e) => onYAxisTitleChange(e.target.value)}
            placeholder="Y-axis label"
          />
        </FormField>
      </div>

      {/* Legend */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="show-legend"
            checked={showLegend}
            onChange={(checked) => onShowLegendChange(checked)}
          />
          <Label htmlFor="show-legend">Show Legend</Label>
        </div>

        {showLegend && (
          <FormField label="Legend Position">
            <Select
              options={LEGEND_POSITION_OPTIONS}
              value={legendPosition}
              onChange={(value) =>
                onLegendPositionChange(value as 'top' | 'bottom' | 'left' | 'right')
              }
            />
          </FormField>
        )}
      </div>

      {/* Data Labels */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="show-data-labels"
          checked={showDataLabels}
          onChange={(checked) => onShowDataLabelsChange(checked)}
        />
        <Label htmlFor="show-data-labels">Show Data Labels</Label>
      </div>

      {/* Gridlines */}
      <div className="space-y-2">
        <Label className="text-label font-medium">Gridlines</Label>
        <div className="flex gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="show-x-gridlines"
              checked={showXGridlines}
              onChange={(checked) => onXGridlinesChange(checked)}
            />
            <Label htmlFor="show-x-gridlines">X-Axis</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="show-y-gridlines"
              checked={showYGridlines}
              onChange={(checked) => onYGridlinesChange(checked)}
            />
            <Label htmlFor="show-y-gridlines">Y-Axis</Label>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function InsertChartWizardDialog() {
  const deps = useActionDependencies();

  // UI Store state
  const wizardDialog = useUIStore((s) => s.insertChartWizardDialog);
  const setChartWizardStep = useUIStore((s) => s.setChartWizardStep);
  const setChartWizardType = useUIStore((s) => s.setChartWizardType);
  const setChartWizardDataRange = useUIStore((s) => s.setChartWizardDataRange);
  const setChartWizardSeriesInRows = useUIStore((s) => s.setChartWizardSeriesInRows);
  const setChartWizardHasHeaderRow = useUIStore((s) => s.setChartWizardHasHeaderRow);
  const setChartWizardHasLabelColumn = useUIStore((s) => s.setChartWizardHasLabelColumn);
  const setChartWizardTitle = useUIStore((s) => s.setChartWizardTitle);
  const setChartWizardXAxis = useUIStore((s) => s.setChartWizardXAxis);
  const setChartWizardYAxis = useUIStore((s) => s.setChartWizardYAxis);
  const setChartWizardLegend = useUIStore((s) => s.setChartWizardLegend);
  const setChartWizardShowDataLabels = useUIStore((s) => s.setChartWizardShowDataLabels);

  const {
    isOpen,
    step,
    chartType,
    variantId,
    dataRange,
    seriesInRows,
    hasHeaderRow,
    hasLabelColumn,
    title,
    xAxis,
    yAxis,
    legend,
    showDataLabels,
    error,
  } = wizardDialog;

  // Build chart config for preview
  const previewConfig: StoredChartConfig | null = useMemo(() => {
    if (!chartType || !variantId) return null;

    return normalizeStoredChartConfig({
      id: 'preview-chart',
      type: chartType,
      // Required position fields (not used for preview but needed by type)
      anchorRow: 0,
      anchorCol: 0,
      width: 480,
      height: 225,
      dataRange: dataRange || 'A1:D10',
      // Display options
      title: title || undefined,
      axis: {
        xAxis: {
          type: 'category',
          title: xAxis.title || undefined,
          gridLines: xAxis.showGridlines,
        },
        yAxis: {
          type: 'value',
          title: yAxis.title || undefined,
          gridLines: yAxis.showGridlines,
        },
      },
      legend: legend.show
        ? {
            show: true,
            position: legend.position,
          }
        : { show: false, position: 'bottom' },
      dataLabels: showDataLabels ? { show: true } : { show: false },
    });
  }, [chartType, variantId, title, xAxis, yAxis, legend, showDataLabels, dataRange]);

  // Generate preview data (sample data until real data is available)
  const previewData: ChartData = useMemo(() => {
    // Use sample data for preview
    return generateSampleData(chartType || 'column');
  }, [chartType]);

  // Step order for navigation
  const stepOrder: ChartWizardStep[] = ['type', 'data', 'options'];
  const currentStepIndex = stepOrder.indexOf(step);

  // Navigation handlers
  const handleBack = useCallback(() => {
    if (currentStepIndex > 0) {
      setChartWizardStep(stepOrder[currentStepIndex - 1]);
    }
  }, [currentStepIndex, setChartWizardStep, stepOrder]);

  const handleNext = useCallback(() => {
    if (currentStepIndex < stepOrder.length - 1) {
      setChartWizardStep(stepOrder[currentStepIndex + 1]);
    }
  }, [currentStepIndex, setChartWizardStep, stepOrder]);

  // Validate current step
  const isStepValid = useMemo(() => {
    switch (step) {
      case 'type':
        return chartType !== null && variantId !== null;
      case 'data':
        return dataRange.trim().length > 0;
      case 'options':
        return true; // Options are optional
      default:
        return true;
    }
  }, [step, chartType, variantId, dataRange]);

  // Handle chart type selection
  const handleSelectVariant = useCallback(
    (type: ChartType, variant: string) => {
      setChartWizardType(type, variant);
    },
    [setChartWizardType],
  );

  // Handle finish - insert the chart
  const handleFinish = useCallback(() => {
    dispatch('INSERT_CHART_FROM_WIZARD', deps);
  }, [deps]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    dispatch('CLOSE_INSERT_CHART_WIZARD_DIALOG', deps);
  }, [deps]);

  // Handle close
  const handleClose = useCallback(() => {
    dispatch('CLOSE_INSERT_CHART_WIZARD_DIALOG', deps);
  }, [deps]);

  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === stepOrder.length - 1;

  // Determine if we should show preview (steps 2 and 3 with chart type selected)
  const showPreview = step !== 'type' && previewConfig !== null;

  const primaryAction = isStepValid ? (isLastStep ? handleFinish : handleNext) : undefined;
  const guardedEnter = useRangeSelectionEnterGuard(primaryAction);

  // Don't render if not open
  if (!isOpen) return null;

  return (
    <Dialog
      onEnterKeyDown={guardedEnter}
      open={isOpen}
      onClose={handleClose}
      dialogId="insert-chart-wizard-dialog"
      width={showPreview ? 900 : 640}
    >
      <DialogHeader onClose={handleClose}>
        Insert Chart - {STEP_TITLES[step as ChartWizardStep]}
      </DialogHeader>

      <DialogBody>
        <div className="min-h-[400px]">
          {/* Error message */}
          {error && (
            <div className="mb-4 bg-ss-error-bg border border-ss-error rounded-ss-md p-3 text-ss-error-text text-body-sm">
              {error}
            </div>
          )}

          {/* Step progress indicator */}
          <div className="mb-4 flex items-center gap-2">
            {stepOrder.map((s, index) => (
              <div key={s} className="flex items-center">
                <div
                  className={`
 w-8 h-8 rounded-full flex items-center justify-center text-body-sm font-medium
 ${
   index <= currentStepIndex
     ? 'bg-ss-primary text-ss-text-inverse'
     : 'bg-ss-surface-secondary text-ss-text-tertiary'
 }
 `}
                >
                  {index + 1}
                </div>
                {index < stepOrder.length - 1 && (
                  <div
                    className={`w-8 h-0.5 ${index < currentStepIndex ? 'bg-ss-primary' : 'bg-ss-surface-tertiary'}`}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Step content with optional preview panel */}
          <div className={showPreview ? 'flex gap-6' : ''}>
            {/* Step content */}
            <div className={showPreview ? 'flex-1 min-w-0' : ''}>
              {step === 'type' && (
                <StepTypeSelection
                  selectedVariantId={variantId}
                  onSelectVariant={handleSelectVariant}
                />
              )}

              {step === 'data' && (
                <StepDataConfiguration
                  dataRange={dataRange}
                  seriesInRows={seriesInRows}
                  hasHeaderRow={hasHeaderRow}
                  hasLabelColumn={hasLabelColumn}
                  onDataRangeChange={setChartWizardDataRange}
                  onSeriesInRowsChange={setChartWizardSeriesInRows}
                  onHasHeaderRowChange={setChartWizardHasHeaderRow}
                  onHasLabelColumnChange={setChartWizardHasLabelColumn}
                />
              )}

              {step === 'options' && (
                <StepChartOptions
                  title={title}
                  xAxisTitle={xAxis.title}
                  yAxisTitle={yAxis.title}
                  showLegend={legend.show}
                  legendPosition={legend.position}
                  showDataLabels={showDataLabels}
                  showXGridlines={xAxis.showGridlines}
                  showYGridlines={yAxis.showGridlines}
                  onTitleChange={setChartWizardTitle}
                  onXAxisTitleChange={(value) => setChartWizardXAxis({ title: value })}
                  onYAxisTitleChange={(value) => setChartWizardYAxis({ title: value })}
                  onShowLegendChange={(value) => setChartWizardLegend({ show: value })}
                  onLegendPositionChange={(value) => setChartWizardLegend({ position: value })}
                  onShowDataLabelsChange={setChartWizardShowDataLabels}
                  onXGridlinesChange={(value) => setChartWizardXAxis({ showGridlines: value })}
                  onYGridlinesChange={(value) => setChartWizardYAxis({ showGridlines: value })}
                />
              )}
            </div>

            {/* Live Preview Panel */}
            {showPreview && previewConfig && (
              <div className="w-[320px] shrink-0">
                <Label className="text-label font-medium mb-2 block">Live Preview</Label>
                <ChartPreview
                  config={previewConfig}
                  data={previewData}
                  height={280}
                  className="shadow-ss-sm"
                />
                <p className="mt-2 text-body-sm text-ss-text-tertiary">
                  Preview uses sample data. Your actual data will be used when you finish.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <div className="flex gap-2">
          {!isFirstStep && (
            <Button variant="secondary" onClick={handleBack}>
              Back
            </Button>
          )}
          {isLastStep ? (
            <Button variant="primary" onClick={handleFinish} disabled={!isStepValid}>
              Finish
            </Button>
          ) : (
            <Button variant="primary" onClick={handleNext} disabled={!isStepValid}>
              Next
            </Button>
          )}
        </div>
      </DialogFooter>
    </Dialog>
  );
}
