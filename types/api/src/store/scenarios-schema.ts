/**
 * Scenarios Schema - Single Source of Truth
 *
 * This schema defines the structure for What-If Analysis Scenarios.
 * Scenarios allow users to save sets of input values and switch between them
 * to compare different outcomes.
 *
 * ARCHITECTURE: Schema-Driven Initialization
 * - Scenarios are stored in Yjs for collaboration
 * - CellId (not A1) is used for stable references under structure changes
 *
 */

import type { CellId } from '@mog/types-core/cell-identity';
import type { CellValue } from '@mog/types-core';
import type { FieldDef, Schema } from './schema-types';

// =============================================================================
// Scenario Interface
// =============================================================================

/**
 * A scenario represents a saved set of input values for changing cells.
 *
 * Uses CellId (not A1) for cell references to ensure stability under
 * row/column insertions and deletions (Cell Identity Model).
 */
export interface Scenario {
  /** Unique scenario identifier (UUID) */
  id: string;
  /** User-friendly name for the scenario */
  name: string;
  /** Optional description/comment about the scenario */
  comment: string;
  /**
   * CellIds of the changing cells.
   * IMPORTANT: Use CellId (stable) instead of A1 (positional).
   */
  changingCells: CellId[];
  /**
   * Values for each changing cell, in same order as changingCells.
   * These are the "what-if" values that get applied when the scenario is shown.
   */
  values: CellValue[];
  /** User who created the scenario (optional for collaboration) */
  createdBy?: string;
  /** Timestamp when the scenario was created */
  createdAt: number;
  /** Timestamp when the scenario was last modified */
  modifiedAt?: number;
}

/**
 * Input type for creating a new scenario.
 * Omits auto-generated fields (id, createdAt).
 */
export type ScenarioCreateInput = Omit<Scenario, 'id' | 'createdAt'>;

/**
 * Input type for updating an existing scenario.
 */
export type ScenarioUpdateInput = Partial<Omit<Scenario, 'id' | 'createdAt'>>;

// =============================================================================
// Scenarios Schema (Yjs Structure)
// =============================================================================

/**
 * SINGLE SOURCE OF TRUTH for scenarios Yjs structure.
 *
 * Scenarios are stored as a Y.Array at workbook level (not per-sheet).
 * This matches Excel behavior where scenarios apply to the entire workbook.
 */
export const SCENARIOS_SCHEMA = {
  /**
   * Array of all scenarios in the workbook.
   * Stored as Y.Array<Scenario> for CRDT collaboration.
   */
  scenarios: {
    type: 'Y.Array',
    required: false,
    copy: 'deep',
    lazyInit: true,
    default: [],
  } as const satisfies FieldDef,
} as const satisfies Schema;

// =============================================================================
// Type Exports
// =============================================================================

/**
 * Type for the schema keys - all valid scenario field names.
 */
export type ScenariosSchemaField = keyof typeof SCENARIOS_SCHEMA;

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum number of scenarios allowed per workbook (Excel limit).
 */
export const MAX_SCENARIOS = 251;

/**
 * Maximum number of changing cells per scenario (Excel limit).
 */
export const MAX_CHANGING_CELLS_PER_SCENARIO = 32;

/**
 * Maximum length of scenario name.
 */
export const MAX_SCENARIO_NAME_LENGTH = 255;

/**
 * Maximum length of scenario comment.
 */
export const MAX_SCENARIO_COMMENT_LENGTH = 255;
