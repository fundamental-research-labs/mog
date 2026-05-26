/**
 * Column Renderer Registry
 *
 * Maps column types to their renderers.
 * Provides lookup functions for getting renderers by type.
 */

import type { ColumnTypeKind } from '../../domain/clipboard/types';
import type { ColumnRenderer } from './types';

import { CheckboxRenderer } from './renderers/checkbox-renderer';
import { DateRenderer } from './renderers/date-renderer';
import { EmailRenderer } from './renderers/email-renderer';
import { FileRenderer } from './renderers/file-renderer';
import { NumberRenderer } from './renderers/number-renderer';
import { PersonRenderer } from './renderers/person-renderer';
import { PhoneRenderer } from './renderers/phone-renderer';
import { ProgressRenderer } from './renderers/progress-renderer';
import { RatingRenderer } from './renderers/rating-renderer';
import { SelectRenderer } from './renderers/select-renderer';
import { TextRenderer } from './renderers/text-renderer';
import { UrlRenderer } from './renderers/url-renderer';

// =============================================================================
// Column Renderer Registry
// =============================================================================

/**
 * Internal registry map type.
 *
 * The registry stores heterogeneous renderers (e.g., TextRenderer may serve
 * as fallback for formula/lookup/relation columns). Because renderers are
 * reused across column types, we cannot use a strictly-mapped type like
 * { [K in ColumnTypeKind]: ColumnRenderer<K> }.
 *
 * Instead, we use a builder function that accepts each ColumnRenderer<K>
 * for its matching key, then returns the type-erased map. TypeScript's
 * bivariant method/call-signature checking ensures ColumnRenderer<'text'>
 * is assignable to ColumnRenderer — no unsafe casts needed.
 */

/**
 * Build a renderer map in a type-safe way.
 *
 * Each entry is typed as ColumnRenderer for its own key, so TypeScript
 * verifies each renderer's structure. The returned map is typed as the
 * base ColumnRenderer for uniform consumption.
 */
function buildRendererMap<M extends { [K in keyof M & ColumnTypeKind]: ColumnRenderer<K> }>(
  map: M,
): Partial<Record<ColumnTypeKind, ColumnRenderer>> {
  return map;
}

/**
 * Registry of all column renderers.
 *
 * Maps column type kind to its renderer implementation.
 * New column types should be added here.
 */
const typedRenderers = buildRendererMap({
  text: TextRenderer,
  number: NumberRenderer,
  date: DateRenderer,
  select: SelectRenderer,
  checkbox: CheckboxRenderer,
  person: PersonRenderer,
  file: FileRenderer,
  url: UrlRenderer,
  email: EmailRenderer,
  phone: PhoneRenderer,
  rating: RatingRenderer,
  progress: ProgressRenderer,
});

/**
 * Full registry including computed/system column fallbacks.
 * Computed columns reuse renderers from base types (e.g., formula uses TextRenderer).
 */
export const COLUMN_RENDERERS: Partial<Record<ColumnTypeKind, ColumnRenderer>> = {
  ...typedRenderers,

  // Computed/system columns (use base renderers as fallback)
  // These will be read-only in most cases
  formula: typedRenderers.text,
  lookup: typedRenderers.text,
  rollup: typedRenderers.number,
  createdTime: typedRenderers.date,
  modifiedTime: typedRenderers.date,
  createdBy: typedRenderers.person,
  modifiedBy: typedRenderers.person,
  autoNumber: typedRenderers.number,

  // Relation columns (need special handling - use TextRenderer for now)
  relation: typedRenderers.text,
};

// =============================================================================
// Registry Functions
// =============================================================================

/**
 * Get renderer for a column type.
 * Falls back to TextRenderer for unknown types.
 *
 * Returns the base ColumnRenderer type since the registry is looked up
 * by runtime ColumnTypeKind values, not compile-time literal types.
 *
 * @param columnType - The column type kind
 * @returns The column renderer
 */
export function getRenderer(columnType: ColumnTypeKind): ColumnRenderer {
  const renderer = COLUMN_RENDERERS[columnType];
  if (renderer) {
    return renderer;
  }
  // Fall back to text renderer for unknown/unregistered types.
  // Use the registry entry (not TextRenderer directly) to get the
  // correct base ColumnRenderer type without a cast.
  const fallback = COLUMN_RENDERERS['text'];
  if (fallback) {
    return fallback;
  }
  // Should never happen — text is always registered.
  throw new Error(
    `No renderer registered for column type "${columnType}" and no fallback available`,
  );
}

/**
 * Check if a column type has a registered renderer.
 *
 * @param columnType - The column type kind
 * @returns true if a renderer is registered
 */
export function hasRenderer(columnType: ColumnTypeKind): boolean {
  return columnType in COLUMN_RENDERERS;
}

/**
 * Get all registered column types.
 *
 * @returns Array of registered column type kinds
 */
export function getRegisteredTypes(): ColumnTypeKind[] {
  return Object.keys(COLUMN_RENDERERS) as ColumnTypeKind[];
}

/**
 * Register a custom column renderer.
 * Useful for extending the system with new column types.
 *
 * @param columnType - The column type kind
 * @param renderer - The renderer to register
 */
export function registerRenderer(columnType: ColumnTypeKind, renderer: ColumnRenderer): void {
  COLUMN_RENDERERS[columnType] = renderer;
}
