/**
 * Cell Rendering Types
 *
 * Per-cell computed data collected in pass 1 (measure), reused in pass 2 (draw).
 * CellRenderInfo is per-frame: cleared and rebuilt each render call.
 *
 * @module grid-renderer/cells/types
 */

import type { CellFormat } from '@mog-sdk/contracts/core';

// =============================================================================
// Cell Render Info
// =============================================================================

/**
 * Per-cell computed data collected in pass 1, reused in pass 2.
 * IMPORTANT: CellRenderInfo is per-frame (cleared and rebuilt each render call).
 */
export interface CellRenderInfo {
  /** Sheet row index (0-based) */
  row: number;
  /** Sheet column index (0-based) */
  col: number;
  /** Cell left edge in canvas pixels */
  x: number;
  /** Cell top edge in canvas pixels */
  y: number;
  /** Cell width in canvas pixels */
  width: number;
  /** Cell height in canvas pixels */
  height: number;
  /** Raw cell value (number, string, boolean, error, null, etc.) */
  value: unknown;
  /** Resolved cell format (static + table + CF merged) */
  format: CellFormat | undefined;
  /** Formatted display text (number-formatted, show-formulas, etc.) */
  displayText: string;
  /** Whether this cell is currently being edited */
  isEditing: boolean;
  /** Merge info (present only if cell is part of a merged range) */
  merge?: {
    originRow: number;
    originCol: number;
    mergeWidth: number;
    mergeHeight: number;
    mergeX: number;
    mergeY: number;
  };
}

export interface CenterAcrossSourceCell extends CellRenderInfo {
  /** Formatted display text used by the cells text path. */
  displayText: string;
  /** Optional value type from the viewport/wire payload when available. */
  valueType?: string;
  /** Raw source value when distinct from the formatted display value. */
  rawValue?: unknown;
  /** Rich text payload from the source cell, if present. */
  richTextRuns?: readonly unknown[];
  /** Hyperlink payload when it affects text styling. */
  hyperlink?: unknown;
  /** Conditional-format font color override for text rendering. */
  conditionalFontColorOverride?: string | null;
  /** Measurement/cache identity for text layout. */
  measurementKey?: string;
}

export interface CenterAcrossRenderSpan {
  row: number;
  sourceCol: number;
  startCol: number;
  endCol: number;
  sourceCell: CenterAcrossSourceCell;
}

export interface CenterAcrossSpanProvider {
  getCenterAcrossSpans(
    paneId: string,
    row: number,
    startCol: number,
    endCol: number,
  ): readonly CenterAcrossRenderSpan[];
}
