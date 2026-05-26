/**
 * Preset Gradients
 *
 * Excel-like preset gradient fills for cell backgrounds.
 * Includes common linear and path (radial) gradients.
 *
 */

import type { GradientFill } from '@mog-sdk/contracts/core';

// =============================================================================
// Types
// =============================================================================

/**
 * Preset gradient definition with metadata for UI display.
 */
export interface PresetGradient {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Category for grouping in UI */
  category: 'light' | 'dark' | 'accent' | 'rainbow';
  /** Gradient configuration */
  gradient: GradientFill;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a simple linear gradient from one color to another.
 */
function linearGradient(color1: string, color2: string, degree: number = 0): GradientFill {
  return {
    type: 'linear',
    degree,
    stops: [
      { position: 0, color: color1 },
      { position: 1, color: color2 },
    ],
  };
}

/**
 * Create a three-stop linear gradient.
 */
function tripleLinearGradient(
  color1: string,
  color2: string,
  color3: string,
  degree: number = 0,
): GradientFill {
  return {
    type: 'linear',
    degree,
    stops: [
      { position: 0, color: color1 },
      { position: 0.5, color: color2 },
      { position: 1, color: color3 },
    ],
  };
}

/**
 * Create a path (radial) gradient from center.
 */
function radialGradient(
  centerColor: string,
  edgeColor: string,
  center: { left: number; top: number } = { left: 0.5, top: 0.5 },
): GradientFill {
  return {
    type: 'path',
    center,
    stops: [
      { position: 0, color: centerColor },
      { position: 1, color: edgeColor },
    ],
  };
}

// =============================================================================
// Preset Gradients
// =============================================================================

/**
 * Light gradient presets - subtle backgrounds.
 */
const LIGHT_GRADIENTS: PresetGradient[] = [
  {
    id: 'light-horizontal',
    name: 'Light Horizontal',
    category: 'light',
    gradient: linearGradient('#FFFFFF', '#E0E0E0', 0),
  },
  {
    id: 'light-vertical',
    name: 'Light Vertical',
    category: 'light',
    gradient: linearGradient('#FFFFFF', '#E0E0E0', 90),
  },
  {
    id: 'light-diagonal-up',
    name: 'Light Diagonal Up',
    category: 'light',
    gradient: linearGradient('#FFFFFF', '#E0E0E0', 45),
  },
  {
    id: 'light-diagonal-down',
    name: 'Light Diagonal Down',
    category: 'light',
    gradient: linearGradient('#FFFFFF', '#E0E0E0', 135),
  },
  {
    id: 'light-center',
    name: 'Light From Center',
    category: 'light',
    gradient: radialGradient('#FFFFFF', '#E0E0E0'),
  },
  {
    id: 'light-corner',
    name: 'Light From Corner',
    category: 'light',
    gradient: radialGradient('#FFFFFF', '#E0E0E0', { left: 0, top: 0 }),
  },
];

/**
 * Dark gradient presets - bold backgrounds.
 */
const DARK_GRADIENTS: PresetGradient[] = [
  {
    id: 'dark-horizontal',
    name: 'Dark Horizontal',
    category: 'dark',
    gradient: linearGradient('#404040', '#202020', 0),
  },
  {
    id: 'dark-vertical',
    name: 'Dark Vertical',
    category: 'dark',
    gradient: linearGradient('#404040', '#202020', 90),
  },
  {
    id: 'dark-diagonal-up',
    name: 'Dark Diagonal Up',
    category: 'dark',
    gradient: linearGradient('#404040', '#202020', 45),
  },
  {
    id: 'dark-diagonal-down',
    name: 'Dark Diagonal Down',
    category: 'dark',
    gradient: linearGradient('#404040', '#202020', 135),
  },
  {
    id: 'dark-center',
    name: 'Dark From Center',
    category: 'dark',
    gradient: radialGradient('#505050', '#202020'),
  },
  {
    id: 'charcoal',
    name: 'Charcoal',
    category: 'dark',
    gradient: tripleLinearGradient('#404040', '#606060', '#404040', 90),
  },
];

/**
 * Accent gradient presets - colorful backgrounds matching Excel's theme colors.
 */
const ACCENT_GRADIENTS: PresetGradient[] = [
  // Blue variants
  {
    id: 'ocean',
    name: 'Ocean',
    category: 'accent',
    gradient: linearGradient('#1A73E8', '#0D47A1', 90),
  },
  {
    id: 'sky',
    name: 'Sky',
    category: 'accent',
    gradient: linearGradient('#81D4FA', '#29B6F6', 90),
  },
  {
    id: 'sapphire',
    name: 'Sapphire',
    category: 'accent',
    gradient: tripleLinearGradient('#0D47A1', '#1565C0', '#0D47A1', 0),
  },
  // Green variants
  {
    id: 'forest',
    name: 'Forest',
    category: 'accent',
    gradient: linearGradient('#2E7D32', '#1B5E20', 90),
  },
  {
    id: 'moss',
    name: 'Moss',
    category: 'accent',
    gradient: linearGradient('#81C784', '#4CAF50', 90),
  },
  {
    id: 'emerald',
    name: 'Emerald',
    category: 'accent',
    gradient: radialGradient('#4CAF50', '#1B5E20'),
  },
  // Orange/Yellow variants
  {
    id: 'sunset',
    name: 'Sunset',
    category: 'accent',
    gradient: linearGradient('#FF9800', '#E65100', 90),
  },
  {
    id: 'gold',
    name: 'Gold',
    category: 'accent',
    gradient: linearGradient('#FFD54F', '#FFA000', 90),
  },
  {
    id: 'amber',
    name: 'Amber',
    category: 'accent',
    gradient: tripleLinearGradient('#FFB300', '#FFC107', '#FFB300', 0),
  },
  // Red/Pink variants
  {
    id: 'rose',
    name: 'Rose',
    category: 'accent',
    gradient: linearGradient('#F48FB1', '#E91E63', 90),
  },
  {
    id: 'cherry',
    name: 'Cherry',
    category: 'accent',
    gradient: linearGradient('#EF5350', '#B71C1C', 90),
  },
  {
    id: 'ruby',
    name: 'Ruby',
    category: 'accent',
    gradient: radialGradient('#E53935', '#B71C1C'),
  },
  // Purple variants
  {
    id: 'lavender',
    name: 'Lavender',
    category: 'accent',
    gradient: linearGradient('#CE93D8', '#9C27B0', 90),
  },
  {
    id: 'grape',
    name: 'Grape',
    category: 'accent',
    gradient: linearGradient('#7E57C2', '#4527A0', 90),
  },
  {
    id: 'amethyst',
    name: 'Amethyst',
    category: 'accent',
    gradient: tripleLinearGradient('#6A1B9A', '#8E24AA', '#6A1B9A', 0),
  },
  // Teal variants
  {
    id: 'peacock',
    name: 'Peacock',
    category: 'accent',
    gradient: linearGradient('#26A69A', '#00695C', 90),
  },
  {
    id: 'teal',
    name: 'Teal',
    category: 'accent',
    gradient: radialGradient('#4DB6AC', '#00695C'),
  },
];

/**
 * Rainbow/multi-color gradient presets.
 */
const RAINBOW_GRADIENTS: PresetGradient[] = [
  {
    id: 'rainbow',
    name: 'Rainbow',
    category: 'rainbow',
    gradient: {
      type: 'linear',
      degree: 0,
      stops: [
        { position: 0, color: '#FF0000' },
        { position: 0.17, color: '#FF8000' },
        { position: 0.33, color: '#FFFF00' },
        { position: 0.5, color: '#00FF00' },
        { position: 0.67, color: '#0080FF' },
        { position: 0.83, color: '#8000FF' },
        { position: 1, color: '#FF00FF' },
      ],
    },
  },
  {
    id: 'sunrise',
    name: 'Sunrise',
    category: 'rainbow',
    gradient: {
      type: 'linear',
      degree: 90,
      stops: [
        { position: 0, color: '#FF6F00' },
        { position: 0.5, color: '#FFD54F' },
        { position: 1, color: '#FFF8E1' },
      ],
    },
  },
  {
    id: 'twilight',
    name: 'Twilight',
    category: 'rainbow',
    gradient: {
      type: 'linear',
      degree: 90,
      stops: [
        { position: 0, color: '#1A237E' },
        { position: 0.5, color: '#7C4DFF' },
        { position: 1, color: '#FF6F00' },
      ],
    },
  },
  {
    id: 'northern-lights',
    name: 'Northern Lights',
    category: 'rainbow',
    gradient: {
      type: 'linear',
      degree: 45,
      stops: [
        { position: 0, color: '#00BCD4' },
        { position: 0.5, color: '#4CAF50' },
        { position: 1, color: '#9C27B0' },
      ],
    },
  },
  {
    id: 'fire',
    name: 'Fire',
    category: 'rainbow',
    gradient: {
      type: 'linear',
      degree: 90,
      stops: [
        { position: 0, color: '#B71C1C' },
        { position: 0.5, color: '#FF5722' },
        { position: 1, color: '#FFEB3B' },
      ],
    },
  },
  {
    id: 'ice',
    name: 'Ice',
    category: 'rainbow',
    gradient: {
      type: 'linear',
      degree: 90,
      stops: [
        { position: 0, color: '#0D47A1' },
        { position: 0.5, color: '#4FC3F7' },
        { position: 1, color: '#E1F5FE' },
      ],
    },
  },
];

// =============================================================================
// Exports
// =============================================================================

/**
 * All preset gradients combined.
 */
export const PRESET_GRADIENTS: PresetGradient[] = [
  ...LIGHT_GRADIENTS,
  ...DARK_GRADIENTS,
  ...ACCENT_GRADIENTS,
  ...RAINBOW_GRADIENTS,
];

/**
 * Gradient category labels for UI display.
 */
export const GRADIENT_CATEGORY_LABELS: Record<PresetGradient['category'], string> = {
  light: 'Light Variations',
  dark: 'Dark Variations',
  accent: 'Accent Colors',
  rainbow: 'Multi-Color',
};

/**
 * Category display order.
 */
export const GRADIENT_CATEGORY_ORDER: PresetGradient['category'][] = [
  'light',
  'dark',
  'accent',
  'rainbow',
];

/**
 * Get preset gradients by category.
 */
export function getPresetGradientsByCategory(
  category: PresetGradient['category'],
): PresetGradient[] {
  return PRESET_GRADIENTS.filter((g) => g.category === category);
}

/**
 * Get a preset gradient by ID.
 */
export function getPresetGradientById(id: string): PresetGradient | undefined {
  return PRESET_GRADIENTS.find((g) => g.id === id);
}

/**
 * Convert a GradientFill to a CSS linear-gradient or radial-gradient string.
 * Used for previewing gradients in the UI.
 */
export function gradientFillToCSS(gradient: GradientFill): string {
  // Build the color stops string
  const stopsStr = gradient.stops.map((stop) => `${stop.color} ${stop.position * 100}%`).join(', ');

  if (gradient.type === 'linear') {
    // CSS linear-gradient uses angles differently than Excel
    // Excel: 0 = left-to-right, 90 = bottom-to-top
    // CSS: 0deg = bottom-to-top, 90deg = left-to-right
    // Convert: CSS angle = 90 - Excel angle
    const cssAngle = 90 - (gradient.degree ?? 0);
    return `linear-gradient(${cssAngle}deg, ${stopsStr})`;
  } else {
    // Path (radial) gradient
    const center = gradient.center ?? { left: 0.5, top: 0.5 };
    const centerX = center.left * 100;
    const centerY = center.top * 100;
    return `radial-gradient(circle at ${centerX}% ${centerY}%, ${stopsStr})`;
  }
}
