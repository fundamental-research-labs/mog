/**
 * OOXML Chart Export - Main Entry Point
 *
 * Provides the main toOOXML function that converts a ChartSpec to Excel-compatible
 * OOXML chart XML.
 *
 * Usage:
 * ```typescript
 * import { toOOXML } from '@mog/charts/export';
 *
 * const result = toOOXML(spec, data, { chartId: 1 });
 * // result.chartXml contains the xl/charts/chart1.xml content
 * ```
 *
 * Pure functions - no side effects, no framework dependencies.
 */

import type { ChartSpec, DataRow } from '../grammar/spec';
import type { ExportOptions, OOXMLExportResult } from './ooxml-types';

// Import all chart generators
import { generateAreaChartXML, generateRadarChartXML } from './ooxml/area-chart-xml';
import { generateBarChartXML } from './ooxml/bar-chart-xml';
import { ImageFallbackError, shouldUseImageFallback } from './ooxml/image-fallback';
import { generateLineChartXML, generateStockChartXML } from './ooxml/line-chart-xml';
import { generateDoughnutChartXML, generatePieChartXML } from './ooxml/pie-chart-xml';
import { generateBubbleChartXML, generateScatterChartXML } from './ooxml/scatter-chart-xml';
import { isDoughnutRingLayerSpec } from './ooxml/pie-layer-detection';
import { isNativeStockLayerSpec } from './ooxml/stock-layer-detection';

// =============================================================================
// Main Export Function
// =============================================================================

/**
 * Convert a ChartSpec to OOXML (Excel-compatible XML).
 *
 * This is the main entry point for chart export. It determines the chart type
 * and delegates to the appropriate generator.
 *
 * When `options.compileResult` is provided, the export pipeline can leverage
 * the pre-computed scale domains and series structure from the grammar compiler
 * instead of recomputing them from the raw spec and data. This avoids duplicate
 * work when the chart has already been compiled for rendering.
 *
 * @param spec - The ChartSpec to export
 * @param data - Data rows for the chart
 * @param options - Export options (optionally including a pre-computed CompileResult)
 * @returns OOXML export result containing chart XML
 * @throws ImageFallbackError if the chart type requires image fallback
 *
 * @example
 * ```typescript
 * const spec: ChartSpec = {
 *   mark: 'bar',
 *   encoding: {
 *     x: { field: 'category', type: 'nominal' },
 *     y: { field: 'value', type: 'quantitative' }
 *   }
 * };
 *
 * const data = [
 *   { category: 'A', value: 10 },
 *   { category: 'B', value: 20 },
 * ];
 *
 * // Without CompileResult (recomputes from scratch):
 * const result = toOOXML(spec, data, { chartId: 1 });
 *
 * // With CompileResult (reuses pre-computed scales):
 * const compiled = compile(spec, data);
 * const result2 = toOOXML(spec, data, { chartId: 1, compileResult: compiled });
 * ```
 */
export function toOOXML(
  spec: ChartSpec,
  data: DataRow[],
  options?: ExportOptions,
): OOXMLExportResult {
  if (isNativeStockLayerSpec(spec)) {
    return generateStockChartXML(spec, data, options);
  }

  if (isDoughnutRingLayerSpec(spec)) {
    return generateDoughnutChartXML(spec, data, options);
  }

  // Check if image fallback is required
  if (shouldUseImageFallback(spec)) {
    throw new ImageFallbackError(`Chart type requires image fallback for Excel export`, spec);
  }

  // Determine chart type from mark
  const markType = typeof spec.mark === 'string' ? spec.mark : spec.mark?.type;

  if (!markType) {
    throw new Error('ChartSpec must have a mark type');
  }

  // Check for radar chart: line mark with linear-closed interpolation
  if (
    markType === 'radar' ||
    (markType === 'line' &&
      typeof spec.mark === 'object' &&
      spec.mark.interpolate === 'linear-closed')
  ) {
    return generateRadarChartXML(spec, data, options);
  }

  // Delegate to appropriate generator
  switch (markType) {
    case 'bar':
      return generateBarChartXML(spec, data, options);

    case 'line':
      return generateLineChartXML(spec, data, options);

    case 'arc':
      // Check for doughnut (inner radius > 0)
      if (typeof spec.mark === 'object' && spec.mark.innerRadius) {
        return generateDoughnutChartXML(spec, data, options);
      }
      return generatePieChartXML(spec, data, options);

    case 'point':
    case 'circle':
      // Check for bubble chart (has size encoding)
      if (spec.encoding?.size?.field) {
        return generateBubbleChartXML(spec, data, options);
      }
      return generateScatterChartXML(spec, data, options);

    case 'area':
      // Check for filled radar: area with linear-closed interpolation
      if (typeof spec.mark === 'object' && spec.mark.interpolate === 'linear-closed') {
        return generateRadarChartXML(spec, data, options);
      }
      return generateAreaChartXML(spec, data, options);

    case 'rule':
      // Rule marks are used for stock charts (OHLC high-low wicks)
      return generateStockChartXML(spec, data, options);

    case 'boxplot':
      // Box whisker charts use extended chart namespace (cx:) not standard OOXML
      throw new ImageFallbackError(
        'Box whisker charts require extended chart namespace (cx:) - use image fallback',
        spec,
      );

    case 'violin':
      // Violin plots require image fallback
      throw new ImageFallbackError(
        'Violin plots have no Excel equivalent - use image fallback',
        spec,
      );

    case 'rect':
      // Heatmaps may work with surface charts in some cases
      // but for reliability, use image fallback
      throw new ImageFallbackError(
        'Heatmaps (rect marks with color encoding) require image fallback',
        spec,
      );

    default:
      throw new Error(`Unsupported chart type for OOXML export: ${markType}`);
  }
}

