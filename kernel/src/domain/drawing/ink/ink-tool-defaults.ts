/**
 * Ink Tool Default Constants & Functions
 *
 * Contains runtime const objects for tool defaults that belong in the kernel/ink domain.
 */

import type { InkTool, InkToolSettings } from '@mog-sdk/contracts/ink';

// =============================================================================
// Tool Default Constants
// =============================================================================

/**
 * Default stroke widths for each ink tool (in pixels).
 */
export const TOOL_DEFAULT_WIDTHS: Record<InkTool, number> = {
  pen: 2,
  pencil: 1,
  highlighter: 20,
  marker: 4,
  brush: 8,
  eraser: 20,
} as const;

/**
 * Default opacities for each ink tool [0, 1].
 */
export const TOOL_DEFAULT_OPACITIES: Record<InkTool, number> = {
  pen: 1.0,
  pencil: 0.9,
  highlighter: 0.4,
  marker: 1.0,
  brush: 0.85,
  eraser: 1.0,
} as const;

/**
 * Default colors for each ink tool (CSS color strings).
 */
export const TOOL_DEFAULT_COLORS: Record<InkTool, string> = {
  pen: '#000000',
  pencil: '#4a4a4a',
  highlighter: '#ffff00',
  marker: '#0066cc',
  brush: '#333333',
  eraser: '#ffffff', // Not rendered, but needed for consistency
} as const;

/**
 * Whether each tool supports pressure sensitivity.
 */
export const TOOL_SUPPORTS_PRESSURE: Record<InkTool, boolean> = {
  pen: true,
  pencil: true,
  highlighter: false, // Consistent width
  marker: false, // Consistent width
  brush: true,
  eraser: true,
} as const;

/**
 * Get default settings for a specific ink tool.
 */
export function getDefaultToolSettings(tool: InkTool): InkToolSettings {
  return {
    width: TOOL_DEFAULT_WIDTHS[tool],
    opacity: TOOL_DEFAULT_OPACITIES[tool],
    color: TOOL_DEFAULT_COLORS[tool],
    supportsPressure: TOOL_SUPPORTS_PRESSURE[tool],
  };
}

/**
 * Get default settings for all ink tools.
 */
export function getAllDefaultToolSettings(): Record<InkTool, InkToolSettings> {
  const tools: InkTool[] = ['pen', 'pencil', 'highlighter', 'marker', 'brush', 'eraser'];
  return tools.reduce(
    (acc, tool) => {
      acc[tool] = getDefaultToolSettings(tool);
      return acc;
    },
    {} as Record<InkTool, InkToolSettings>,
  );
}

/**
 * Shape recognition thresholds for each shape type.
 */
export const SHAPE_RECOGNITION_THRESHOLDS = {
  line: 0.05,
  rectangleAngle: Math.PI / 18, // 10 degrees
  rectangleEdge: 0.08,
  ellipse: 0.1,
  triangleAngle: Math.PI / 12, // 15 degrees
  arrowHead: 0.15,
  star: 0.12,
  minStrokeLength: 20,
  minConfidence: 0.7,
  multiStrokeWindow: 500,
} as const;

/**
 * Type for shape recognition thresholds.
 */
export type ShapeRecognitionThresholds = typeof SHAPE_RECOGNITION_THRESHOLDS;
