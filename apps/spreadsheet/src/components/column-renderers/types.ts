/**
 * Column Renderer Types
 *
 * Shared renderers for different column types.
 * Used by Grid, Kanban, Gallery, Form, and other views.
 *
 * Each column type provides:
 * - render(): Display value (read-only)
 * - editor: Edit component (for inline editing)
 * - cardField: Compact display for cards (Kanban/Gallery)
 * - formField: Form input field
 *
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import type { ComponentType, ReactNode } from 'react';
import type { ColumnSchema, ColumnTypeKind } from '../../domain/clipboard/types';

// =============================================================================
// Column Type Value Types
// =============================================================================

/**
 * Value types for each column kind.
 * Maps column type to its expected value type.
 */
export interface ColumnValueTypes {
  text: string | null;
  number: number | null;
  date: string | number | null; // ISO string or Excel serial
  select: string | string[] | null; // Option ID(s)
  checkbox: boolean | null;
  person: string | string[] | null; // User ID(s)
  file: FileAttachment | FileAttachment[] | null;
  url: string | null;
  email: string | null;
  phone: string | null;
  rating: number | null; // 1-5 typically
  progress: number | null; // 0-1 or 0-100
  relation: string | string[] | null; // Related row ID(s)
  lookup: CellValue; // Any value (computed)
  rollup: number | null; // Aggregated value
  formula: CellValue; // Any value (computed)
  createdTime: number | null; // Timestamp
  modifiedTime: number | null; // Timestamp
  createdBy: string | null; // User ID
  modifiedBy: string | null; // User ID
  autoNumber: number | null;
}

/**
 * File attachment type.
 */
export interface FileAttachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
  thumbnailUrl?: string;
}

/**
 * Person/User type.
 */
export interface PersonInfo {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

// =============================================================================
// Editor Props
// =============================================================================

/**
 * Props for column editor components.
 * Used for inline cell editing.
 */
export interface ColumnEditorProps<T extends ColumnTypeKind = ColumnTypeKind> {
  /** Current value */
  value: ColumnValueTypes[T];
  /** Column schema with type-specific config */
  column: ColumnSchema;
  /** Called when value changes (for preview).
   * Uses method syntax so that ColumnEditorProps<'text'> is bivariantly
   * assignable to ColumnEditorProps<ColumnTypeKind>. */
  onChange(value: ColumnValueTypes[T]): void;
  /** Called when editing is complete (commit value) */
  onCommit(): void;
  /** Called when editing is cancelled */
  onCancel(): void;
  /** Whether to auto-focus the editor */
  autoFocus?: boolean;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Additional class name */
  className?: string;
}

// =============================================================================
// Card Field Props
// =============================================================================

/**
 * Props for card field display (Kanban/Gallery cards).
 * More compact than table cell display.
 */
export interface CardFieldProps<T extends ColumnTypeKind = ColumnTypeKind> {
  /** Current value */
  value: ColumnValueTypes[T];
  /** Column schema */
  column: ColumnSchema;
  /** Compact mode (even smaller display) */
  compact?: boolean;
  /** Additional class name */
  className?: string;
}

// =============================================================================
// Form Field Props
// =============================================================================

/**
 * Props for form field components.
 * Full form input with labels, validation, etc.
 */
export interface FormFieldProps<T extends ColumnTypeKind = ColumnTypeKind> {
  /** Current value */
  value: ColumnValueTypes[T];
  /** Column schema */
  column: ColumnSchema;
  /** Called when value changes.
   * Uses method syntax so that FormFieldProps<'text'> is bivariantly
   * assignable to FormFieldProps<ColumnTypeKind>. */
  onChange(value: ColumnValueTypes[T]): void;
  /** Validation error message */
  error?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Whether the field is required */
  required?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Additional class name */
  className?: string;
}

// =============================================================================
// Column Renderer Interface
// =============================================================================

/**
 * Column renderer definition.
 *
 * The generic parameter T narrows value types at definition sites (e.g.,
 * TextRenderer uses ColumnRenderer<'text'> to get string | null values).
 *
 * At consumption sites (registry, getRenderer), use the non-generic default
 * (T = ColumnTypeKind) which accepts the union of all value types.
 *
 * The render method and component properties all use bivariant
 * method/call-signature syntax, so ColumnRenderer<'text'> is assignable
 * to the base ColumnRenderer (default T = ColumnTypeKind) without casts.
 */
export interface ColumnRenderer<T extends ColumnTypeKind = ColumnTypeKind> {
  /**
   * Display value (read-only).
   * Used in table cells, read-only views, etc.
   */
  render(value: ColumnValueTypes[T], column: ColumnSchema): ReactNode;

