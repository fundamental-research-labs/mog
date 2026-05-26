/**
 * TextEffect Style Presets
 *
 * Quick style presets corresponding to the ribbon styles in Office.
 * Each preset defines fill, outline, shadow, and 3D configuration.
 */
import type { ThreeDConfig } from './three-d';

/**
 * A complete TextEffect style.
 */
export interface TextEffectStyle {
  /** Fill configuration */
  fill: {
    type: 'solid' | 'gradient' | 'none';
    color?: string;
    gradient?: {
      type: 'linear' | 'radial';
      angle?: number;
      stops: { position: number; color: string }[];
    };
  };
  /** Outline configuration */
  outline?: {
    color: string;
    width: number;
  };
  /** Shadow configuration */
  shadow?: {
    color: string;
    offsetX: number;
    offsetY: number;
    blur: number;
    opacity: number;
  };
  /** 3D rotation */
  threeDRotation?: ThreeDConfig;
}

/**
 * Predefined TextEffect styles. These correspond to the styles shown in
 * the Office TextEffect gallery ribbon.
 */
export const STYLE_PRESETS: TextEffectStyle[] = [
  // Style 0: Fill - Black, Text 1
  {
    fill: { type: 'solid', color: '#000000' },
  },
  // Style 1: Fill - Blue, Accent 1
  {
    fill: { type: 'solid', color: '#4472C4' },
  },
  // Style 2: Fill - Orange, Accent 2
  {
    fill: { type: 'solid', color: '#ED7D31' },
  },
  // Style 3: Fill - Gray, Accent 3
  {
    fill: { type: 'solid', color: '#A5A5A5' },
  },
  // Style 4: Fill - Gold, Accent 4
  {
    fill: { type: 'solid', color: '#FFC000' },
  },
  // Style 5: Fill - Blue, Accent 5
  {
    fill: { type: 'solid', color: '#5B9BD5' },
  },
  // Style 6: Fill - Green, Accent 6
  {
    fill: { type: 'solid', color: '#70AD47' },
  },
  // Style 7: Gradient Fill - Blue, Accent 1
  {
    fill: {
      type: 'gradient',
      gradient: {
        type: 'linear',
        angle: 90,
        stops: [
          { position: 0, color: '#4472C4' },
          { position: 100, color: '#2F5597' },
        ],
      },
    },
    shadow: { color: '#000000', offsetX: 2, offsetY: 2, blur: 4, opacity: 0.3 },
  },
  // Style 8: Gradient Fill - Orange, Accent 2
  {
    fill: {
      type: 'gradient',
      gradient: {
        type: 'linear',
        angle: 90,
        stops: [
          { position: 0, color: '#ED7D31' },
          { position: 100, color: '#C55A11' },
        ],
      },
    },
    shadow: { color: '#000000', offsetX: 2, offsetY: 2, blur: 4, opacity: 0.3 },
  },
  // Style 9: Gradient Fill - Gold
  {
    fill: {
      type: 'gradient',
      gradient: {
        type: 'linear',
        angle: 90,
        stops: [
          { position: 0, color: '#FFC000' },
          { position: 100, color: '#BF9000' },
        ],
      },
    },
    shadow: { color: '#000000', offsetX: 2, offsetY: 2, blur: 4, opacity: 0.3 },
  },
  // Style 10: Outline - Blue, Accent 1
  {
    fill: { type: 'none' },
    outline: { color: '#4472C4', width: 2 },
  },
  // Style 11: Outline - Orange, Accent 2
  {
    fill: { type: 'none' },
    outline: { color: '#ED7D31', width: 2 },
  },
  // Style 12: Fill - White, Outline - Blue
  {
    fill: { type: 'solid', color: '#FFFFFF' },
    outline: { color: '#4472C4', width: 1.5 },
  },
  // Style 13: Fill - White, Outline - Orange
  {
    fill: { type: 'solid', color: '#FFFFFF' },
    outline: { color: '#ED7D31', width: 1.5 },
  },
  // Style 14: Fill - Blue with 3D
  {
    fill: { type: 'solid', color: '#4472C4' },
    threeDRotation: { rotationX: 10, rotationY: 0, rotationZ: 0 },
    shadow: { color: '#000000', offsetX: 3, offsetY: 3, blur: 6, opacity: 0.4 },
  },
];

/**
 * Get a style preset by index.
 *
 * @param index Style index (0-based)
 * @returns The style preset, or the first style if index is out of range
 */
export function getStylePreset(index: number): TextEffectStyle {
  if (index < 0 || index >= STYLE_PRESETS.length) {
    return STYLE_PRESETS[0];
  }
  return STYLE_PRESETS[index];
}
