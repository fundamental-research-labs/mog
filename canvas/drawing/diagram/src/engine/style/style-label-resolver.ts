/**
 * Diagram Style Label Resolver - Stub Implementation
 *
 * This module resolves OOXML style labels (like "node0", "fgAcc1", etc.)
 * to concrete colors and styles based on ColorsDef and StyleDef.
 *
 * NOTE: This is a stub implementation that returns reasonable defaults.
 * The full implementation requires parsing and interpreting the complete
 * OOXML color/style definition schemas.
 *
 * @module engine/style/style-label-resolver
 */

import type { ColorsDef, StyleDef } from '@mog-sdk/contracts/diagram';

import { darkenColor } from '../../styles/color-themes';

// =============================================================================
// Types
// =============================================================================

/**
 * Base theme colors (Office/Excel standard colors).
 */
export interface ThemeColors {
  dk1: string; // Dark 1 (text/background)
  lt1: string; // Light 1 (text/background)
  dk2: string; // Dark 2 (text/background)
  lt2: string; // Light 2 (text/background)
  accent1: string;
  accent2: string;
  accent3: string;
  accent4: string;
  accent5: string;
  accent6: string;
  hlink: string; // Hyperlink
  folHlink: string; // Followed hyperlink
}

/**
 * Extended theme colors with background fills.
 */
export interface ExtendedThemeColors extends ThemeColors {
  bg1?: string;
  bg2?: string;
  tx1?: string;
  tx2?: string;
}

/** GradientStop — Diagram style layer. Maps to CT_GradientStop (dml-main.xsd:1539) with resolved color string + alpha. */
export interface GradientStop {
  position: number;
  color: string;
  alpha?: number;
}

/**
 * Resolved fill style.
 */
export interface ResolvedFill {
  type: 'solid' | 'gradient' | 'none';
  color?: string;
  alpha?: number;
  gradientStops?: GradientStop[];
  gradientAngle?: number;
}

/**
 * Resolved stroke style.
 */
export interface ResolvedStroke {
  color: string;
  width: number;
  alpha?: number;
}

/**
 * Resolved text style.
 */
export interface ResolvedTextStyle {
  fillColor: string;
  fillAlpha?: number;
  fontFamily?: string;
  fontSize?: number;
}

/**
 * Complete resolved style for a style label.
 */
export interface ResolvedStyleLabel {
  fill: ResolvedFill;
  stroke: ResolvedStroke;
  textStyle: ResolvedTextStyle;
}

/**
 * Options for style label resolution.
 */
export interface ResolveStyleLabelOptions {
  totalNodes?: number;
  themeColors?: ThemeColors | ExtendedThemeColors;
}

// =============================================================================
// Default Theme Colors
// =============================================================================

const DEFAULT_THEME_COLORS: ThemeColors = {
  dk1: '#000000',
  lt1: '#FFFFFF',
  dk2: '#1F497D',
  lt2: '#EEECE1',
  accent1: '#4472C4',
  accent2: '#ED7D31',
  accent3: '#A5A5A5',
  accent4: '#FFC000',
  accent5: '#5B9BD5',
  accent6: '#70AD47',
  hlink: '#0563C1',
  folHlink: '#954F72',
};

// =============================================================================
// Style Label Resolution
// =============================================================================

/**
 * Resolve a style label to concrete colors and styles.
 *
 * Style labels are references in OOXML layout definitions like "node0",
 * "fgAcc1", "bgShp", etc. This function resolves them to actual colors
 * using the ColorsDef and StyleDef.
 *
 * @param styleLabel - The style label to resolve (e.g., "node0", "fgAcc1")
 * @param colorsDef - The colors definition from the Diagram
 * @param styleDef - The style definition from the Diagram
 * @param nodeIndex - The index of the node (for sequential coloring)
 * @param options - Additional options like total nodes and theme colors
 * @returns Resolved style with fill, stroke, and text settings
 */
export function resolveStyleLabel(
  styleLabel: string,
  colorsDef: ColorsDef | undefined,
  styleDef: StyleDef | undefined,
  nodeIndex: number,
  options?: ResolveStyleLabelOptions,
): ResolvedStyleLabel {
  const themeColors = options?.themeColors ?? DEFAULT_THEME_COLORS;
  const totalNodes = options?.totalNodes ?? 1;

  // Default result using accent colors based on node index
  const accentIndex = (nodeIndex % 6) + 1;
  const accentKey = `accent${accentIndex}` as keyof ThemeColors;
  const accentColor = themeColors[accentKey] ?? DEFAULT_THEME_COLORS.accent1;

  // Simple heuristic: parse the style label to determine coloring
  const defaultFill: ResolvedFill = {
    type: 'solid',
    color: accentColor,
    alpha: 1,
  };

  const defaultStroke: ResolvedStroke = {
    color: darkenColor(accentColor, 0.2),
    width: 1,
    alpha: 1,
  };

  const defaultTextStyle: ResolvedTextStyle = {
    fillColor: '#FFFFFF',
    fillAlpha: 1,
    fontFamily: 'Calibri',
    fontSize: 11,
  };

  // Handle special style labels
  if (styleLabel.startsWith('bg')) {
    // Background styles - use light colors
    defaultFill.color = themeColors.lt1;
    defaultTextStyle.fillColor = themeColors.dk1;
  } else if (styleLabel.startsWith('fg')) {
    // Foreground styles - use accent colors
    defaultFill.color = accentColor;
  } else if (styleLabel === 'node0' || styleLabel.match(/^node\d+$/)) {
    // Node styles - cycle through accents
    defaultFill.color = accentColor;
  } else if (styleLabel.includes('Acc')) {
    // Accent styles
    const match = styleLabel.match(/Acc(\d+)/);
    if (match) {
      const accNum = parseInt(match[1], 10);
      const accKey = `accent${((accNum - 1) % 6) + 1}` as keyof ThemeColors;
      defaultFill.color = themeColors[accKey] ?? accentColor;
    }
  }

  return {
    fill: defaultFill,
    stroke: defaultStroke,
    textStyle: defaultTextStyle,
  };
}

/**
 * Convert a color to CSS rgba format with alpha.
 *
 * @param color - Hex color string
 * @param alpha - Alpha value (0-1)
 * @returns CSS rgba string
 */
export function getCssColor(color: string, alpha: number = 1): string {
  // Handle already rgba colors
  if (color.startsWith('rgba') || color.startsWith('rgb')) {
    return color;
  }

  // Parse hex color
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  if (alpha >= 1) {
    return color;
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
