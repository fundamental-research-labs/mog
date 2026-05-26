/**
 * Diagram Color Themes
 *
 * Defines all 36 Excel color themes for Diagram diagrams.
 * Color themes determine the color palette and how colors
 * are applied to nodes in the diagram.
 *
 * Excel's "Change Colors" gallery contains exactly 36 presets:
 *
 * Categories:
 * - Colorful (5): Uses multiple accent colors in sequence/gradient/level
 * - Primary Theme Colors (5): Uses document dk1/dk2/lt1/lt2 colors
 * - Per-Accent Variations (24): 6 accents x 4 variations each (light, outline, fill, gradient)
 * - Transparent (2): Semi-transparent variations
 *
 * Color Strategies:
 * - sequential: Each node gets the next color, cycling through
 * - by-level: Color determined by hierarchy level
 * - gradient: Colors transition smoothly through the palette
 * - single: All nodes use the same color
 *
 * Each color theme corresponds to an OOXML colors#.xml definition with
 * style label color mappings. The OOXML URIs follow the pattern:
 *   urn:microsoft.com/office/officeart/2005/8/colors/{name}
 *
 * @see contracts/src/diagram/styles.ts for type definitions
 * @see contracts/src/diagram/ooxml-style-types.ts for OOXML color definition types
 */

import { parseHex } from '@mog/canvas-engine';
import type { ColorTheme } from '@mog-sdk/contracts/diagram';

// =============================================================================
// Default Accent Colors
// =============================================================================

/**
 * Excel default Office theme accent colors.
 *
 * FROZEN to prevent mutation - these are the standard Office theme colors
 * that serve as the base for most color themes.
 */
export const DEFAULT_ACCENT_COLORS = Object.freeze([
  '#4472C4', // Accent 1 - Blue
  '#ED7D31', // Accent 2 - Orange
  '#A5A5A5', // Accent 3 - Gray
  '#FFC000', // Accent 4 - Gold
  '#5B9BD5', // Accent 5 - Light Blue
  '#70AD47', // Accent 6 - Green
]) as readonly string[];

// =============================================================================
// Color Utility Functions
// =============================================================================

/**
 * Parse a hex color string to RGB components.
 *
 * Supports #RGB, #RRGGBB, and RRGGBB formats.
 * Delegates to the shared `parseHex` utility.
 *
 * @param hex - Hex color string
 * @returns RGB object with r, g, b values (0-255)
 * @throws Error if hex color is invalid
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = parseHex(hex);
  if (!result) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return result;
}

/**
 * Convert RGB values to a hex color string.
 *
 * @param r - Red component (0-255)
 * @param g - Green component (0-255)
 * @param b - Blue component (0-255)
 * @returns Hex color string in #RRGGBB format
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((x) =>
        Math.round(Math.max(0, Math.min(255, x)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  );
}

/**
 * Lighten a hex color by a percentage.
 *
 * @param hex - Hex color to lighten
 * @param amount - Amount to lighten (0-1, where 1 = white)
 * @returns Lightened hex color
 */
export function lightenColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  return rgbToHex(
    rgb.r + (255 - rgb.r) * amount,
    rgb.g + (255 - rgb.g) * amount,
    rgb.b + (255 - rgb.b) * amount,
  );
}

/**
 * Darken a hex color by a percentage.
 *
 * @param hex - Hex color to darken
 * @param amount - Amount to darken (0-1, where 1 = black)
 * @returns Darkened hex color
 */
export function darkenColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  return rgbToHex(rgb.r * (1 - amount), rgb.g * (1 - amount), rgb.b * (1 - amount));
}

/**
 * Interpolate between colors in a palette.
 *
 * @param colors - Array of hex colors to interpolate through
 * @param t - Position (0-1) in the color gradient
 * @returns Interpolated hex color
 */
