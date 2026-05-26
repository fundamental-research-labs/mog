/**
 * Statistical Chart Components
 *
 * Pre-built chart types for statistical visualization:
 * - Box plots (quartiles, whiskers, outliers)
 * - Violin plots (KDE density + box)
 * - Histograms (binned frequency distributions)
 * - Heatmaps (correlation matrices, 2D grids)
 *
 * All components use the grammar compiler and produce Mark[] for rendering.
 */

// Box Plot
export {
  BoxPlot,
  BoxPlotBuilder,
  calculateBoxStats,
  calculateGroupedStats,
  compileBoxPlot,
  generateBoxPlotMarks,
  type BoxPlotConfig,
  type BoxPlotDataRow,
  type BoxPlotEncoding,
  type BoxPlotLayout,
  type BoxPlotScales,
  type BoxPlotSpec,
  type BoxPlotStyles,
  type BoxStats,
} from './boxplot';

// Violin Plot
export {
  ViolinPlot,
  ViolinPlotBuilder,
  calculateGroupedViolinStats,
  calculateViolinStats,
  compileViolinPlot,
  generateViolinPlotMarks,
  type ViolinPlotConfig,
  type ViolinPlotDataRow,
  type ViolinPlotEncoding,
  type ViolinPlotLayout,
  type ViolinPlotScales,
  type ViolinPlotSpec,
  type ViolinPlotStyles,
  type ViolinStats,
} from './violin';

// Histogram
export {
  Histogram,
  HistogramBuilder,
  alignBins,
  calculateHistogramData,
  compileHistogram,
  generateHistogramMarks,
  processHistogramData,
  type BinParams,
  type HistogramConfig,
  type HistogramData,
  type HistogramDataRow,
  type HistogramEncoding,
  type HistogramLayout,
  type HistogramScales,
  type HistogramSpec,
  type HistogramStyles,
} from './histogram';

// Heatmap
export {
  Heatmap,
  HeatmapBuilder,
  calculateDomain,
  compileHeatmap,
  createColorScale,
  createCorrelationMatrix,
  extractCategories,
  generateHeatmapMarks,
  processHeatmapData,
  type ColorScaleSpec,
  type ColorScheme,
  type HeatmapCellData,
  type HeatmapConfig,
  type HeatmapDataRow,
  type HeatmapEncoding,
  type HeatmapLayout,
  type HeatmapScales,
  type HeatmapSpec,
  type HeatmapStyles,
} from './heatmap';
