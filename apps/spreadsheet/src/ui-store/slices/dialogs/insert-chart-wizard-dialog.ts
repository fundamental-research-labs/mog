/**
 * Insert Chart Wizard Dialog Slice
 *
 * Manages state for the multi-step Insert Chart wizard dialog.
 * Provides a wizard flow for selecting chart type, configuring data range,
 * and customizing chart options before insertion.
 *
 * Excel Parity: Insert Chart Wizard Dialog
 */

import type { StateCreator } from 'zustand';

import type { ChartType } from '@mog/charts';

// =============================================================================
// Types
// =============================================================================

/**
 * Wizard steps for the Insert Chart dialog
 */
export type ChartWizardStep = 'type' | 'data' | 'options' | 'preview';

/**
 * Chart axis configuration
 */
export interface ChartAxisConfig {
  /** Title for the axis */
  title: string;
  /** Minimum value (auto if not set) */
  min?: number;
  /** Maximum value (auto if not set) */
  max?: number;
  /** Show gridlines */
  showGridlines: boolean;
}

/**
 * Chart legend configuration
 */
export interface ChartLegendConfig {
  /** Show legend */
  show: boolean;
  /** Position: top, bottom, left, right */
  position: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * Insert Chart Wizard dialog state
 */
export interface InsertChartWizardDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Current wizard step */
  step: ChartWizardStep;
  /** Selected chart type (e.g., 'column', 'line', 'pie') */
  chartType: ChartType | null;
  /** Selected chart variant ID (e.g., 'column-clustered') */
  variantId: string | null;
  /** Data range in A1 notation */
  dataRange: string;
  /** Whether data series are in rows (vs columns) */
  seriesInRows: boolean;
  /** Whether first row contains labels */
  hasHeaderRow: boolean;
  /** Whether first column contains labels */
  hasLabelColumn: boolean;
  /** Chart title */
  title: string;
  /** X-axis configuration */
  xAxis: ChartAxisConfig;
  /** Y-axis configuration */
  yAxis: ChartAxisConfig;
  /** Legend configuration */
  legend: ChartLegendConfig;
  /** Show data labels on chart */
  showDataLabels: boolean;
  /** Error message to display */
  error: string | null;
}

export interface InsertChartWizardDialogSlice {
  insertChartWizardDialog: InsertChartWizardDialogState;
  openInsertChartWizardDialog: (initialDataRange?: string) => void;
  closeInsertChartWizardDialog: () => void;
  setChartWizardStep: (step: ChartWizardStep) => void;
  setChartWizardType: (chartType: ChartType, variantId: string) => void;
  setChartWizardDataRange: (dataRange: string) => void;
  setChartWizardSeriesInRows: (seriesInRows: boolean) => void;
  setChartWizardHasHeaderRow: (hasHeaderRow: boolean) => void;
  setChartWizardHasLabelColumn: (hasLabelColumn: boolean) => void;
  setChartWizardTitle: (title: string) => void;
  setChartWizardXAxis: (config: Partial<ChartAxisConfig>) => void;
  setChartWizardYAxis: (config: Partial<ChartAxisConfig>) => void;
  setChartWizardLegend: (config: Partial<ChartLegendConfig>) => void;
  setChartWizardShowDataLabels: (showDataLabels: boolean) => void;
  setChartWizardError: (error: string | null) => void;
  resetChartWizardDialog: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const defaultAxisConfig: ChartAxisConfig = {
  title: '',
  showGridlines: true,
};

const defaultLegendConfig: ChartLegendConfig = {
  show: true,
  position: 'right',
};

const initialState: InsertChartWizardDialogState = {
  isOpen: false,
  step: 'type',
  chartType: null,
  variantId: null,
  dataRange: '',
  seriesInRows: false,
  hasHeaderRow: true,
  hasLabelColumn: true,
  title: '',
  xAxis: { ...defaultAxisConfig },
  yAxis: { ...defaultAxisConfig },
  legend: { ...defaultLegendConfig },
  showDataLabels: false,
  error: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createInsertChartWizardDialogSlice: StateCreator<
  InsertChartWizardDialogSlice,
  [],
  [],
  InsertChartWizardDialogSlice
> = (set) => ({
  insertChartWizardDialog: initialState,

  openInsertChartWizardDialog: (initialDataRange) => {
    set({
      insertChartWizardDialog: {
        ...initialState,
        isOpen: true,
        dataRange: initialDataRange ?? '',
      },
    });
  },

  closeInsertChartWizardDialog: () => {
    set((state) => ({
      insertChartWizardDialog: {
        ...state.insertChartWizardDialog,
        isOpen: false,
        error: null,
      },
    }));
  },

  setChartWizardStep: (step: ChartWizardStep) => {
    set((state) => ({
      insertChartWizardDialog: {
        ...state.insertChartWizardDialog,
        step,
        error: null,
      },
    }));
  },

  setChartWizardType: (chartType: ChartType, variantId: string) => {
    set((state) => ({
      insertChartWizardDialog: {
        ...state.insertChartWizardDialog,
        chartType,
        variantId,
        error: null,
      },
    }));
  },

  setChartWizardDataRange: (dataRange: string) => {
    set((state) => ({
      insertChartWizardDialog: {
        ...state.insertChartWizardDialog,
        dataRange,
        error: null,
      },
    }));
  },

  setChartWizardSeriesInRows: (seriesInRows: boolean) => {
    set((state) => ({
      insertChartWizardDialog: {
        ...state.insertChartWizardDialog,
        seriesInRows,
      },
    }));
  },

  setChartWizardHasHeaderRow: (hasHeaderRow: boolean) => {
    set((state) => ({
      insertChartWizardDialog: {
        ...state.insertChartWizardDialog,
        hasHeaderRow,
      },
    }));
  },

  setChartWizardHasLabelColumn: (hasLabelColumn: boolean) => {
    set((state) => ({
      insertChartWizardDialog: {
        ...state.insertChartWizardDialog,
        hasLabelColumn,
      },
    }));
  },

  setChartWizardTitle: (title: string) => {
    set((state) => ({
      insertChartWizardDialog: {
        ...state.insertChartWizardDialog,
        title,
      },
    }));
  },

  setChartWizardXAxis: (config: Partial<ChartAxisConfig>) => {
    set((state) => ({
      insertChartWizardDialog: {
        ...state.insertChartWizardDialog,
        xAxis: {
          ...state.insertChartWizardDialog.xAxis,
          ...config,
        },
      },
    }));
  },

  setChartWizardYAxis: (config: Partial<ChartAxisConfig>) => {
    set((state) => ({
      insertChartWizardDialog: {
        ...state.insertChartWizardDialog,
        yAxis: {
          ...state.insertChartWizardDialog.yAxis,
          ...config,
        },
      },
    }));
  },

  setChartWizardLegend: (config: Partial<ChartLegendConfig>) => {
    set((state) => ({
      insertChartWizardDialog: {
        ...state.insertChartWizardDialog,
        legend: {
          ...state.insertChartWizardDialog.legend,
          ...config,
        },
      },
    }));
  },

  setChartWizardShowDataLabels: (showDataLabels: boolean) => {
    set((state) => ({
      insertChartWizardDialog: {
        ...state.insertChartWizardDialog,
        showDataLabels,
      },
    }));
  },

  setChartWizardError: (error: string | null) => {
    set((state) => ({
      insertChartWizardDialog: {
        ...state.insertChartWizardDialog,
        error,
      },
    }));
  },

  resetChartWizardDialog: () => {
    set({
      insertChartWizardDialog: initialState,
    });
  },
});