export function interpolateColors(colors: readonly string[], t: number): string {
  if (colors.length === 0) {
    return '#000000';
  }

  if (colors.length === 1) {
    return colors[0];
  }

  const segment = t * (colors.length - 1);
  const index = Math.floor(segment);
  const localT = segment - index;

  if (index >= colors.length - 1) {
    return colors[colors.length - 1];
  }

  const c1 = hexToRgb(colors[index]);
  const c2 = hexToRgb(colors[index + 1]);

  return rgbToHex(
    c1.r + (c2.r - c1.r) * localT,
    c1.g + (c2.g - c1.g) * localT,
    c1.b + (c2.b - c1.b) * localT,
  );
}

// =============================================================================
// Accent Theme Generator
// =============================================================================

/**
 * Generate the 24 accent variation themes (6 accents x 4 variations each).
 *
 * For each of the 6 accent colors, generates:
 * - Light: 4-level gradient from very light to base color
 * - Outline: Single base color (for outline-style shapes)
 * - Fill: 4-level gradient from base color to dark
 * - Gradient: 3-color gradient light -> base -> dark
 */
function generateAccentThemes(): [string, ColorTheme][] {
  const themes: [string, ColorTheme][] = [];

  for (let i = 0; i < 6; i++) {
    const accentNum = i + 1;
    const baseColor = DEFAULT_ACCENT_COLORS[i];

    // Light variation
    themes.push([
      `accent-${accentNum}-light`,
      {
        id: `accent-${accentNum}-light`,
        name: `Accent ${accentNum} Light`,
        category: 'accent',
        colorStrategy: 'by-level',
        colors: [
          lightenColor(baseColor, 0.6),
          lightenColor(baseColor, 0.4),
          lightenColor(baseColor, 0.2),
          baseColor,
        ],
        opacity: 1,
      },
    ]);

    // Outline variation
    themes.push([
      `accent-${accentNum}-outline`,
      {
        id: `accent-${accentNum}-outline`,
        name: `Accent ${accentNum} Outline`,
        category: 'accent',
        colorStrategy: 'single',
        colors: [baseColor],
        opacity: 1,
      },
    ]);

    // Fill variation
    themes.push([
      `accent-${accentNum}-fill`,
      {
        id: `accent-${accentNum}-fill`,
        name: `Accent ${accentNum} Fill`,
        category: 'accent',
        colorStrategy: 'by-level',
        colors: [
          baseColor,
          darkenColor(baseColor, 0.15),
          darkenColor(baseColor, 0.3),
          darkenColor(baseColor, 0.45),
        ],
        opacity: 1,
      },
    ]);

    // Gradient variation
    themes.push([
      `accent-${accentNum}-gradient`,
      {
        id: `accent-${accentNum}-gradient`,
        name: `Accent ${accentNum} Gradient`,
        category: 'accent',
        colorStrategy: 'gradient',
        colors: [lightenColor(baseColor, 0.3), baseColor, darkenColor(baseColor, 0.3)],
        opacity: 1,
      },
    ]);
  }

  return themes;
}

// =============================================================================
// Color Themes Map
// =============================================================================

/**
 * Map of all 36 Excel color themes.
 *
 * Organized by section matching Excel's Change Colors gallery:
 * - Colorful (5 themes)
 * - Primary Theme Colors (5 themes): dk1 outline, lt1 outline, dk1 fill, lt2 outline, dk2 fill
 * - Accent Variations (24 themes): 6 accents x 4 variations each
 * - Transparent (2 themes)
 */
