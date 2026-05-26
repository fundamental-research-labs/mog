/**
 * Chart Components - Pre-built chart types using the grammar.
 *
 * Provides fluent API builders for common chart types:
 * - Bar/Column charts (clustered, stacked, percent)
 * - Line charts (straight, smooth, stepped)
 * - Area charts (standard, stacked, streamgraph)
 * - Pie/Doughnut charts
 * - Scatter/Bubble charts
 * - Combo charts (bar + line)
 *
 * Also exports axis and legend generation utilities.
 *
 * Pure TypeScript, no framework dependencies.
 */

// =============================================================================
// Chart Builders
// =============================================================================

// Bar Chart
export { BarChart, BarChartBuilder, ColumnChart, HorizontalBarChart } from './bar-chart';

// Line Chart
export { LineChart, LineChartBuilder, SmoothLineChart, StepChart } from './line-chart';

// Area Chart
export { AreaChart, AreaChartBuilder, StackedAreaChart, StreamGraph } from './area-chart';

// Pie Chart
export { DonutChart, DoughnutChart, PieChart, PieChartBuilder } from './pie-chart';

// Scatter Chart
export {
  BubbleChart,
  ScatterChart,
  ScatterChartBuilder,
  ScatterWithTrendline,
} from './scatter-chart';

// Combo Chart
export { BarLineCombo, ComboChart, ComboChartBuilder } from './combo-chart';

// =============================================================================
// Base Classes and Types
// =============================================================================

export {
  BaseChartBuilder,
  getNumericExtent,
  getUniqueValues,
  inferFieldType,
  type ChartBuilder,
} from './base-chart';

// =============================================================================
// Axis and Legend Components
// =============================================================================

export {
  calculateAxisSpace,
  flattenAxisMarks,
  generateAxis,
  getAxisOrient,
  type AxisMarks,
  type AxisScale,
} from './axis';

export {
  calculateLegendPosition,
  calculateLegendSpace,
  flattenLegendMarks,
  generateGradientLegend,
  generateLegend,
  type LegendEntry,
  type LegendMarks,
  type LegendPosition,
} from './legend';
