/**
 * Image Fallback for OOXML Chart Export
 *
 * Handles chart types that have no Excel equivalent by rendering to PNG.
 * Used for: violin plots, density plots, complex layered charts.
 *
 * Pure functions - no side effects.
 */

import { isLayerSpec, type ChartSpec, type DataRow, type MarkType } from '../../grammar/spec';
import type { ExportOptions, ImageFallbackResult } from '../ooxml-types';
import { isNativeStockLayerSpec } from './stock-layer-detection';

// =============================================================================
// Unsupported Chart Types
// =============================================================================

/**
 * Mark types that have no Excel equivalent.
 */
const UNSUPPORTED_MARK_TYPES: MarkType[] = ['violin'];

/**
 * Mark types that may require fallback depending on complexity.
 */
const CONDITIONAL_FALLBACK_TYPES: MarkType[] = ['rect']; // Heatmap may or may not work

// =============================================================================
// Detection Functions
// =============================================================================

/**
 * Check if a ChartSpec requires image fallback for Excel export.
 *
 * @param spec - The ChartSpec to check
 * @returns true if image fallback is needed
 */
export function shouldUseImageFallback(spec: ChartSpec): boolean {
  // Check for complex layered charts (more than 2 layers is risky)
  // This check comes first because layered charts may not have a direct mark
  if (isLayerSpec(spec) && spec.layer.length > 2 && !isNativeStockLayerSpec(spec)) {
    return true;
  }

  const markType = typeof spec.mark === 'string' ? spec.mark : spec.mark?.type;

  // If no mark type and it's a layered chart with <= 2 layers, may be ok
  if (!markType) {
    return false;
  }

  // Check if mark type is unsupported
  if (UNSUPPORTED_MARK_TYPES.includes(markType)) {
    return true;
  }

  // Check for complex transforms that Excel can't represent
  if (spec.transform) {
    for (const transform of spec.transform) {
      // Density estimation has no Excel equivalent
      if ('density' in transform) {
        return true;
      }
      // Complex calculations may not translate
      if ('calculate' in transform && transform.calculate.includes('datum.')) {
        return true;
      }
    }
  }

  // Check for rect mark with color encoding (heatmap)
  if (markType === 'rect' && spec.encoding?.color?.field) {
    // Excel surface charts are limited - use fallback for true heatmaps
    return true;
  }

  return false;
}

/**
 * Get the reason why image fallback is needed.
 *
 * @param spec - The ChartSpec to check
 * @returns Human-readable reason string
 */
export function getImageFallbackReason(spec: ChartSpec): string | null {
  const markType = typeof spec.mark === 'string' ? spec.mark : spec.mark?.type;

  if (!markType) {
    return null;
  }

  if (markType === 'violin') {
    return 'Violin plots have no Excel equivalent';
  }

  if (isLayerSpec(spec) && spec.layer.length > 2 && !isNativeStockLayerSpec(spec)) {
    return 'Complex layered charts cannot be represented in Excel';
  }

  if (spec.transform) {
    for (const transform of spec.transform) {
      if ('density' in transform) {
        return 'Density estimation transforms have no Excel equivalent';
      }
    }
  }

  if (markType === 'rect' && spec.encoding?.color?.field) {
    return 'Color-encoded heatmaps cannot be accurately represented in Excel';
  }

  return null;
}

// =============================================================================
// Image Generation Interface
// =============================================================================

/**
 * Generate image fallback result.
 *
 * Note: This function returns a placeholder result. The actual PNG rendering
 * must be done by the engine/ package which has access to canvas rendering.
 *
 * @param spec - ChartSpec to render
 * @param data - Data rows for the chart
 * @param options - Export options
 */
export function generateImageFallback(
  spec: ChartSpec,
  data: DataRow[],
  options?: ExportOptions,
): ImageFallbackResult {
  const chartId = options?.chartId ?? 1;

  // This is a placeholder - actual rendering requires canvas
  // The engine/ package will call this and handle the actual rendering
  throw new ImageFallbackError(
    `Image fallback required for chart type. ` +
      `Reason: ${getImageFallbackReason(spec) ?? 'Unknown'}. ` +
      `Call renderChartToImage() from engine/ to generate the PNG.`,
    spec,
  );
}