export const colorThemes: Map<string, ColorTheme> = new Map([
  // ===========================================================================
  // Colorful Themes (5)
  // ===========================================================================

  [
    'colorful-1',
    {
      id: 'colorful-1',
      name: 'Colorful - Accent Colors',
      category: 'colorful',
      colorStrategy: 'sequential',
      colors: [...DEFAULT_ACCENT_COLORS],
      opacity: 1,
    },
  ],

  [
    'colorful-2',
    {
      id: 'colorful-2',
      name: 'Colorful - Full Color Range',
      category: 'colorful',
      colorStrategy: 'gradient',
      colors: [...DEFAULT_ACCENT_COLORS],
      opacity: 1,
    },
  ],

  [
    'colorful-3',
    {
      id: 'colorful-3',
      name: 'Colorful - By Level',
      category: 'colorful',
      colorStrategy: 'by-level',
      colors: [...DEFAULT_ACCENT_COLORS],
      opacity: 1,
    },
  ],

  [
    'colorful-4',
    {
      id: 'colorful-4',
      name: 'Colorful - Soft',
      category: 'colorful',
      colorStrategy: 'sequential',
      colors: DEFAULT_ACCENT_COLORS.map((c) => lightenColor(c, 0.3)),
      opacity: 1,
    },
  ],

  [
    'colorful-5',
    {
      id: 'colorful-5',
      name: 'Colorful - Dark',
      category: 'colorful',
      colorStrategy: 'sequential',
      colors: DEFAULT_ACCENT_COLORS.map((c) => darkenColor(c, 0.2)),
      opacity: 1,
    },
  ],

  // ===========================================================================
  // Primary Theme Colors (5)
  //
  // These use the document's dk1/dk2/lt1/lt2 theme colors.
  // The hex values below are defaults for the Office theme; actual values
  // are resolved at runtime from the document theme.
  //
  // Excel's Change Colors gallery shows these in order:
  //   Dark 1 Outline, Light 1 Outline, Dark 1 Fill, Light 2 Outline, Dark 2 Fill
  // ===========================================================================

  [
    'dark-1-outline',
    {
      id: 'dark-1-outline',
      name: 'Dark 1 Outline',
      category: 'accent',
      colorStrategy: 'single',
      colors: ['#000000'],
      opacity: 1,
    },
  ],

  [
    'light-1-outline',
    {
      id: 'light-1-outline',
      name: 'Light 1 Outline',
      category: 'accent',
      colorStrategy: 'single',
      colors: ['#FFFFFF'],
      opacity: 1,
    },
  ],

  [
    'dark-1-fill',
    {
      id: 'dark-1-fill',
      name: 'Dark 1 Fill',
      category: 'accent',
      colorStrategy: 'single',
      colors: ['#404040'],
      opacity: 1,
    },
  ],

  [
    'light-2-outline',
    {
      id: 'light-2-outline',
      name: 'Light 2 Outline',
      category: 'accent',
      colorStrategy: 'single',
      colors: ['#E7E6E6'],
      opacity: 1,
    },
  ],

  [
    'dark-2-fill',
    {
      id: 'dark-2-fill',
      name: 'Dark 2 Fill',
      category: 'accent',
      colorStrategy: 'single',
      colors: ['#44546A'],
      opacity: 1,
    },
  ],

  // ===========================================================================
  // Accent Themes (24) - Generated
  // ===========================================================================

  ...generateAccentThemes(),

  // ===========================================================================
  // Transparent Themes (2)
  // ===========================================================================

  [
    'transparent-gradient',
    {
      id: 'transparent-gradient',
      name: 'Transparent Gradient',
      category: 'transparent',
      colorStrategy: 'gradient',
      colors: [...DEFAULT_ACCENT_COLORS],
      opacity: 0.5,
    },
  ],

  [
    'transparent-outline',
    {
      id: 'transparent-outline',
      name: 'Transparent Outline',
      category: 'transparent',
      colorStrategy: 'sequential',
      colors: [...DEFAULT_ACCENT_COLORS],
      opacity: 0.3,
    },
  ],
]);

// =============================================================================
// Public API
// =============================================================================

/**
 * Get a color theme by ID.
 *
 * @param id - The color theme ID
 * @returns The ColorTheme or undefined if not found
 *
 * @example
 * const theme = getColorTheme('colorful-1');
 * if (theme) {
 *   console.log(theme.name); // 'Colorful - Accent Colors'
 * }
 */
export function getColorTheme(id: string): ColorTheme | undefined {
  return colorThemes.get(id);
}

/**
 * Get all color themes in a specific category.
 *
 * @param category - The category to filter by
 * @returns Array of ColorThemes in the category
 */
