/**
 * Schema-Driven Initialization Types
 *
 * These types define how Yjs structures are specified declaratively.
 * All creation, copying, and lazy-init is derived from schemas.
 *
 * ARCHITECTURE: Single Source of Truth
 * - Field definitions are declared ONCE in a schema
 * - createFromSchema() derives structure initialization
 * - copyFromSchema() derives copy behavior
 * - ensureLazyFields() derives migration behavior
 *
 * This eliminates:
 * - Manual field enumeration in multiple places
 * - Divergent copy vs init logic
 * - Missing fields in new code paths
 *
 */

/**
 * Field definition for a single property in a Yjs structure.
 *
 * This is the atomic unit of schema definition. Each field specifies:
 * - type: What Yjs type (or primitive) this field holds
 * - valueType: For Maps/Arrays, the type of contained values (documentation)
 * - required: Whether to create on structure init
 * - copy: How to handle this field during copy operations
 * - lazyInit: Whether to auto-create if missing (for migration)
 * - default: Default value for primitives
 */
export interface FieldDef {
  /**
   * The Yjs type or primitive indicator.
   * - 'Y.Map': Creates new Y.Map()
   * - 'Y.Array': Creates new Y.Array()
   * - 'Y.Text': Creates new Y.Text()
   * - 'primitive': Uses the default value directly
   */
  type: 'Y.Map' | 'Y.Array' | 'Y.Text' | 'primitive';

  /**
   * Documentation of the value type for Y.Map and Y.Array.
   * Example: 'SerializedCellData' for cells map, 'number' for heights map.
   * This is for documentation only - TypeScript cannot enforce Yjs internals.
   */
  valueType?: string;

  /**
   * Short name for CRDT storage efficiency (optional).
   * Used by Cell Data schema where 'raw' -> 'r', 'formula' -> 'f', etc.
   * If not specified, the long name (schema key) is used as-is.
   *
   * This is for documentation/mapping purposes. The actual Yjs storage
   * uses the short name, while the API/runtime uses the long name (schema key).
   */
  shortName?: string;

  /**
   * Whether this field is required during structure creation.
   * - true: Created by createFromSchema()
   * - false: Only created on demand or via lazyInit
   */
  required: boolean;

  /**
   * Copy strategy for this field.
   * - 'deep': Deep copy (JSON.parse/stringify for plain objects, recursive for Yjs)
   * - 'shallow': Shallow reference copy (same object)
   * - 'skip': Don't copy this field (omit from result)
   */
  copy: 'deep' | 'shallow' | 'skip';

  /**
   * Whether to auto-create this field if missing.
   * Used for migration: old documents may lack new fields.
   * ensureLazyFields() creates fields where lazyInit=true and field is missing.
   */
  lazyInit: boolean;

  /**
   * Default value for primitive fields.
   * Only used when type='primitive'.
   */
  default?: unknown;
}

/**
 * A schema is a record of field names to their definitions.
 * This is the single source of truth for a Yjs structure's shape.
 *
 * Example:
 * ```typescript
 * const SHEET_MAPS_SCHEMA = {
 *   meta: { type: 'Y.Map', required: true, copy: 'deep', lazyInit: false },
 *   cells: { type: 'Y.Map', valueType: 'SerializedCellData', required: true, copy: 'deep', lazyInit: false },
 *   // ... etc
 * } as const satisfies Schema;
 * ```
 */
export type Schema = Record<string, FieldDef>;

/**
 * Type utility to extract required field names from a schema.
 * Useful for type-safe iteration over required fields.
 */
export type RequiredFields<S extends Schema> = {
  [K in keyof S]: S[K]['required'] extends true ? K : never;
}[keyof S];

/**
 * Type utility to extract optional (non-required) field names from a schema.
 */
export type OptionalFields<S extends Schema> = {
  [K in keyof S]: S[K]['required'] extends false ? K : never;
}[keyof S];

/**
 * Type utility to extract lazy-init field names from a schema.
 */
export type LazyInitFields<S extends Schema> = {
  [K in keyof S]: S[K]['lazyInit'] extends true ? K : never;
}[keyof S];
