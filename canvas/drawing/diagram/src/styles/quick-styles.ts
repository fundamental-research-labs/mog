/**
 * Diagram Quick Styles
 *
 * Defines all 16 Excel quick styles for Diagram diagrams.
 * Quick styles control the visual appearance of shapes including
 * fill type, opacity, stroke, and effects.
 *
 * Excel's Diagram Styles gallery contains exactly 16 presets:
 *
 * Subtle Category (3):
 * - Simple Fill: Solid color, no effects (the most basic style)
 * - Subtle Effect: Solid fill with light shadow
 * - Subtle Line: Low-opacity fill with prominent stroke
 *
 * Moderate Category (3):
 * - Moderate Effect: Gradient fill with medium shadow
 * - Polished: Gradient fill with glow, slight sheen
 * - Inset: Solid fill with inset (inner) shadow
 *
 * Intense Category (3):
 * - Intense Effect: Gradient fill with strong shadow and glow
 * - Metallic Scene: Gradient fill with reflection and medium shadow
 * - Powder: Soft solid fill with large diffuse shadow
 *
 * 3D Category (7):
 * - 3D Cartoon: Solid fill with bold stroke and soft-round bevel
 * - 3D Polished: Gradient fill with convex bevel and perspective shadow
 * - 3D Flat Scene: Solid fill with relaxed bevel and light shadow
 * - 3D Powder: Solid fill with circle bevel and diffuse shadow
 * - Brick Scene: Textured solid fill with convex bevel and bottom shadow
 * - Sunrise Scene: Gradient fill with warm perspective shadow and convex bevel
 * - Birds Eye Scene: Solid fill with top-down shadow and circle bevel
 *
 * Each style corresponds to an OOXML quickStyle#.xml definition with
 * style label mappings. The OOXML URIs follow the pattern:
 *   urn:microsoft.com/office/officeart/2005/8/quickstyle/{name}
 *
 * @see contracts/src/diagram/styles.ts for type definitions
 * @see contracts/src/diagram/ooxml-style-types.ts for OOXML style definition types
 */

import type { QuickStyle, ShapeEffects } from '@mog-sdk/contracts/diagram';

// =============================================================================
// Quick Styles Map
// =============================================================================

/**
 * Map of all 16 Excel quick styles.
 *
 * Each style defines fill, stroke, and effects settings
 * that are applied to Diagram shapes.
 *
 * The 16 styles map to OOXML quickStyle URIs:
 * - simple-fill     -> urn:microsoft.com/office/officeart/2005/8/quickstyle/simple1
 * - subtle-line     -> urn:microsoft.com/office/officeart/2005/8/quickstyle/simple2
 * - subtle-effect   -> urn:microsoft.com/office/officeart/2005/8/quickstyle/simple3
 * - moderate-effect -> urn:microsoft.com/office/officeart/2005/8/quickstyle/simple4
 * - intense-effect  -> urn:microsoft.com/office/officeart/2005/8/quickstyle/simple5
 * - polished        -> urn:microsoft.com/office/officeart/2005/8/quickstyle/3d1
 * - inset           -> urn:microsoft.com/office/officeart/2005/8/quickstyle/3d2
 * - 3d-cartoon      -> urn:microsoft.com/office/officeart/2005/8/quickstyle/3d3
 * - powder          -> urn:microsoft.com/office/officeart/2005/8/quickstyle/3d4
 * - brick-scene     -> urn:microsoft.com/office/officeart/2005/8/quickstyle/3d5
 * - 3d-flat-scene   -> urn:microsoft.com/office/officeart/2005/8/quickstyle/3d6
 * - metallic-scene  -> urn:microsoft.com/office/officeart/2005/8/quickstyle/3d7
 * - sunrise-scene   -> urn:microsoft.com/office/officeart/2005/8/quickstyle/3d8
 * - birds-eye-scene -> urn:microsoft.com/office/officeart/2005/8/quickstyle/3d9
 */
