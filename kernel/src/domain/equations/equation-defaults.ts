/**
 * Equation Schema Defaults & Utilities
 *
 * Runtime schema objects, default values, and utility functions for equations.
 * Moved from contracts - contracts retains only type definitions.
 *
 * @see contracts/src/store/equation-schema.ts for type exports
 */

import type { Schema } from '@mog-sdk/contracts/store';

// =============================================================================
// Validation Constants
// =============================================================================

/**
 * Maximum length of OMML XML string.
 */
export const MAX_EQUATION_OMML_LENGTH = 100_000;

/**
 * Maximum AST depth for equation parsing.
 */
export const MAX_EQUATION_AST_DEPTH = 50;

/**
 * Maximum length of LaTeX input string.
 */
export const MAX_EQUATION_LATEX_LENGTH = 10_000;

// =============================================================================
// Equation Style Schema
// =============================================================================

/**
 * Schema definition for EquationStyle storage.
 */
export const EQUATION_STYLE_SCHEMA = {
  fontFamily: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 'Cambria Math',
  },
  fontSize: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 11,
  },
  color: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: '#000000',
  },
  backgroundColor: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 'transparent',
  },
  justification: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 'center',
  },
  displayMode: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: true,
  },
  smallFractions: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: false,
  },
} as const satisfies Schema;

// =============================================================================
// Equation Schema
// =============================================================================

/**
 * Schema definition for Equation storage.
 */
export const EQUATION_SCHEMA = {
  id: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: '',
  },
  omml: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: '',
  },
  latex: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: false,
  },
  ast: {
    type: 'primitive',
    required: false,
    copy: 'skip',
    lazyInit: false,
  },
  _cachedImageData: {
    type: 'primitive',
    required: false,
    copy: 'skip',
    lazyInit: false,
  },
  style: {
    type: 'Y.Map',
    valueType: 'EquationStyle',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
} as const satisfies Schema;

// =============================================================================
// Equation Object Schema
// =============================================================================

/**
 * Schema definition for EquationObject storage.
 */
export const EQUATION_OBJECT_SCHEMA = {
  id: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: '',
  },
  type: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 'equation',
  },
  sheetId: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: '',
  },
  position: {
    type: 'Y.Map',
    valueType: 'ObjectPosition',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  zIndex: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 0,
  },
  locked: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: false,
  },
  printable: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: true,
  },
  name: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: false,
  },
  altText: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: false,
  },
  createdAt: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: false,
  },
  updatedAt: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: false,
  },
  equation: {
    type: 'Y.Map',
    valueType: 'Equation',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
} as const satisfies Schema;

// =============================================================================
// Schema Utility Functions
// =============================================================================

/**
 * Get the default value for a field in the equation style schema.
 */
export function getEquationStyleDefault<K extends keyof typeof EQUATION_STYLE_SCHEMA>(
  field: K,
): (typeof EQUATION_STYLE_SCHEMA)[K]['default'] {
  const fieldDef = EQUATION_STYLE_SCHEMA[field];
  return fieldDef.default;
}

/**
 * Type for equation style defaults derived from schema.
 */
export type EquationStyleDefaults = {
  readonly [K in keyof typeof EQUATION_STYLE_SCHEMA]: (typeof EQUATION_STYLE_SCHEMA)[K]['default'];
};

/**
 * Get all default values for equation style.
 */
export function getEquationStyleDefaults(): EquationStyleDefaults {
  return {
    fontFamily: EQUATION_STYLE_SCHEMA.fontFamily.default,
    fontSize: EQUATION_STYLE_SCHEMA.fontSize.default,
    color: EQUATION_STYLE_SCHEMA.color.default,
    backgroundColor: EQUATION_STYLE_SCHEMA.backgroundColor.default,
    justification: EQUATION_STYLE_SCHEMA.justification.default,
    displayMode: EQUATION_STYLE_SCHEMA.displayMode.default,
    smallFractions: EQUATION_STYLE_SCHEMA.smallFractions.default,
  };
}

/**
 * Check if a field is required in the equation schema.
 */
export function isEquationFieldRequired<K extends keyof typeof EQUATION_SCHEMA>(field: K): boolean {
  return EQUATION_SCHEMA[field].required;
}

/**
 * Get all required fields from equation schema.
 */
export function getRequiredEquationFields(): Array<keyof typeof EQUATION_SCHEMA> {
  return (Object.keys(EQUATION_SCHEMA) as Array<keyof typeof EQUATION_SCHEMA>).filter(
    (key) => EQUATION_SCHEMA[key].required,
  );
}