export function getColorThemesByCategory(
  category: 'colorful' | 'accent' | 'transparent',
): ColorTheme[] {
  return Array.from(colorThemes.values()).filter((theme) => theme.category === category);
}

/**
 * Get all available color theme IDs.
 *
 * @returns Array of all color theme IDs
 */
export function getAllColorThemeIds(): string[] {
  return Array.from(colorThemes.keys());
}

// =============================================================================
// Color Generation Functions
// =============================================================================

/**
 * Generate colors for all nodes based on theme strategy.
 *
 * Applies the theme's color strategy to assign colors to nodes.
 * Assumes the theme has been validated (non-empty colors array).
 *
 * @param theme - Color theme (assumed to be validated)
 * @param nodes - Nodes to generate colors for
 * @param accentColors - Optional accent colors to override theme colors
 * @returns Map of node IDs to colors
 *
 * @example
 * const nodeColors = generateNodeColors(theme, [
 *   { id: 'node-1', level: 0 },
 *   { id: 'node-2', level: 1 },
 *   { id: 'node-3', level: 1 }
 * ]);
 * // nodeColors.get('node-1') = '#4472C4'
 */
export function generateNodeColors(
  theme: ColorTheme,
  nodes: { id: string; level: number }[],
  accentColors?: readonly string[],
): Map<string, string> {
  const colors = accentColors ?? theme.colors;

  // Handle empty nodes array - return empty map
  if (nodes.length === 0) {
    return new Map();
  }

  // Handle empty colors array - use fallback
  if (colors.length === 0) {
    const result = new Map<string, string>();
    nodes.forEach((node) => {
      result.set(node.id, '#000000');
    });
    return result;
  }

  switch (theme.colorStrategy) {
    case 'sequential':
      return sequentialColors(nodes, colors);
    case 'by-level':
      return levelBasedColors(nodes, colors);
    case 'gradient':
      return gradientColors(nodes, colors);
    case 'single':
      return singleColor(nodes, colors[0]);
    default:
      // Fallback to sequential for unknown strategies
      return sequentialColors(nodes, colors);
  }
}

/**
 * Sequential color strategy - each node gets the next color in the palette.
 *
 * @param nodes - Nodes to color
 * @param colors - Color palette
 * @returns Map of node IDs to colors
 */
function sequentialColors(
  nodes: { id: string; level: number }[],
  colors: readonly string[],
): Map<string, string> {
  const result = new Map<string, string>();
  nodes.forEach((node, index) => {
    result.set(node.id, colors[index % colors.length]);
  });
  return result;
}

/**
 * Level-based color strategy - color determined by hierarchy level.
 *
 * @param nodes - Nodes to color
 * @param colors - Color palette
 * @returns Map of node IDs to colors
 */
function levelBasedColors(
  nodes: { id: string; level: number }[],
  colors: readonly string[],
): Map<string, string> {
  const result = new Map<string, string>();
  nodes.forEach((node) => {
    result.set(node.id, colors[Math.min(node.level, colors.length - 1)]);
  });
  return result;
}

/**
 * Gradient color strategy - colors transition smoothly through the palette.
 *
 * @param nodes - Nodes to color
 * @param colors - Color palette
 * @returns Map of node IDs to colors
 */
function gradientColors(
  nodes: { id: string; level: number }[],
  colors: readonly string[],
): Map<string, string> {
  const result = new Map<string, string>();
  const count = nodes.length;

  nodes.forEach((node, index) => {
    const t = count > 1 ? index / (count - 1) : 0;
    result.set(node.id, interpolateColors(colors, t));
  });

  return result;
}

/**
 * Single color strategy - all nodes use the same color.
 *
 * @param nodes - Nodes to color
 * @param color - The single color to use
 * @returns Map of node IDs to colors
 */
function singleColor(nodes: { id: string; level: number }[], color: string): Map<string, string> {
  const result = new Map<string, string>();
  nodes.forEach((node) => {
    result.set(node.id, color);
  });
  return result;
}
