/**
 * Store Types
 *
 * This module exports storage types and type-level schema definitions.
 *
 * **Architecture Note:**
 * Runtime schema objects, defaults, and utility functions have been moved to kernel:
 * - @mog-sdk/kernel/defaults/sheet-meta
 * - @mog-sdk/kernel/defaults/workbook
 * - @mog-sdk/kernel/defaults/core
 * - @mog-sdk/kernel/defaults/ink
 * - @mog-sdk/kernel/defaults/diagram
 * - @mog-sdk/kernel/defaults/equation
 * - @mog-sdk/kernel/defaults/text-effects
 *
 * This module now exports only types and pure type-level definitions.
 *
 * Context types are exported from '@mog-sdk/contracts/kernel'.
 */

// Re-export kernel context types for backward compatibility
export type { IDomainContext, IKernelContext } from '../kernel';

// Store types (Task 3b)
export type {
  SerializedCellData,
  SheetMaps,
  SheetMeta,
  CellWriteData,
  RegionBounds,
  RegionKind,
  RegionMeta,
  StoreCellData,
  StoredFilterState,
  UsedRange,
} from './store-types';

// Schema-driven initialization types
export type {
  FieldDef,
  LazyInitFields,
  OptionalFields,
  RequiredFields,
  Schema,
} from './schema-types';

// SheetMaps schema (Single Source of Truth) — kept in contracts as it's pure data structure definition
export {
  SHEET_MAPS_LAZY_INIT_FIELDS,
  SHEET_MAPS_OPTIONAL_FIELDS,
  SHEET_MAPS_REQUIRED_FIELDS,
  SHEET_MAPS_SCHEMA,
} from './sheet-maps-schema';

// SheetMeta schema — type exports only (runtime moved to @mog-sdk/kernel/defaults/sheet-meta)
export type { SheetMetaField } from './sheet-meta-schema';

// WorkbookSettings schema — type exports only (runtime moved to @mog-sdk/kernel/defaults/workbook)
export type { WorkbookSettingsField } from './workbook-schema';

// Cell data schema (Single Source of Truth) — kept in contracts as it's pure data structure definition
export {
  CELL_COPYABLE_FIELDS,
  CELL_DATA_SCHEMA,
  CELL_FIELD_NAMES,
  CELL_LONG_TO_SHORT,
  CELL_SHORT_TO_LONG,
} from './cell-schema';

// Ink schema — type exports only (runtime moved to @mog-sdk/kernel/defaults/ink)
export type { ShapeRecognitionThresholds } from './ink-schema';

// Scenarios schema (What-If Analysis) — kept as pure data structure definition
export {
  MAX_CHANGING_CELLS_PER_SCENARIO,
  MAX_SCENARIOS,
  MAX_SCENARIO_COMMENT_LENGTH,
  MAX_SCENARIO_NAME_LENGTH,
  SCENARIOS_SCHEMA,
} from './scenarios-schema';
export type {
  Scenario,
  ScenarioCreateInput,
  ScenarioUpdateInput,
  ScenariosSchemaField,
} from './scenarios-schema';

// Equation schema — type exports only (runtime moved to @mog-sdk/kernel/defaults/equation)
export type { EquationStyleDefaults } from './equation-schema';

// Diagram schema — type exports only (runtime moved to @mog-sdk/kernel/defaults/diagram)
export type { DiagramField, DiagramNodeField } from './diagram-schema';

// TextEffect schema — type exports only (runtime moved to @mog-sdk/kernel/defaults/text-effects)
export type { TextEffectSchemaField } from './text-effects-schema';