// =============================================================================
// Re-exports
// =============================================================================

// Export types
export type {
  CategoryAxisConfig,
  ChartXMLOptions,
  DataLabelConfig,
  DateAxisConfig,
  ExportOptions,
  ImageFallbackResult,
  LegendPosition,
  OOXMLExportResult,
  ScatterSeriesData,
  SeriesData,
  TrendlineConfig,
  ValueAxisConfig,
  XYPoint,
} from './ooxml-types';

// Export OOXML generators
export * from './ooxml';
export {
  ChartImageExportOptionsError,
  normalizeImageExportOptions,
  type NormalizedImageExportOptions,
  type SupportedImageExportFormat,
} from './image-options';

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Check if a ChartSpec can be exported to OOXML natively.
 *
 * @param spec - The ChartSpec to check
 * @returns true if native OOXML export is supported
 */
export function canExportToOOXML(spec: ChartSpec): boolean {
  return !shouldUseImageFallback(spec);
}

/**
 * Get the OOXML chart element name for a ChartSpec.
 *
 * @param spec - The ChartSpec
 * @returns The OOXML element name (e.g., 'barChart', 'lineChart')
 */
export function getOOXMLChartElement(spec: ChartSpec): string | null {
  if (isNativeStockLayerSpec(spec)) {
    return 'stockChart';
  }

  if (isDoughnutRingLayerSpec(spec)) {
    return 'doughnutChart';
  }

  const markType = typeof spec.mark === 'string' ? spec.mark : spec.mark?.type;

  // Check for radar (linear-closed interpolation)
  if (
    markType === 'radar' ||
    ((markType === 'line' || markType === 'area') &&
      typeof spec.mark === 'object' &&
      spec.mark.interpolate === 'linear-closed')
  ) {
    return 'radarChart';
  }

  switch (markType) {
    case 'bar':
      return 'barChart';
    case 'line':
      return 'lineChart';
    case 'arc':
      if (typeof spec.mark === 'object' && spec.mark.innerRadius) {
        return 'doughnutChart';
      }
      return 'pieChart';
    case 'point':
    case 'circle':
      if (spec.encoding?.size?.field) {
        return 'bubbleChart';
      }
      return 'scatterChart';
    case 'area':
      return 'areaChart';
    case 'rule':
      return 'stockChart';
    case 'boxplot':
      return 'barChart'; // Box whisker uses extended bar chart format
    default:
      return null;
  }
}

/**
 * Generate the file path for a chart within an XLSX package.
 *
 * @param chartIndex - The chart index (1-based)
 * @returns The path (e.g., 'xl/charts/chart1.xml')
 */
export function getChartPath(chartIndex: number): string {
  return `xl/charts/chart${chartIndex}.xml`;
}

/**
 * Generate the relationship path for a chart.
 *
 * @param chartIndex - The chart index (1-based)
 * @returns The path (e.g., '../charts/chart1.xml')
 */
export function getChartRelPath(chartIndex: number): string {
  return `../charts/chart${chartIndex}.xml`;
}
