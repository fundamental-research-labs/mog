/**
 * Style Diagnostics Types - Domain-specific types for style validation
 *
 * This file defines types for the style domain of the Unified Diagnostics Framework.
 * Enables tracing and validation of cell formatting from XLSX → Yjs → computed/effective.
 *
 */

import type { CellFormat } from '@mog/types-core';
import type { CellCoord, DiagnosticTrace } from './core';

// =============================================================================
// Style Source (XLSX Raw Data)
// =============================================================================

/**
 * Raw XLSX style data captured during import.
 * Represents the low-level style information before resolution.
 */
export interface StyleSource {
  /** XLSX style index (xf record reference) */
  styleIndex: number | null;

  /** Fill properties from XLSX */
  fill: {
    /** XLSX fill ID (cellXfs index) */
    fillId: number | null;
    /** Pattern type (solid, darkGray, etc.) */
    patternType: string | null;
    /** Foreground color (pattern color) */
    fgColor: string | null;
    /** Background color (behind pattern) */
    bgColor: string | null;
    /** Resolved color after theme/tint application */
    resolved: string | null;
  };

  /** Font properties from XLSX */
  font: {
    /** XLSX font ID (font table index) */
    fontId: number | null;
    /** Font family name */
    name: string | null;
    /** Font size in points */
    size: number | null;
    /** Bold flag */
    bold: boolean;
    /** Italic flag */
    italic: boolean;
    /** Font color (may include theme reference) */
    color: string | null;
  };

  /** Border properties from XLSX */
  border: {
    /** XLSX border ID (border table index) */
    borderId: number | null;
    // Additional border details would go here
  };

  /** Number format properties from XLSX */
  numberFormat: {
    /** XLSX number format ID */
    numFmtId: number | null;
    /** Number format code string */
    formatCode: string | null;
  };

  /** Alignment properties from XLSX */
  alignment: {
    /** Horizontal alignment (left, center, right, etc.) */
    horizontal: string | null;
    /** Vertical alignment (top, middle, bottom, etc.) */
    vertical: string | null;
    /** Wrap text flag */
    wrapText: boolean;
  } | null;

  /** Resolved CellFormat from XLSX (after theme/style resolution) */
  resolvedFormat: CellFormat;
}

// =============================================================================
// Style Stored (Yjs Data)
// =============================================================================

/**
 * Stored style data from Yjs.
 * Includes cell, row, and column format cascades.
 */
export interface StyleStored {
  /** Cell-level format */
  cell: {
    /** Stable cell identity (null if transient) */
    cellId: string | null;
    /** Cell format (null if no cell-level format) */
    format: CellFormat | null;
  };

  /** Row-level format */
  row: {
    /** Row identity */
    rowId: string | null;
    /** Row format (null if no row-level format) */
    format: CellFormat | null;
  };

  /** Column-level format */
  col: {
    /** Column identity */
    colId: string | null;
    /** Column format (null if no column-level format) */
    format: CellFormat | null;
  };
}

// =============================================================================
// Style Computed (Effective Format)
// =============================================================================

/**
 * Computed/effective style for a cell.
 * This is the final resolved format after applying all cascades.
 */
export type StyleComputed = CellFormat;

// =============================================================================
// Style-Specific Types
// =============================================================================

/**
 * Style trace specialized for style domain.
 * Type alias for readability.
 */
export type StyleTrace = DiagnosticTrace<StyleSource, StyleStored, StyleComputed>;

/**
 * Style mismatch entry describing a difference in a specific property.
 * Used for detailed mismatch reporting.
 */
export interface StyleMismatch {
  /** Cell with mismatch */
  cell: CellCoord;
  /** Format property with mismatch */
  property: keyof CellFormat;
  /** Value from XLSX */
  xlsxValue: unknown;
  /** Value stored in Yjs */
  storedValue: unknown;
  /** Computed/effective value */
  computedValue: unknown;
}

// =============================================================================
// Style Diagnostics API
// =============================================================================

/**
 * API for style-specific diagnostic operations.
 * Provides convenience methods for common style validation tasks.
 */
export interface StyleDiagnostics {
  /**
   * Trace a single cell's style resolution.
   * Returns complete trace including source, stored, and computed data.
   *
   * @param cell - Cell coordinates or A1 reference
   * @returns Style trace
   */
  traceCell(cell: CellCoord | string): StyleTrace | Promise<StyleTrace>;

  /**
   * Find all style mismatches between XLSX and stored data.
   * Returns list of properties that differ.
   *
   * @returns Array of mismatches
   */
  findMismatches(): StyleMismatch[] | Promise<StyleMismatch[]>;

  /**
   * Find all cells with a specific XLSX style index.
   * Useful for debugging style table issues.
   *
   * @param styleIndex - XLSX style index (xf record)
   * @returns Cells using this style index
   */
  findByStyleIndex(styleIndex: number): CellCoord[];

  /**
   * Find all cells with a specific property value.
   * Searches computed (effective) styles.
   *
   * @param property - Format property name
   * @param value - Value to search for
   * @returns Cells with matching property
   */
  findByProperty(property: keyof CellFormat, value: unknown): CellCoord[] | Promise<CellCoord[]>;

  /**
   * Find all cells with a specific fill color.
   * Searches computed (effective) background colors.
   *
   * @param color - Color to search for (hex or theme reference)
   * @returns Cells with matching fill
   */
  findByFill(color: string): CellCoord[] | Promise<CellCoord[]>;

  /**
   * Get all unique fill colors used in the sheet.
   * Returns colors with usage counts and cell lists.
   *
   * @returns Array of unique fills with metadata
   */
  getUniqueFills():
    | Array<{ color: string; count: number; cells: CellCoord[] }>
    | Promise<Array<{ color: string; count: number; cells: CellCoord[] }>>;

  /**
   * Get all unique font configurations used in the sheet.
   * Returns font properties with usage counts.
   *
   * @returns Array of unique fonts with counts
   */
  getUniqueFonts():
    | Array<{ font: Partial<CellFormat>; count: number }>
    | Promise<Array<{ font: Partial<CellFormat>; count: number }>>;
}