export const quickStyles: Map<string, QuickStyle> = new Map([
  // ===========================================================================
  // 2D Styles (5 styles)
  // ===========================================================================

  [
    'simple-fill',
    {
      id: 'simple-fill',
      name: 'Simple Fill',
      category: 'subtle',
      fillType: 'solid',
      fillOpacity: 1,
      strokeWidth: 0,
      strokeOpacity: 0,
      effects: {},
      thumbnail: '',
    },
  ],

  [
    'subtle-effect',
    {
      id: 'subtle-effect',
      name: 'Subtle Effect',
      category: 'subtle',
      fillType: 'solid',
      fillOpacity: 1,
      strokeWidth: 1,
      strokeOpacity: 1,
      effects: {
        shadow: {
          color: 'rgb(0,0,0)',
          blur: 4,
          offsetX: 2,
          offsetY: 2,
          opacity: 0.3,
        },
      },
      thumbnail: '',
    },
  ],

  [
    'subtle-line',
    {
      id: 'subtle-line',
      name: 'Subtle Line',
      category: 'subtle',
      fillType: 'solid',
      fillOpacity: 0.1,
      strokeWidth: 2,
      strokeOpacity: 1,
      effects: {},
      thumbnail: '',
    },
  ],

  // ===========================================================================
  // Moderate Category (3 styles)
  // ===========================================================================

  [
    'moderate-effect',
    {
      id: 'moderate-effect',
      name: 'Moderate Effect',
      category: 'moderate',
      fillType: 'gradient',
      fillOpacity: 1,
      strokeWidth: 0,
      strokeOpacity: 0,
      effects: {
        shadow: {
          color: 'rgb(0,0,0)',
          blur: 8,
          offsetX: 3,
          offsetY: 3,
          opacity: 0.4,
        },
      },
      thumbnail: '',
    },
  ],

  [
    'polished',
    {
      id: 'polished',
      name: 'Polished',
      category: 'moderate',
      fillType: 'gradient',
      fillOpacity: 1,
      strokeWidth: 1,
      strokeOpacity: 0.5,
      effects: {
        shadow: {
          color: 'rgb(0,0,0)',
          blur: 6,
          offsetX: 2,
          offsetY: 2,
          opacity: 0.35,
        },
        glow: {
          color: 'rgb(255,255,255)',
          radius: 2,
          opacity: 0.3,
        },
      },
      thumbnail: '',
    },
  ],

  [
    'inset',
    {
      id: 'inset',
      name: 'Inset',
      category: 'moderate',
      fillType: 'solid',
      fillOpacity: 1,
      strokeWidth: 1,
      strokeOpacity: 1,
      effects: {
        shadow: {
          color: 'rgb(0,0,0)',
          blur: 4,
          offsetX: -2,
          offsetY: -2,
          opacity: 0.25,
        },
      },
      thumbnail: '',
    },
  ],

  // ===========================================================================
  // Intense Category (3 styles)
  // ===========================================================================

  [
    'intense-effect',
    {
      id: 'intense-effect',
      name: 'Intense Effect',
      category: 'intense',
      fillType: 'gradient',
      fillOpacity: 1,
      strokeWidth: 0,
      strokeOpacity: 0,
      effects: {
        shadow: {
          color: 'rgb(0,0,0)',
          blur: 12,
          offsetX: 4,
          offsetY: 4,
          opacity: 0.5,
        },
        glow: {
          color: 'rgb(255,255,255)',
          radius: 4,
          opacity: 0.4,
        },
      },
      thumbnail: '',
    },
  ],

  [
    'metallic-scene',
    {
      id: 'metallic-scene',
      name: 'Metallic Scene',
      category: 'intense',
      fillType: 'gradient',
      fillOpacity: 1,
      strokeWidth: 1,
      strokeOpacity: 0.8,
      effects: {
        shadow: {
          color: 'rgb(0,0,0)',
          blur: 10,
          offsetX: 3,
          offsetY: 3,
          opacity: 0.45,
        },
        reflection: {
          blur: 2,
          distance: 5,
          opacity: 0.2,
          size: 0.3,
        },
      },
      thumbnail: '',
    },
  ],

  [
    'powder',
    {
      id: 'powder',
      name: 'Powder',
      category: 'intense',
      fillType: 'solid',
      fillOpacity: 0.9,
      strokeWidth: 0,
      strokeOpacity: 0,
      effects: {
        shadow: {
          color: 'rgb(0,0,0)',
          blur: 20,
          offsetX: 0,
          offsetY: 5,
          opacity: 0.3,
        },
      },
      thumbnail: '',
    },
  ],

  // ===========================================================================
  // 3D Category (4 styles)
  // ===========================================================================

  [
    '3d-cartoon',
    {
      id: '3d-cartoon',
      name: '3D - Cartoon',
      category: '3d',
      fillType: 'solid',
      fillOpacity: 1,
      strokeWidth: 2,
      strokeOpacity: 1,
      effects: {
        bevel: {
          type: 'soft-round',
          width: 8,
          height: 8,
        },
        shadow: {
          color: 'rgb(0,0,0)',
          blur: 8,
          offsetX: 4,
          offsetY: 4,
          opacity: 0.4,
        },
      },
      thumbnail: '',
    },
  ],

  [
    '3d-polished',
    {
      id: '3d-polished',
      name: '3D - Polished',
      category: '3d',
      fillType: 'gradient',
      fillOpacity: 1,
      strokeWidth: 0,
      strokeOpacity: 0,
      effects: {
        bevel: {
          type: 'convex',
          width: 6,
          height: 6,
        },
        shadow: {
          color: 'rgb(0,0,0)',
          blur: 12,
          offsetX: 5,
          offsetY: 5,
          opacity: 0.45,
        },
        transform3D: {
          rotationX: 10,
          rotationY: 0,
          rotationZ: 0,
          perspective: 500,
        },
      },
      thumbnail: '',
    },
  ],

  [
    '3d-flat-scene',
    {
      id: '3d-flat-scene',
      name: '3D - Flat Scene',
      category: '3d',
      fillType: 'solid',
      fillOpacity: 1,
      strokeWidth: 0,
      strokeOpacity: 0,
      effects: {
        bevel: {
          type: 'relaxed',
          width: 4,
          height: 4,
        },
        shadow: {
          color: 'rgb(0,0,0)',
          blur: 6,
          offsetX: 3,
          offsetY: 3,
          opacity: 0.35,
        },
      },
      thumbnail: '',
    },
  ],

  [
    '3d-powder',
    {
      id: '3d-powder',
      name: '3D - Powder',
      category: '3d',
      fillType: 'solid',
      fillOpacity: 0.85,
      strokeWidth: 0,
      strokeOpacity: 0,
      effects: {
        bevel: {
          type: 'circle',
          width: 10,
          height: 10,
        },
        shadow: {
          color: 'rgb(0,0,0)',
          blur: 25,
          offsetX: 0,
          offsetY: 8,
          opacity: 0.3,
        },
      },
      thumbnail: '',
    },
  ],

  // ===========================================================================
  // NEW: Additional 3D Styles (to complete Excel's full set of 16)
  // ===========================================================================

  [
    'brick-scene',
    {
      id: 'brick-scene',
      name: 'Brick Scene',
      category: '3d',
      fillType: 'solid',
      fillOpacity: 1,
      strokeWidth: 1,
      strokeOpacity: 0.6,
      effects: {
        bevel: {
          type: 'convex',
          width: 5,
          height: 5,
        },
        shadow: {
          color: 'rgb(0,0,0)',
          blur: 8,
          offsetX: 0,
          offsetY: 6,
          opacity: 0.45,
        },
        transform3D: {
          rotationX: 5,
          rotationY: 0,
          rotationZ: 0,
          perspective: 600,
        },
      },
      thumbnail: '',
    },
  ],

  [
    'sunrise-scene',
    {
      id: 'sunrise-scene',
      name: 'Sunrise Scene',
      category: '3d',
      fillType: 'gradient',
      fillOpacity: 1,
      strokeWidth: 0,
      strokeOpacity: 0,
      effects: {
        bevel: {
          type: 'convex',
          width: 7,
          height: 7,
        },
        shadow: {
          color: 'rgb(0,0,0)',
          blur: 14,
          offsetX: 6,
          offsetY: 6,
          opacity: 0.4,
        },
        transform3D: {
          rotationX: 15,
          rotationY: -5,
          rotationZ: 0,
          perspective: 450,
        },
      },
      thumbnail: '',
    },
  ],

  [
    'birds-eye-scene',
    {
      id: 'birds-eye-scene',
      name: 'Birds Eye Scene',
      category: '3d',
      fillType: 'solid',
      fillOpacity: 1,
      strokeWidth: 0,
      strokeOpacity: 0,
      effects: {
        bevel: {
          type: 'circle',
          width: 6,
          height: 6,
        },
        shadow: {
          color: 'rgb(0,0,0)',
          blur: 16,
          offsetX: 0,
          offsetY: 10,
          opacity: 0.5,
        },
        transform3D: {
          rotationX: 25,
          rotationY: 0,
          rotationZ: 0,
          perspective: 400,
        },
      },
      thumbnail: '',
    },
  ],
]);

