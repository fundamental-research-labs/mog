/**
 * Form View Configuration
 *
 * Defines the configuration type and defaults for Form views.
 * Form view provides a data entry interface for creating/editing records.
 */

import type { ColId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import type { ColumnSchema, ColumnTypeKind, SelectOption } from '../../domain/clipboard/types';
import type { TableId, ViewConfigBase, ViewId } from '../types';

/**
 * Form layout options.
 */
export type FormLayout = 'single' | 'two-column';

/**
 * Configuration for a single form field.
 */
export interface FormFieldConfig {
  /** Column ID this field maps to */
  colId: ColId;
  /** Column type (determines which field component to render) */
  columnType?: ColumnTypeKind;
  /** Override label (defaults to column name) */
  label?: string;
  /** Placeholder text for empty fields */
  placeholder?: string;
  /** Help text shown below the field */
  helpText?: string;
  /** Whether field is required (overrides column schema) */
  required?: boolean;
  /** Whether field is hidden (pre-filled but not shown) */
  hidden?: boolean;
  /** Default value for new records */
  defaultValue?: CellValue;
  /** Select options (for select columns) */
  options?: SelectOption[];
  /** Full column schema (for advanced field rendering) */
  columnSchema?: ColumnSchema;
}

/**
 * Full Form view configuration.
 */
export interface FormViewConfig extends ViewConfigBase {
  /** Form title displayed at the top */
  title: string;

  /** Optional description below the title */
  description?: string;

  /** Fields to include in the form */
  fields: FormFieldConfig[];

  /** Submit button text */
  submitButtonText: string;

  /** Message shown after successful submission */
  successMessage: string;

  /** Whether to show asterisk on required fields */
  showRequiredIndicator: boolean;

  /** Form layout: single column or two columns */
  layout: FormLayout;
}

/**
 * Default Form view configuration.
 */
export const DEFAULT_FORM_CONFIG: Partial<FormViewConfig> = {
  title: 'New Record',
  fields: [],
  submitButtonText: 'Create',
  successMessage: 'Record created successfully!',
  showRequiredIndicator: true,
  layout: 'single',
};

/**
 * Create a full Form config from partial input.
 */
export function createFormConfig(
  viewId: ViewId,
  sheetId: SheetId,
  tableId: TableId,
  fields: FormFieldConfig[],
  partial: Partial<FormViewConfig> = {},
): FormViewConfig {
  return {
    viewId,
    sheetId,
    tableId,
    title: partial.title ?? 'New Record',
    description: partial.description,
    fields,
    submitButtonText: partial.submitButtonText ?? 'Create',
    successMessage: partial.successMessage ?? 'Record created successfully!',
    showRequiredIndicator: partial.showRequiredIndicator ?? true,
    layout: partial.layout ?? 'single',
  };
}
