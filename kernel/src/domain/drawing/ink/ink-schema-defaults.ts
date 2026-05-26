/**
 * Ink Schema Defaults & Utilities
 *
 * Runtime schema objects and utility functions for ink/drawing data structures.
 * Moved from contracts - contracts retains only type definitions.
 *
 * @see contracts/src/store/ink-schema.ts for type exports
 */

import type { FieldDef, Schema } from '@mog-sdk/contracts/store';

// =============================================================================
// Ink Stroke Schema
// =============================================================================

/**
 * Schema definition for InkStroke storage.
 */
export const INK_STROKE_SCHEMA = {
  id: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: '',
  },
  points: {
    type: 'Y.Array',
    valueType: 'SerializedPoint',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  tool: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 'pen',
  },
  color: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: '#000000',
  },
  width: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 2,
  },
  opacity: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 1.0,
  },
  createdBy: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: '',
  },
  createdAt: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 0,
  },
} as const satisfies Schema;

// =============================================================================
// Drawing Object Schema
// =============================================================================

/**
 * Schema definition for DrawingObject storage.
 */
export const DRAWING_OBJECT_SCHEMA = {
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
    default: 'drawing',
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
  strokes: {
    type: 'Y.Map',
    valueType: 'SerializedStroke',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  toolState: {
    type: 'Y.Map',
    valueType: 'InkToolState',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  recognitions: {
    type: 'Y.Map',
    valueType: 'RecognitionResult',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  backgroundColor: {
    type: 'primitive',
    required: false,
    copy: 'deep',
    lazyInit: false,
  },
} as const satisfies Schema;

// =============================================================================
// Tool State Schema
// =============================================================================

/**
 * Schema definition for InkToolState storage.
 */
export const INK_TOOL_STATE_SCHEMA = {
  activeTool: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 'pen',
  },
  toolSettings: {
    type: 'Y.Map',
    valueType: 'InkToolSettings',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
} as const satisfies Schema;

// =============================================================================
// Recognition Schemas
// =============================================================================

/**
 * Schema definition for RecognizedShape storage.
 */
export const RECOGNIZED_SHAPE_SCHEMA = {
  type: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 'shape',
  },
  shapeType: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  params: {
    type: 'Y.Map',
    valueType: 'ShapeParams',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  sourceStrokeIds: {
    type: 'Y.Array',
    valueType: 'StrokeId',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  confidence: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 0,
  },
  recognizedAt: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 0,
  },
} as const satisfies Schema;

/**
 * Schema definition for RecognizedText storage.
 */
export const RECOGNIZED_TEXT_SCHEMA = {
  type: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 'text',
  },
  text: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: '',
  },
  alternatives: {
    type: 'Y.Array',
    valueType: 'TextAlternative',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  sourceStrokeIds: {
    type: 'Y.Array',
    valueType: 'StrokeId',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  bounds: {
    type: 'Y.Map',
    valueType: 'BoundingBox',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  recognizedAt: {
    type: 'primitive',
    required: true,
    copy: 'deep',
    lazyInit: false,
    default: 0,
  },
} as const satisfies Schema;

// =============================================================================
// Schema Utility Functions
// =============================================================================

/**
 * Get the default value for a field in a schema.
 */
export function getSchemaDefault<S extends Schema>(schema: S, field: keyof S): unknown {
  const fieldDef = schema[field] as FieldDef;
  if (fieldDef.type === 'primitive') {
    return fieldDef.default;
  }
  return undefined;
}

/**
 * Get all default values for a schema.
 */
export function getSchemaDefaults<S extends Schema>(schema: S): Partial<Record<keyof S, unknown>> {
  const defaults: Partial<Record<keyof S, unknown>> = {};
  for (const key of Object.keys(schema) as Array<keyof S>) {
    const fieldDef = schema[key] as FieldDef;
    if (fieldDef.type === 'primitive' && fieldDef.default !== undefined) {
      defaults[key] = fieldDef.default;
    }
  }
  return defaults;
}

/**
 * Check if a field is required in a schema.
 */
export function isSchemaFieldRequired<S extends Schema>(schema: S, field: keyof S): boolean {
  return (schema[field] as FieldDef).required;
}

/**
 * Get all required fields from a schema.
 */
export function getRequiredSchemaFields<S extends Schema>(schema: S): Array<keyof S> {
  return (Object.keys(schema) as Array<keyof S>).filter(
    (key) => (schema[key] as FieldDef).required,
  );
}

/**
 * Get all lazy-init fields from a schema.
 */
export function getLazyInitSchemaFields<S extends Schema>(schema: S): Array<keyof S> {
  return (Object.keys(schema) as Array<keyof S>).filter(
    (key) => (schema[key] as FieldDef).lazyInit,
  );
}
