/**
 * Selection Behavior Types
 *
 * Type definitions for the selection behavior registry system.
 * These types define the structure for Excel selection behavior parity.
 *
 * IMPORTANT: This file contains TYPES ONLY - no algorithms.
 * Algorithms live in engine/src/state/utils/.
 *
 */

import type { CellRange, SheetId } from '@mog/types-core';
import type { CellCoord } from '@mog/types-viewport/rendering/primitives';

/**
 * Selection direction type.
 * Indicates the direction from the anchor (start) to the active cell (end).
 * Used for Tab/Enter cycling to determine starting position.
 *
 * Owned by selection (Tier 1). Re-exported by machines/types (Tier 2) for
 * back-compat. Previously defined in machines/types, but moving it here
 * breaks an upward Tier 1 -> Tier 2 import from selection/types.ts.
 */
export type SelectionDirection = 'down-right' | 'down-left' | 'up-right' | 'up-left';

// =============================================================================
// Selection Checkpoint (Undo/Redo)
// =============================================================================

/**
 * Selection checkpoint structure stored with each undo stack item.
 * Contains the essential selection state to restore on undo/redo.
 *
 * Used by DocumentContext to track selection state with undo operations.
 */
export interface SelectionCheckpoint {
  /** The sheet where the selection was captured */
  sheetId?: SheetId;
  /** The selected ranges */
  ranges: CellRange[];
  /** The active cell within selection */
  activeCell: CellCoord;
  /** The anchor point for extending */
  anchor: CellCoord | null;
  /** Selection direction for Tab/Enter cycling */
  direction: SelectionDirection;
}

// =============================================================================
// Feature Priority
// =============================================================================

/**
 * Implementation priority for selection features.
 */
export type SelectionFeaturePriority = 'critical' | 'high' | 'medium' | 'low';

// =============================================================================
// Selection Feature Definition
// =============================================================================

/**
 * A single selection behavior feature.
 * Used for tracking implementation status.
 */
export interface SelectionFeature {
  /** Feature name (short identifier) */
  name: string;

  /** Human-readable description */
  description: string;

  /** Whether this feature is currently implemented */
  implemented: boolean;

  /** Implementation priority */
  priority: SelectionFeaturePriority;

  /** Optional implementation notes (file locations, caveats) */
  notes?: string;
}

// =============================================================================
// Selection Registry Structure
// =============================================================================

/**
 * The complete selection behavior registry.
 * Organized by feature category.
 */
export interface SelectionRegistry {
  /** Selection modes (click, drag, shift-click, ctrl-click, etc.) */
  modes: SelectionFeature[];

  /** Data-aware navigation (Ctrl+Arrow, Ctrl+End, etc.) */
  navigation: SelectionFeature[];

  /** Special selections (Go To Special: blanks, formulas, precedents, etc.) */
  specialSelections: SelectionFeature[];

  /** Fill handle behaviors (auto-fill patterns) */
  fillHandle: SelectionFeature[];
}

// =============================================================================
// Statistics Types
// =============================================================================

/**
 * Implementation statistics for selection features.
 */
export interface SelectionImplementationStats {
  total: number;
  implemented: number;
  percentage: number;
  byCategory: Record<string, { total: number; implemented: number }>;
  byPriority: Record<string, { total: number; implemented: number }>;
}
