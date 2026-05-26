/**
 * Format Property Registry - Types Only
 *
 * Runtime code (FORMAT_PROPERTY_REGISTRY constant, query functions)
 * has been moved to @mog-sdk/kernel/domain/formatting/format-registry.
 *
 * This file retains only type definitions.
 *
 */

// =============================================================================
// Format Property Status Types
// =============================================================================

/**
 * Implementation status for a format property
 */
export interface FormatPropertyStatus {
  /** Property is defined in contracts/src/core.ts CellFormat */
  contract: boolean;
  /** Property is imported from XLSX (format-mapper.ts) */
  import: boolean;
  /** Property is exported to XLSX (exporter.ts) */
  export: boolean;
  /** Property is rendered in canvas (cell-layer.ts) */
  render: boolean;
}

/**
 * A single format property definition
 */
export interface FormatPropertyDef {
  /** Category of the property */
  category: FormatCategory;
  /** Our internal property name (in CellFormat) */
  property: string;
  /** ExcelJS field path (e.g., 'font.bold', 'alignment.textRotation') */
  excelJSField: string;
  /** Human-readable description */
  description: string;
  /** Implementation status */
  status: FormatPropertyStatus;
  /** Notes about implementation */
  notes?: string;
}

/**
 * Format property categories matching Excel's format dialog
 */
export type FormatCategory =
  | 'font'
  | 'alignment'
  | 'fill'
  | 'borders'
  | 'numberFormat'
  | 'protection';
