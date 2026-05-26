/**
 * OOXML Export Module - All XML generators for Excel chart export.
 *
 * This module provides pure functions to convert ChartSpec to Excel-compatible
 * OOXML chart XML.
 */

// Style utilities
export {
  DEFAULT_FONT,
  escapeXml,
  generateChartSpaceStyleXML,
  generateDataLabelsXML,
  generateLineXML,
  generateMarkerSpPrXML,
  generateMarkerXML,
  generateNoFillXML,
  generatePlotAreaStyleXML,
  generateRichTextXML,
  generateShapePropertiesXML,
  generateSimpleLineXML,
  generateSolidFillXML,
  generateSrgbColorXML,
  generateTextPropertiesXML,
  generateThemeColorXML,
  generateTitleXML,
  getDefaultColor,
  type MarkerSymbol,
} from './style-xml';

// Axis generation
export {
  AXIS_IDS,
  generateCategoryAxisXML,
  generateDateAxisXML,
  generateScatterAxesXML,
  generateSeriesAxisXML,
  generateStandardAxesXML,
  generateValueAxisXML,
} from './axis-xml';

// Legend generation
export {
  generateLegendEntryXML,
  generateLegendFromPositionXML,
  generateLegendXML,
  getDefaultLegendPosition,
  shouldShowLegend,
} from './legend-xml';

// Chart wrapper
export {
  CHART_NAMESPACES,
  extractChartTitle,
  generateDrawingRelationshipXML,
  generateTwoCellAnchorXML,
  wrapChartXML,
  wrapChartXMLFromSpec,
  wrapChartXMLNoAxes,
} from './chart-xml';

// Bar chart
export { generateBarChartXML, generateBoxWhiskerChartXML } from './bar-chart-xml';

// Line chart
export { generateLineChartXML, generateStockChartXML } from './line-chart-xml';

// Pie chart
export {
  generateDoughnutChartXML,
  generateExplodedPieChartXML,
  generatePieChartXML,
} from './pie-chart-xml';

// Scatter chart
export { generateBubbleChartXML, generateScatterChartXML } from './scatter-chart-xml';

// Area chart
export { generateAreaChartXML, generateRadarChartXML } from './area-chart-xml';

// Shared series XML generation
export {
  generateCategoryValueSeriesXML,
  generateTrendlineXML,
  opacityToOOXMLAlpha,
  sanitizeNumericValue,
  type CategoryValueSeriesXMLOptions,
} from './shared-xml';

// Re-export quoteSheetName from its canonical location
export { quoteSheetName } from '@mog/spreadsheet-utils';

// Image fallback
export {
  ImageFallbackError,
  generateImageContentTypeXML,
  generateImageEmbedXML,
  generateImageFallback,
  generateImageRelationshipXML,
  getExcelChartType,
  getImageFallbackReason,
  shouldUseImageFallback,
} from './image-fallback';
