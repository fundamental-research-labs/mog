/**
 * SINGLE SOURCE OF TRUTH for SheetMaps structure.
 *
 * All creation, copying, and lazy-initialization derived from this schema.
 * Adding a new field requires ONLY updating this schema.
 *
 */

import type { Schema } from './schema-types';

/**
 * Schema defining all fields in SheetMaps.
 *
 * Field categories:
 * - Core Cell Data: meta, cells, properties, grid
 * - Row Identity Model: rows, rowIndex, rowHeights, rowFormats
 * - Column Identity Model: cols, colIndex, colWidths, colFormats
 * - Column Schemas: schemas, rangeSchemas
 * - Structure Features: merges, hiddenRows, hiddenCols, tables, groupingConfig
 * - Floating Objects: charts, floatingObjects, floatingObjectGroups
 * - Interactive Features (lazy): formControls, filters, comments, slicers
 */
export const SHEET_MAPS_SCHEMA = {
  // ===========================================================================
  // Core Cell Data
  // ===========================================================================

  meta: {
    type: 'Y.Map',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  cells: {
    type: 'Y.Map',
    valueType: 'SerializedCellData',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  properties: {
    type: 'Y.Map',
    valueType: 'CellProperties',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  grid: {
    type: 'Y.Map',
    valueType: 'CellId',
    required: true,
    copy: 'shallow', // CellIds are strings
    lazyInit: true, // Migration: old docs may lack grid
  },

  // ===========================================================================
  // Row Identity Model (CRITICAL - was missing in create/copy!)
  // ===========================================================================

  rows: {
    type: 'Y.Map',
    valueType: 'RowData',
    required: true, // NOW REQUIRED
    copy: 'deep',
    lazyInit: true, // Migration for old docs
  },
  rowIndex: {
    type: 'Y.Map',
    valueType: 'RowId',
    required: true, // NOW REQUIRED
    copy: 'shallow',
    lazyInit: true,
  },
  rowHeights: {
    type: 'Y.Map',
    valueType: 'number',
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },
  rowFormats: {
    type: 'Y.Map',
    valueType: 'CellFormat',
    required: true, // NOW REQUIRED
    copy: 'deep',
    lazyInit: true,
  },

  // ===========================================================================
  // Column Identity Model (CRITICAL - was missing in create/copy!)
  // ===========================================================================

  cols: {
    type: 'Y.Map',
    valueType: 'ColData',
    required: true, // NOW REQUIRED
    copy: 'deep',
    lazyInit: true, // Migration for old docs
  },
  colIndex: {
    type: 'Y.Map',
    valueType: 'ColId',
    required: true, // NOW REQUIRED
    copy: 'shallow',
    lazyInit: true,
  },
  colWidths: {
    type: 'Y.Map',
    valueType: 'number',
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },
  colFormats: {
    type: 'Y.Map',
    valueType: 'CellFormat',
    required: true, // NOW REQUIRED
    copy: 'deep',
    lazyInit: true,
  },
  colFormatRanges: {
    type: 'Y.Map',
    valueType: 'ColumnFormatRange',
    required: true,
    copy: 'deep',
    lazyInit: true,
  },

  // ===========================================================================
  // Column Schemas
  // ===========================================================================

  schemas: {
    type: 'Y.Map',
    valueType: 'ColumnSchema',
    required: true,
    copy: 'deep',
    lazyInit: false,
  },
  rangeSchemas: {
    type: 'Y.Map',
    valueType: 'RangeSchema',
    required: true, // Fix: was missing
    copy: 'deep',
    lazyInit: true,
  },

  // ===========================================================================
  // Structure Features
  // ===========================================================================

  merges: {
    type: 'Y.Map',
    valueType: 'IdentityMergedRegion',
    required: true,
    copy: 'deep',
    lazyInit: true,
  },
  hiddenRows: {
    type: 'Y.Array',
    valueType: 'number',
    required: true, // Fix: was missing
    copy: 'deep',
    lazyInit: true,
  },
  manualHiddenRows: {
    type: 'Y.Map',
    valueType: 'true',
    required: true,
    copy: 'deep',
    lazyInit: true,
  },
  filterHiddenRows: {
    type: 'Y.Map',
    valueType: 'Y.Map',
    required: true,
    copy: 'deep',
    lazyInit: true,
  },
  hiddenCols: {
    type: 'Y.Array',
    valueType: 'number',
    required: true, // Fix: was missing
    copy: 'deep',
    lazyInit: true,
  },
  tables: {
    type: 'Y.Map',
    valueType: 'TableConfig',
    required: true, // Fix: was missing
    copy: 'deep',
    lazyInit: true,
  },
  groupingConfig: {
    type: 'Y.Map',
    required: true, // Fix: was missing
    copy: 'deep',
    lazyInit: true,
  },

  // ===========================================================================
  // Floating Objects
  // ===========================================================================

  charts: {
    type: 'Y.Map',
    valueType: 'FloatingObject',
    required: true,
    copy: 'deep', // Note: charts.copy() generates new IDs - special handling needed
    lazyInit: false,
  },
  floatingObjects: {
    type: 'Y.Map',
    valueType: 'FloatingObject',
    required: true, // Fix: was missing
    copy: 'deep',
    lazyInit: true,
  },
  floatingObjectGroups: {
    type: 'Y.Map',
    valueType: 'FloatingObjectGroup',
    required: true, // Fix: was missing
    copy: 'deep',
    lazyInit: true,
  },

  // ===========================================================================
  // Interactive Features (lazy-init on first use)
  // ===========================================================================

  formControls: {
    type: 'Y.Map',
    valueType: 'FormControl',
    required: false, // Lazy
    copy: 'deep',
    lazyInit: true,
  },
  filters: {
    type: 'Y.Map',
    valueType: 'StoredFilterState',
    required: false, // Lazy
    copy: 'deep',
    lazyInit: true,
  },
  comments: {
    type: 'Y.Map',
    valueType: 'Comment',
    required: false, // Lazy
    copy: 'deep',
    lazyInit: true,
  },
  slicers: {
    type: 'Y.Map',
    valueType: 'StoredSlicerConfig',
    required: false, // Lazy
    copy: 'deep',
    lazyInit: true,
  },
  dataBindings: {
    type: 'Y.Map',
    valueType: 'DataBinding',
    required: false, // Lazy
    copy: 'deep',
    lazyInit: true,
  },
} as const satisfies Schema;

// =============================================================================
// Type-safe field lists derived from schema
// =============================================================================

/**
 * List of all required fields that must be created during sheet initialization.
 */
export const SHEET_MAPS_REQUIRED_FIELDS = Object.entries(SHEET_MAPS_SCHEMA)
  .filter(([_, def]) => def.required)
  .map(([key]) => key);

/**
 * List of all fields that support lazy initialization for migration.
 */
export const SHEET_MAPS_LAZY_INIT_FIELDS = Object.entries(SHEET_MAPS_SCHEMA)
  .filter(([_, def]) => def.lazyInit)
  .map(([key]) => key);

/**
 * List of all optional (non-required) fields.
 */
export const SHEET_MAPS_OPTIONAL_FIELDS = Object.entries(SHEET_MAPS_SCHEMA)
  .filter(([_, def]) => !def.required)
  .map(([key]) => key);
