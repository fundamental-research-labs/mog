/**
 * Diagram Schema Defaults & Utilities
 *
 * Runtime schema objects, default values, and utility functions for Diagram.
 * Moved from contracts; lives in diagram package to avoid
 * circular dependency (kernel depends on diagram).
 *
 * @see contracts/src/store/diagram-schema.ts for type exports
 */

import type { Schema } from '@mog-sdk/contracts/store';
import type { DiagramField, DiagramNodeField } from '@mog-sdk/contracts/store';

// =============================================================================
// Diagram Node Schema
// =============================================================================

export const DIAGRAM_NODE_SCHEMA = {
  id: {
    type: 'primitive',
    required: true,
    copy: 'skip',
    lazyInit: false,
  },
  text: {
    type: 'primitive',
    default: '',
    required: false,
    copy: 'shallow',
    lazyInit: false,
  },
  level: {
    type: 'primitive',
    default: 0,
    required: false,
    copy: 'shallow',
    lazyInit: false,
  },
  parentId: {
    type: 'primitive',
    default: null,
    required: false,
    copy: 'skip',
    lazyInit: false,
  },
  childIds: {
    type: 'Y.Array',
    valueType: 'NodeId',
    required: true,
    copy: 'skip',
    lazyInit: false,
  },
  siblingOrder: {
    type: 'primitive',
    default: 0,
    required: false,
    copy: 'shallow',
    lazyInit: false,
  },
  fillColor: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
  },
  borderColor: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
  },
  textColor: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
  },
  fontFamily: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
  },
  fontSize: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
  },
  fontWeight: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
  },
  imageUrl: {
    type: 'primitive',
    required: false,
    copy: 'shallow',
    lazyInit: false,
  },
  imageFit: {
    type: 'primitive',
    default: 'cover',
    required: false,
    copy: 'shallow',
    lazyInit: false,
  },
} as const satisfies Schema;

// =============================================================================
// Diagram Diagram Schema
// =============================================================================

export const DIAGRAM_DIAGRAM_SCHEMA = {
  layoutId: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },
  category: {
    type: 'primitive',
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },
  nodeMap: {
    type: 'Y.Map',
    valueType: 'DiagramNode',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  rootNodeIds: {
    type: 'Y.Array',
    valueType: 'string',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  quickStyleId: {
    type: 'primitive',
    default: 'subtle-effect',
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },
  colorThemeId: {
    type: 'primitive',
    default: 'colorful-1',
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },
  layoutOptions: {
    type: 'Y.Map',
    required: false,
    copy: 'deep',
    lazyInit: true,
  },
} as const satisfies Schema;

// =============================================================================
// Schema Utility Functions
// =============================================================================

export function getDiagramNodeDefault<K extends keyof typeof DIAGRAM_NODE_SCHEMA>(
  field: K,
): unknown {
  const def = DIAGRAM_NODE_SCHEMA[field];
  return 'default' in def ? def.default : undefined;
}

export function getDiagramDefault<K extends keyof typeof DIAGRAM_DIAGRAM_SCHEMA>(
  field: K,
): unknown {
  const def = DIAGRAM_DIAGRAM_SCHEMA[field];
  return 'default' in def ? def.default : undefined;
}

export function getDiagramNodeDefaults(): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(DIAGRAM_NODE_SCHEMA)) {
    const fieldDef = def as { default?: unknown };
    if ('default' in fieldDef && fieldDef.default !== undefined) {
      defaults[key] = fieldDef.default;
    }
  }
  return defaults;
}

export function getDiagramDefaults(): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(DIAGRAM_DIAGRAM_SCHEMA)) {
    const fieldDef = def as { default?: unknown };
    if ('default' in fieldDef && fieldDef.default !== undefined) {
      defaults[key] = fieldDef.default;
    }
  }
  return defaults;
}

export function isDiagramNodeFieldRequired(field: DiagramNodeField): boolean {
  return DIAGRAM_NODE_SCHEMA[field].required;
}

export function isDiagramFieldRequired(field: DiagramField): boolean {
  return DIAGRAM_DIAGRAM_SCHEMA[field].required;
}

export function getRequiredDiagramNodeFields(): DiagramNodeField[] {
  return (Object.keys(DIAGRAM_NODE_SCHEMA) as DiagramNodeField[]).filter(
    (key) => DIAGRAM_NODE_SCHEMA[key].required,
  );
}

export function getRequiredDiagramFields(): DiagramField[] {
  return (Object.keys(DIAGRAM_DIAGRAM_SCHEMA) as DiagramField[]).filter(
    (key) => DIAGRAM_DIAGRAM_SCHEMA[key].required,
  );
}