// =============================================================================
// Error Class
// =============================================================================

/**
 * Error thrown when image fallback is needed but cannot be performed.
 */
export class ImageFallbackError extends Error {
  constructor(
    message: string,
    public readonly spec: ChartSpec,
  ) {
    super(message);
    this.name = 'ImageFallbackError';
  }
}

// =============================================================================
// Image Embedding Helpers
// =============================================================================

/**
 * Generate OOXML for an embedded image (used when image fallback is required).
 *
 * @param options - Image embedding options
 */
export function generateImageEmbedXML(options: {
  imageRelId: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
}): string {
  const { imageRelId, width, height, x = 0, y = 0 } = options;

  // Convert dimensions to EMUs (914400 EMUs = 1 inch, assuming 96 DPI)
  const widthEmu = Math.round(width * 9525);
  const heightEmu = Math.round(height * 9525);
  const xEmu = Math.round(x * 9525);
  const yEmu = Math.round(y * 9525);

  return `<xdr:twoCellAnchor editAs="oneCell">
  <xdr:from>
    <xdr:col>0</xdr:col>
    <xdr:colOff>${xEmu}</xdr:colOff>
    <xdr:row>0</xdr:row>
    <xdr:rowOff>${yEmu}</xdr:rowOff>
  </xdr:from>
  <xdr:to>
    <xdr:col>8</xdr:col>
    <xdr:colOff>0</xdr:colOff>
    <xdr:row>15</xdr:row>
    <xdr:rowOff>0</xdr:rowOff>
  </xdr:to>
  <xdr:pic>
    <xdr:nvPicPr>
      <xdr:cNvPr id="2" name="Chart Image"/>
      <xdr:cNvPicPr>
        <a:picLocks noChangeAspect="1"/>
      </xdr:cNvPicPr>
    </xdr:nvPicPr>
    <xdr:blipFill>
      <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${imageRelId}">
        <a:extLst>
          <a:ext uri="{28A0092B-C50C-407E-A947-70E740481C1C}">
            <a14:useLocalDpi xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" val="0"/>
          </a:ext>
        </a:extLst>
      </a:blip>
      <a:stretch>
        <a:fillRect/>
      </a:stretch>
    </xdr:blipFill>
    <xdr:spPr>
      <a:xfrm>
        <a:off x="${xEmu}" y="${yEmu}"/>
        <a:ext cx="${widthEmu}" cy="${heightEmu}"/>
      </a:xfrm>
      <a:prstGeom prst="rect">
        <a:avLst/>
      </a:prstGeom>
    </xdr:spPr>
  </xdr:pic>
  <xdr:clientData/>
</xdr:twoCellAnchor>`;
}

/**
 * Generate content types entry for embedded PNG image.
 */
export function generateImageContentTypeXML(): string {
  return '<Default Extension="png" ContentType="image/png"/>';
}

/**
 * Generate relationship entry for embedded image.
 *
 * @param relId - Relationship ID (e.g., 'rId1')
 * @param imagePath - Path to image within package (e.g., '../media/image1.png')
 */
export function generateImageRelationshipXML(relId: string, imagePath: string): string {
  return `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${imagePath}"/>`;
}

// =============================================================================
// Chart Type Mapping for Fallback Decision
// =============================================================================

/**
 * Get the Excel chart type equivalent for a ChartSpec, or null if no equivalent.
 */
export function getExcelChartType(spec: ChartSpec): string | null {
  const markType = typeof spec.mark === 'string' ? spec.mark : spec.mark?.type;

  switch (markType) {
    case 'bar':
      return 'barChart';
    case 'line':
      return 'lineChart';
    case 'area':
      return 'areaChart';
    case 'arc':
      return spec.mark && typeof spec.mark === 'object' && spec.mark.innerRadius
        ? 'doughnutChart'
        : 'pieChart';
    case 'point':
    case 'circle':
      return spec.encoding?.size?.field ? 'bubbleChart' : 'scatterChart';
    case 'boxplot':
      return 'barChart'; // Box whisker uses extended bar chart format
    case 'rect':
      // Heatmap - no direct equivalent
      return null;
    case 'violin':
      // No equivalent
      return null;
    default:
      return null;
  }
}
