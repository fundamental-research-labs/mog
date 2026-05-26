/**
 * TextEffect Preset Definitions
 *
 * Shared definitions for warp presets used across TextEffect components.
 * This module provides the runtime data for preset metadata that is used
 * by both the TextEffectGallery and TransformPicker components.
 *
 * NOTE: The contracts package contains only types (WarpPresetDefinition,
 * WarpCategory, etc.), while this module contains the actual runtime data.
 *
 * @see contracts/src/text-effects/presets.ts for type definitions
 */

import type { WarpCategory, WarpPresetDefinition } from '@mog-sdk/contracts/text-effects';

// =============================================================================
// Category Definitions
// =============================================================================

/**
 * Warp preset categories with display labels.
 * Matches Excel's TextEffect gallery organization.
 */
export const WARP_CATEGORIES: { id: WarpCategory; label: string; description: string }[] = [
  { id: 'basic', label: 'No Transform', description: 'Plain text without transformation' },
  { id: 'follow-path', label: 'Follow Path', description: 'Text follows a curved path' },
  { id: 'warp', label: 'Warp', description: 'Text with distortion effects' },
  { id: 'perspective', label: 'Perspective', description: 'Text with perspective effects' },
];

// =============================================================================
// Preset Definitions
// =============================================================================

/**
 * All warp preset definitions.
 * Contains metadata for all 35 warp presets from DrawingML specification.
 */
