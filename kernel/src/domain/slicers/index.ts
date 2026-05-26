/**
 * Slicers Domain Module
 *
 * Slicers Domain Layer
 *
 * This module implements:
 * - ES.4: Slicer CRUD operations (create, read, update, delete)
 * - ES.5: Slicer -> Filter bridge (selection changes -> filter application)
 * - ES.6: Cache invalidation via EventBus
 *
 * ARCHITECTURE (Cell Identity Model):
 *
 * Slicers use CellId for column references, NOT column index. This follows
 * the same pattern as:
 * - IdentityRangeRef (formulas)
 * - StoredFilterState (filters)
 * - IdentityMergedRegion (merged cells)
 *
 * Why CellId-based?
 * - Survives row/col insert/delete (positions change, CellIds stable)
 * - CRDT-safe for concurrent structure changes
 * - Matches the Cell Identity Model used throughout the codebase
 *
 * Bridge pattern:
 *   User Selection -> SlicerConfig -> Slicer Bridge -> Filter System -> Row Visibility
 *
 * The slicer does NOT store its own selection state separately from filters.
 * Selection state is derived from the underlying filter - single source of truth.
 *
 * @see docs/architecture/cell-identity.md
 */

// Re-export types for consumers
export * from './types';

// CRUD operations (ES.4)
export * from './crud';

// Table binding operations (ES.5 - connection & resolution)
export * from './table-binding';

// Selection operations (ES.5 - selection state via filter bridge)
export * from './selection';

// Cache operations (ES.6)
export * from './cache';

// Timeline operations
export * from './timeline';
