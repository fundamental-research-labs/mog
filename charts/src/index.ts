/**
 * @mog/charts - Charting library for the spreadsheet engine
 *
 * Provides Excel-compatible charts with custom rendering engine
 * and reactive data binding.
 *
 * Architecture:
 * - Grammar: Vega-Lite compatible spec system
 * - Components: Fluent API chart builders
 * - Primitives: Low-level marks, scales, and rendering
 *
 * Import guidelines:
 * - Use '@mog/charts' for commonly-used types and functions
 * - Use '@mog/charts/primitives' for scales, renderers, hit testing
 * - Use '@mog/charts/grammar' for spec compiler, layout, encoding, transforms
 * - Use '@mog/charts/export' for OOXML export
 * - Use '@mog/charts/interaction' for pick, tooltip, brush, zoom
 * - Use '@mog/charts/math' for statistics, regression, geometry
 * - Use '@mog/charts/utils' for chart color and OOXML theme color utilities
 */

// Types - chart config, serialization, and data types
export {
  DEFAULT_CHART_COLORS,
  DEFAULT_CHART_CONFIG,
  type AreaSubType,
  type AxisConfig,
  type AxisType,
  type BarSubType,
  type Chart,
  type ChartAnchorMode,
  type ChartConfig,
  type ChartCreateOptions,
  type ChartData,
  type ChartCategoryLevelData,
  type ChartDataPoint,
  type ChartDataSeries,
  type BoxplotConfig,
  type HeatmapConfig,
  type HierarchyChartConfig,
  type HierarchyChartRow,
  type HistogramConfig,
  type ChartLegendEntryIndexKind,
  type ChartLegendEntryVocabulary,
  type ChartSemanticLayer,
  type ChartStyleContext,
  type ChartStyleDiagnostic,
  type ChartStyleOwner,
  type ChartInstance,
  type ChartSeriesCategoryLevelCache,
  type ChartSeriesCategoryLevelsCache,
  type ChartSeriesProjectionAuthority,
  type ChartSeriesProjectionDiagnostic,
  type ChartSeriesProjectionDiagnosticReason,
  type ChartSeriesStockRole,
  type ChartSeriesPointCache,
  type ChartSeriesPointCachePoint,
  type ChartSeriesXRole,
  type ChartType,
  type ChartWorkbookThemeData,
  type CreateChartInput,
  type DataLabelConfig,
  type ImageExportFormat,
  type ImageExportOptions,
  type LegendConfig,
  type LegendPosition,
  type LineSubType,
  type PieSliceConfig,
  type PivotChartProjectionData,
  type RadarSubType,
  type ResolvedChartLegendEntrySnapshot,
  type ResolvedChartProjectedRoleMappingSnapshot,
  type ResolvedChartSourceSeriesSnapshot,
  type SerializedChart,
  type SeriesConfig,
  type SeriesOrientation,
  type SingleAxisConfig,
  type SunburstConfig,
  type StockSubType,
  type TreemapConfig,
  type StoredChartConfig,
  type SubTypeFor,
  type TrendlineConfig,
  type TrendlineType,
  type TypedChartConfig,
  type RegionMapConfig,
  type ViolinConfig,
  type WaterfallConfig,
} from './types';