export const PRESET_DEFINITIONS: WarpPresetDefinition[] = [
  // Basic (1 preset)
  {
    id: 'textPlain',
    name: 'Plain',
    description: 'Plain text with no transformation',
    adjustmentCount: 0,
    defaultAdjustments: {},
    category: 'basic',
  },

  // Follow Path presets (10 presets)
  {
    id: 'textArchUp',
    name: 'Arch Up',
    description: 'Text curves upward along an arc',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    adjustmentRanges: { adj1: { min: 0, max: 100 } },
    category: 'follow-path',
  },
  {
    id: 'textArchDown',
    name: 'Arch Down',
    description: 'Text curves downward along an arc',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    adjustmentRanges: { adj1: { min: 0, max: 100 } },
    category: 'follow-path',
  },
  {
    id: 'textCircle',
    name: 'Circle',
    description: 'Text follows a circular path',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    adjustmentRanges: { adj1: { min: 0, max: 100 } },
    category: 'follow-path',
  },
  {
    id: 'textButton',
    name: 'Button',
    description: 'Text wraps around a button shape',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    adjustmentRanges: { adj1: { min: 0, max: 100 } },
    category: 'follow-path',
  },
  {
    id: 'textArchUpPour',
    name: 'Arch Up Pour',
    description: 'Text pours upward along an arc',
    adjustmentCount: 2,
    defaultAdjustments: { adj1: 50, adj2: 50 },
    category: 'follow-path',
  },
  {
    id: 'textArchDownPour',
    name: 'Arch Down Pour',
    description: 'Text pours downward along an arc',
    adjustmentCount: 2,
    defaultAdjustments: { adj1: 50, adj2: 50 },
    category: 'follow-path',
  },
  {
    id: 'textCirclePour',
    name: 'Circle Pour',
    description: 'Text pours around a circular path',
    adjustmentCount: 2,
    defaultAdjustments: { adj1: 50, adj2: 50 },
    category: 'follow-path',
  },
  {
    id: 'textButtonPour',
    name: 'Button Pour',
    description: 'Text pours around a button shape',
    adjustmentCount: 2,
    defaultAdjustments: { adj1: 50, adj2: 50 },
    category: 'follow-path',
  },
  {
    id: 'textRingInside',
    name: 'Ring Inside',
    description: 'Text wraps inside a ring',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'follow-path',
  },
  {
    id: 'textRingOutside',
    name: 'Ring Outside',
    description: 'Text wraps outside a ring',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'follow-path',
  },

  // Warp presets (16 presets)
  {
    id: 'textWave1',
    name: 'Wave 1',
    description: 'Text follows a wave pattern',
    adjustmentCount: 2,
    defaultAdjustments: { adj1: 20, adj2: 0 },
    category: 'warp',
  },
  {
    id: 'textWave2',
    name: 'Wave 2',
    description: 'Text follows a double wave pattern',
    adjustmentCount: 2,
    defaultAdjustments: { adj1: 20, adj2: 0 },
    category: 'warp',
  },
  {
    id: 'textDoubleWave1',
    name: 'Double Wave',
    description: 'Text with double wave distortion',
    adjustmentCount: 2,
    defaultAdjustments: { adj1: 20, adj2: 0 },
    category: 'warp',
  },
  {
    id: 'textWave4',
    name: 'Wave 4',
    description: 'Text with wave variation',
    adjustmentCount: 2,
    defaultAdjustments: { adj1: 20, adj2: 0 },
    category: 'warp',
  },
  {
    id: 'textInflate',
    name: 'Inflate',
    description: 'Text bulges outward in the center',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'warp',
  },
  {
    id: 'textDeflate',
    name: 'Deflate',
    description: 'Text pinches inward in the center',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'warp',
  },
  {
    id: 'textInflateBottom',
    name: 'Inflate Bottom',
    description: 'Text bulges at the bottom',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'warp',
  },
  {
    id: 'textDeflateBottom',
    name: 'Deflate Bottom',
    description: 'Text pinches at the bottom',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'warp',
  },
  {
    id: 'textInflateTop',
    name: 'Inflate Top',
    description: 'Text bulges at the top',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'warp',
  },
  {
    id: 'textDeflateTop',
    name: 'Deflate Top',
    description: 'Text pinches at the top',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'warp',
  },
  {
    id: 'textDeflateInflate',
    name: 'Deflate-Inflate',
    description: 'Text alternates pinch and bulge',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'warp',
  },
  {
    id: 'textDeflateInflateDeflate',
    name: 'Deflate-Inflate-Deflate',
    description: 'Text with complex pinch-bulge pattern',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'warp',
  },
  {
    id: 'textTriangle',
    name: 'Triangle',
    description: 'Text forms a triangle shape',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'warp',
  },
  {
    id: 'textTriangleInverted',
    name: 'Triangle Inverted',
    description: 'Text forms an inverted triangle',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'warp',
  },
  {
    id: 'textChevron',
    name: 'Chevron',
    description: 'Text forms a chevron shape',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'warp',
  },
  {
    id: 'textChevronInverted',
    name: 'Chevron Inverted',
    description: 'Text forms an inverted chevron',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'warp',
  },

  // Perspective presets (8 presets)
  {
    id: 'textFadeRight',
    name: 'Fade Right',
    description: 'Text fades toward the right',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'perspective',
  },
  {
    id: 'textFadeLeft',
    name: 'Fade Left',
    description: 'Text fades toward the left',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'perspective',
  },
  {
    id: 'textFadeUp',
    name: 'Fade Up',
    description: 'Text fades toward the top',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'perspective',
  },
  {
    id: 'textFadeDown',
    name: 'Fade Down',
    description: 'Text fades toward the bottom',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'perspective',
  },
  {
    id: 'textSlantUp',
    name: 'Slant Up',
    description: 'Text slants upward',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'perspective',
  },
  {
    id: 'textSlantDown',
    name: 'Slant Down',
    description: 'Text slants downward',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'perspective',
  },
  {
    id: 'textCascadeUp',
    name: 'Cascade Up',
    description: 'Text cascades upward in steps',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'perspective',
  },
  {
    id: 'textCascadeDown',
    name: 'Cascade Down',
    description: 'Text cascades downward in steps',
    adjustmentCount: 1,
    defaultAdjustments: { adj1: 50 },
    category: 'perspective',
  },
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get presets filtered by category.
 */
export function getPresetsByCategory(category: WarpCategory): WarpPresetDefinition[] {
  return PRESET_DEFINITIONS.filter((preset) => preset.category === category);
}

/**
 * Get a preset definition by ID.
 */
export function getPresetById(id: string): WarpPresetDefinition | undefined {
  return PRESET_DEFINITIONS.find((preset) => preset.id === id);
}
