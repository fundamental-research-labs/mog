/**
 * TextEffect Schema Defaults & Utilities
 *
 * Runtime schema objects, default values, factory functions, and utility functions for TextEffect.
 * Moved from contracts - contracts retains only type definitions.
 *
 * @see contracts/src/store/text-effects-schema.ts for type exports
 */

import type { TextEffectConfig } from '@mog-sdk/contracts/text-effects';
import type { FieldDef, Schema } from '@mog-sdk/contracts/store';
import type { TextEffectSchemaField } from '@mog-sdk/contracts/store';

// =============================================================================
// Default Constants (Single Source of Truth)
// =============================================================================

/**
 * Default solid fill for TextEffect text.
 */
export const DEFAULT_TEXT_EFFECT_FILL = {
  type: 'solid' as const,
  color: '#4472C4',
  opacity: 1,
};

/**
 * Default gradient fill for TextEffect text.
 */
export const DEFAULT_TEXT_EFFECT_GRADIENT_FILL = {
  type: 'gradient' as const,
  gradientType: 'linear' as const,
  angle: 90,
  stops: [
    { position: 0, color: '#4472C4' },
    { position: 100, color: '#2F5496' },
  ],
};

/**
 * Default outline for TextEffect text.
 */
export const DEFAULT_TEXT_EFFECT_OUTLINE = {
  width: 0,
  color: '#000000',
  opacity: 1,
  dash: 'solid' as const,
};

/**
 * Default shadow effect for TextEffect.
 */
export const DEFAULT_TEXT_EFFECT_SHADOW = {
  blurRadius: 40000,
  distance: 25000,
  direction: 45,
  color: '#000000',
  opacity: 0.35,
};

/**
 * Default text effects configuration for TextEffect.
 */
export const DEFAULT_TEXT_EFFECT_EFFECTS = {
  outerShadow: DEFAULT_TEXT_EFFECT_SHADOW,
};

// =============================================================================
// TextEffect Config Schema
// =============================================================================

/**
 * Schema definition for TextEffect configuration.
 */
export const TEXT_EFFECT_CONFIG_SCHEMA = {
  warpPreset: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 'textPlain',
  } as const satisfies FieldDef,

  warpAdjustments: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: true,
    default: {},
  } as const satisfies FieldDef,

  fill: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: DEFAULT_TEXT_EFFECT_FILL,
  } as const satisfies FieldDef,

  outline: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: true,
    default: undefined,
  } as const satisfies FieldDef,

  effects: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: true,
    default: DEFAULT_TEXT_EFFECT_EFFECTS,
  } as const satisfies FieldDef,

  followPath: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: false,
    default: true,
  } as const satisfies FieldDef,

  anchor: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: false,
    default: 'middle',
  } as const satisfies FieldDef,

  textDirection: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: false,
    default: 'ltr',
  } as const satisfies FieldDef,

  normalizeHeights: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: false,
    default: false,
  } as const satisfies FieldDef,
} as const satisfies Schema;

// =============================================================================
// Schema Utility Functions
// =============================================================================

/**
 * Get the default value for a TextEffect config field.
 */
export function getTextEffectDefault(field: TextEffectSchemaField): unknown {
  const def = TEXT_EFFECT_CONFIG_SCHEMA[field];
  return def.default;
}

/**
 * Get all default values for TextEffect fields that have defaults.
 */
export function getTextEffectDefaults(): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(TEXT_EFFECT_CONFIG_SCHEMA)) {
    if ('default' in def && def.default !== undefined) {
      defaults[key] = def.default;
    }
  }
  return defaults;
}

/**
 * Get the copy strategy for a TextEffect field.
 */
export function getTextEffectCopyStrategy(field: TextEffectSchemaField): FieldDef['copy'] {
  return TEXT_EFFECT_CONFIG_SCHEMA[field].copy;
}

/**
 * Check if a TextEffect field is required on creation.
 */
export function isTextEffectFieldRequired(field: TextEffectSchemaField): boolean {
  return TEXT_EFFECT_CONFIG_SCHEMA[field].required;
}

/**
 * Get all required fields from the TextEffect schema.
 */
export function getRequiredTextEffectFields(): TextEffectSchemaField[] {
  return (Object.keys(TEXT_EFFECT_CONFIG_SCHEMA) as TextEffectSchemaField[]).filter(
    (key) => TEXT_EFFECT_CONFIG_SCHEMA[key].required,
  );
}

/**
 * Get all lazy-init fields from the TextEffect schema.
 */
export function getLazyInitTextEffectFields(): TextEffectSchemaField[] {
  return (Object.keys(TEXT_EFFECT_CONFIG_SCHEMA) as TextEffectSchemaField[]).filter(
    (key) => TEXT_EFFECT_CONFIG_SCHEMA[key].lazyInit,
  );
}

/**
 * Create a default TextEffect configuration object.
 */
export function createDefaultTextEffectConfig(): TextEffectConfig {
  return {
    warpPreset: 'textPlain',
    fill: {
      type: 'solid',
      color: '#4472C4',
      opacity: 1,
    },
    effects: {
      outerShadow: {
        blurRadius: 40000,
        distance: 25000,
        direction: 45,
        color: '#000000',
        opacity: 0.35,
      },
    },
    followPath: true,
  };
}

/**
 * Create a TextEffect configuration with gradient fill.
 */
export function createGradientTextEffectConfig(): TextEffectConfig {
  return {
    warpPreset: 'textPlain',
    fill: {
      type: 'gradient',
      gradientType: 'linear',
      angle: 90,
      stops: [
        { position: 0, color: '#4472C4' },
        { position: 100, color: '#2F5496' },
      ],
    },
    effects: {
      outerShadow: {
        blurRadius: 40000,
        distance: 25000,
        direction: 45,
        color: '#000000',
        opacity: 0.35,
      },
    },
    followPath: true,
  };
}