// =============================================================================
// Public API
// =============================================================================

/**
 * Get a quick style by ID.
 *
 * @param id - The quick style ID
 * @returns The QuickStyle or undefined if not found
 *
 * @example
 * const style = getQuickStyle('subtle-effect');
 * if (style) {
 *   console.log(style.name); // 'Subtle Effect'
 * }
 */
export function getQuickStyle(id: string): QuickStyle | undefined {
  return quickStyles.get(id);
}

/**
 * Get all quick styles in a specific category.
 *
 * @param category - The category to filter by
 * @returns Array of QuickStyles in the category
 */
export function getQuickStylesByCategory(
  category: 'subtle' | 'moderate' | 'intense' | '3d',
): QuickStyle[] {
  return Array.from(quickStyles.values()).filter((style) => style.category === category);
}

/**
 * Get all available quick style IDs.
 *
 * @returns Array of all quick style IDs
 */
export function getAllQuickStyleIds(): string[] {
  return Array.from(quickStyles.keys());
}

/**
 * Apply a quick style to a shape's base styling.
 *
 * Combines the base fill/stroke colors with the quick style's
 * opacity, stroke width, and effects settings.
 *
 * @param baseStyle - The base colors for the shape
 * @param quickStyle - The quick style to apply
 * @returns Complete style object with colors, opacities, and effects
 *
 * @example
 * const result = applyQuickStyleToShape(
 *   { fill: '#4472C4', stroke: '#2E5090' },
 *   getQuickStyle('subtle-effect')!
 * );
 * // result.fill = '#4472C4'
 * // result.fillOpacity = 1
 * // result.effects = { shadow: { ... } }
 */