// Core - pure computation functions
export {
  ObjectCellAccessor,
  HIDDEN_CHART_CELL,
  chartDataSeriesIdentity,
  chartDataToRows,
  chartImportSourceDialect,
  buildExcelCartesianGeometryPlan,
  collectMarks,
  configToSpec,
  detectSeriesOrientation,
  effectiveBarGeometry,
  effectiveBarGeometryFromSpec,
  effectiveGapWidth,
  effectiveOverlap,
  excelBarSlotGeometry,
  extractChartData,
  extractChartDataFromRange,
  hasStockRoleSeries,
  hasStockSubtype,
  hasExcelBarGeometryConfig,
  hasExcelBarGeometrySpec,
  isHiddenChartCellValue,
  isBarLikeChartType,
  isImportedStandardOoxmlChart,
  barBaselinePixelForDomain,
  barBaselineValueForDomain,
  parseRange,
  resolveBarGeometryGroups,
  rustToTsChartType,
  stackModeForChartType,
  seriesConfigForDataSeries,
  seriesConfigSourceIndex,
  seriesConfigSourceKey,
  seriesOrderForDataSeries,
  seriesSourceIndex,
  seriesSourceKey,
  shouldProjectStockSeries,
  shouldRenderStockChart,
  stockRolePlan,
  withSeriesConfigIdentity,
  tsToRustChartType,
  asStockConfig,
  type BarGeometryGroup,
  type BarSlotGeometry,
  type CellDataAccessor,
  type CellRange,
  type ChartCellValue,
  type ExcelCartesianGeometryPlan,
  type RustBarDirection,
  type RustChartType,
  type RustChartTypeResult,
  type ResolveBarGeometryGroupsOptions,
  type StockRole,
  type StockRolePlan,
} from './core';

// DOM - chart engine and instance management (requires browser environment)
export { ChartEngine, createChart, createChartEngine } from './dom';

// Primitives - commonly-used mark types and rendering
// For scales, color schemes, renderers, hit testing: import from '@mog/charts/primitives'
export {
  createPieArcs,
  hitTestArc,
  renderMark,
  renderMarks,
  type AnyMark,
  type ArcMark,
  type Mark,
  type MarkStyle,
  type PathMark,
  type PaintSpec,
  type RectMark,
  type ShadowSpec,
  type SymbolMark,
  type SymbolShape,
  type TextAlign,
  type TextBaseline,
  type TextMark,
  type TextRunSpec,
} from './primitives';

// Utils - common color helpers; chart theme/color resolvers live in '@mog/charts/utils'
export { darkenColor, generateGradient, getDefaultColor, lightenColor, withOpacity } from './utils';

// Grammar - Vega-Lite compatible spec types and compiler
export {
  // Transform type guards
  isAggregateTransform,
  isBinTransform,
  isCalculateTransform,
  isDensityTransform,
  isFilterTransform,
  isFoldTransform,
  // Spec type guards
  isLayerSpec,
  isRegressionTransform,
  isSortTransform,
  isUnitSpec,
  type AxisSpec,
  type BaseSpec,
  type ChannelSpec,
  // Core types
  type ChartSpec,
  type ConfigSpec,
  type DataRow,
  type DataSource,
  type EncodingSpec,
  type FieldType,
  type LayerSpec,
  type Layout,
  type LegendSpec,
  type MarkSpec,
  type MarkType,
  type ScaleSpec,
  type Transform,
  type TransformType,
  type UnitSpec,
} from './grammar/spec';

// Grammar compiler - converts spec + data to renderable marks
export { compile, type CompileOptions, type CompileResult } from './grammar/compiler';

// Components - Fluent API chart builders
export {
  // Area Chart
  AreaChart,
  AreaChartBuilder,
  // Bar Chart
  BarChart,
  BarChartBuilder,
  BarLineCombo,
  // Base
  BaseChartBuilder,
  BubbleChart,
  ColumnChart,
  // Combo Chart
  ComboChart,
  ComboChartBuilder,
  DonutChart,
  DoughnutChart,
  HorizontalBarChart,
  // Line Chart
  LineChart,
  LineChartBuilder,
  // Pie Chart
  PieChart,
  PieChartBuilder,
  // Scatter Chart
  ScatterChart,
  ScatterChartBuilder,
  ScatterWithTrendline,
  SmoothLineChart,
  StackedAreaChart,
  StepChart,
  StreamGraph,
  flattenAxisMarks,
  flattenLegendMarks,
  // Axis/Legend
  generateAxis,
  generateLegend,
  type ChartBuilder,
} from './components';