  /**
   * Edit component for inline editing.
   * Shows when user double-clicks a cell or presses Enter.
   */
  editor: ComponentType<ColumnEditorProps<T>>;

  /**
   * Card field display component (optional).
   * Used in Kanban cards, Gallery cards, etc.
   * Falls back to render() if not provided.
   */
  cardField?: ComponentType<CardFieldProps<T>>;

  /**
   * Form field component (optional).
   * Used in Form view for data entry.
   * Falls back to editor if not provided.
   */
  formField?: ComponentType<FormFieldProps<T>>;
}

// =============================================================================
// Renderer Registry Type
// =============================================================================

/**
 * Registry mapping each column type to its specifically-typed renderer.
 * Useful for type-safe construction; for runtime lookup, use
 * Record<ColumnTypeKind, ColumnRenderer> instead.
 */
export type ColumnRendererRegistry = {
  [K in ColumnTypeKind]: ColumnRenderer<K>;
};

// =============================================================================
// Helper Types
// =============================================================================

/**
 * Extract the value type for a column kind.
 */
export type ValueForColumn<T extends ColumnTypeKind> = ColumnValueTypes[T];

/**
 * Props for the generic CellDisplay component.
 */
export interface CellDisplayProps {
  /** Cell value */
  value: CellValue;
  /** Column schema (determines renderer) */
  column: ColumnSchema;
  /** Additional class name */
  className?: string;
}

/**
 * Props for the generic CellEditor component.
 */
export interface CellEditorProps {
  /** Cell value */
  value: CellValue;
  /** Column schema (determines editor) */
  column: ColumnSchema;
  /** Called when value changes */
  onChange: (value: CellValue) => void;
  /** Called when editing is complete */
  onCommit: () => void;
  /** Called when editing is cancelled */
  onCancel: () => void;
  /** Whether to auto-focus */
  autoFocus?: boolean;
  /** Whether disabled */
  disabled?: boolean;
  /** Additional class name */
  className?: string;
}

// =============================================================================
// Format Options
// =============================================================================

/**
 * Number format options.
 */
export interface NumberFormatOptions {
  /** Number of decimal places */
  decimals?: number;
  /** Thousands separator */
  useThousandsSeparator?: boolean;
  /** Prefix (e.g., '$') */
  prefix?: string;
  /** Suffix (e.g., '%') */
  suffix?: string;
  /** Whether to show negative in parentheses */
  negativeInParentheses?: boolean;
}

/**
 * Date format options.
 */
export interface DateFormatOptions {
  /** Date format string (e.g., 'MM/DD/YYYY') */
  format?: string;
  /** Whether to include time */
  includeTime?: boolean;
  /** Time format (12 or 24 hour) */
  timeFormat?: '12h' | '24h';
}

/**
 * Rating options.
 */
export interface RatingOptions {
  /** Maximum rating (default 5) */
  max?: number;
  /** Allow half stars */
  allowHalf?: boolean;
  /** Empty icon */
  emptyIcon?: ReactNode;
  /** Filled icon */
  filledIcon?: ReactNode;
}

/**
 * Progress options.
 */
export interface ProgressOptions {
  /** Show percentage label */
  showLabel?: boolean;
  /** Color (CSS color string or named color) */
  color?: string;
  /** Height in pixels */
  height?: number;
}