export function applyQuickStyleToShape(
  baseStyle: { fill: string; stroke: string },
  quickStyle: QuickStyle,
): {
  fill: string;
  stroke: string;
  strokeWidth: number;
  fillOpacity: number;
  strokeOpacity: number;
  effects: ShapeEffects;
} {
  // Deep-clone effects to prevent one shape's mutations from affecting others
  // that share the same quick style.
  const effects: ShapeEffects = {};
  if (quickStyle.effects.shadow) {
    effects.shadow = { ...quickStyle.effects.shadow };
  }
  if (quickStyle.effects.glow) {
    effects.glow = { ...quickStyle.effects.glow };
  }
  if (quickStyle.effects.bevel) {
    effects.bevel = { ...quickStyle.effects.bevel };
  }
  if (quickStyle.effects.reflection) {
    effects.reflection = { ...quickStyle.effects.reflection };
  }
  if (quickStyle.effects.transform3D) {
    effects.transform3D = { ...quickStyle.effects.transform3D };
  }

  return {
    fill: baseStyle.fill,
    stroke: baseStyle.stroke,
    strokeWidth: quickStyle.strokeWidth,
    fillOpacity: quickStyle.fillOpacity,
    strokeOpacity: quickStyle.strokeOpacity,
    effects,
  };
}
