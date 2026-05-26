/**
 * Form View Adapter
 *
 * Implements the ViewAdapter interface for Form views.
 * Form view is write-focused (creating records) with minimal selection support.
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import { toColId, toRowId, type ColId, type RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellFormat, CellValue } from '@mog-sdk/contracts/core';
import type { ClipboardPayload, ColumnSchema, ColumnTypeKind } from '../../domain/clipboard/types';
import {
  clipboardCellValueToText,
  fromClipboardCellValue,
  toClipboardCellValue,
} from '../../domain/clipboard/cell-value-contract';
import type {
  TableId,
  ToolbarContext,
  ViewAdapter,
  ViewAdapterConfig,
  ViewId,
  ViewSelection,
} from '../types';
import type { FormFieldConfig, FormViewConfig } from './config';
import {
  validateEmail,
  validateNumberRange,
  validateRequired,
  validateUrl,
  type ValidationResult,
} from './utils/validation';

/**
 * Form-specific selection data.
 * Form typically doesn't have traditional selection - it tracks the current editing record.
 */
export interface FormSelection {
  /** Row ID of the record being edited (null for new record) */
  editingRowId: RowId | null;
  /** Currently focused field */
  focusedField: ColId | null;
}

/**
 * Form field state.
 */
export interface FormFieldState {
  value: CellValue;
  isDirty: boolean;
  error: string | null;
}

export class FormViewAdapter implements ViewAdapter {
  readonly viewId: ViewId;
  readonly viewType = 'form' as const;

  private formConfig: FormViewConfig;
  private workbook: Workbook;
  private tableId: TableId;

  // Form state
  private editingRowId: RowId | null = null;
  private focusedField: ColId | null = null;
  private fieldValues = new Map<ColId, CellValue>();
  private fieldErrors = new Map<ColId, string>();
  private isDirty = false;

  // Listeners
  private selectionListeners = new Set<(selection: ViewSelection) => void>();
  private toolbarListeners = new Set<(ctx: ToolbarContext) => void>();

  constructor(config: ViewAdapterConfig<'form'>) {
    this.viewId = config.viewId;
    this.formConfig = config.config as FormViewConfig;
    this.workbook = config.workbook;
    this.tableId = config.tableId ?? (this.formConfig.tableId as TableId);

    // Initialize with default values
    this.initializeFieldValues();
  }

  private initializeFieldValues(): void {
    this.fieldValues.clear();
    this.fieldErrors.clear();

    for (const field of this.formConfig.fields) {
      if (field.defaultValue !== undefined) {
        this.fieldValues.set(field.colId, field.defaultValue);
      } else {
        this.fieldValues.set(field.colId, null);
      }
    }

    this.isDirty = false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Selection Contract
  // ═══════════════════════════════════════════════════════════════════════════

  getSelection(): ViewSelection {
    return {
      type: 'form',
      data: {
        editingRowId: this.editingRowId,
        focusedField: this.focusedField,
      } as FormSelection,
    };
  }

  clearSelection(): void {
    this.focusedField = null;
    this.notifySelectionChange();
  }

  selectAll(): void {
    // Form doesn't support select all in the traditional sense
    // Could potentially select all text in the focused field
  }

  onSelectionChange(listener: (selection: ViewSelection) => void): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  /**
   * Set the focused field.
   */
  focusField(colId: ColId): void {
    this.focusedField = colId;
    this.notifySelectionChange();
  }

  private notifySelectionChange(): void {
    const selection = this.getSelection();
    for (const listener of this.selectionListeners) {
      listener(selection);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Clipboard Contract (uses canonical ClipboardPayload format)
  // ═══════════════════════════════════════════════════════════════════════════

  getClipboardPayload(): ClipboardPayload {
    // Form exports current field values as a single record row
    const colIds = this.formConfig.fields.filter((f) => !f.hidden).map((f) => f.colId);

    // Build 2D cell values array (single row)
    const cellValues: CellValue[][] = [
      colIds.map((colId) => toClipboardCellValue(this.fieldValues.get(colId) ?? null)),
    ];

    // Build column schemas
    const columnSchemas: ColumnSchema[] = this.formConfig.fields
      .filter((f) => !f.hidden)
      .map((f) => this.getColumnSchema(f.colId))
      .filter((s): s is ColumnSchema => s !== null);

    // Build text representation (TSV)
    const labels = this.formConfig.fields.filter((f) => !f.hidden).map((f) => f.label ?? f.colId);
    const headerRow = labels.join('\t');

    const valueRow = colIds
      .map((colId) => {
        return clipboardCellValueToText(this.fieldValues.get(colId));
      })
      .join('\t');

    return {
      cells: {
        values: cellValues,
        rowCount: 1,
        colCount: colIds.length,
      },
      tableContext: {
        tableId: this.tableId,
        rowIds: this.editingRowId ? [this.editingRowId] : [],
        colIds,
        columnSchemas,
      },
      source: {
        viewType: 'form',
        viewId: this.viewId,
        sheetId: this.formConfig.sheetId,
      },
      text: `${headerRow}\n${valueRow}`,
    };
  }

  canPaste(payload: ClipboardPayload): boolean {
    // Form can paste a single record/row to pre-fill fields
    if (payload.cells && payload.cells.rowCount === 1) {
      return true;
    }
    // Can also paste text
    if (payload.text && payload.text.trim() !== '') {
      return true;
    }
    return false;
  }

  paste(payload: ClipboardPayload): void {
    // Prefer cells format with tableContext for column mapping
    if (payload.cells && payload.cells.values.length > 0) {
      const row = payload.cells.values[0];

      // If we have tableContext, use colIds for mapping
      if (payload.tableContext && payload.tableContext.colIds.length > 0) {
        const sourceColIds = payload.tableContext.colIds;
        for (let i = 0; i < row.length && i < sourceColIds.length; i++) {
          const sourceColId = sourceColIds[i];
          const value = row[i];
          // Find matching field in our form
          const field = this.formConfig.fields.find((f) => f.colId === sourceColId);
          if (field && value !== undefined) {
            this.setFieldValue(
              field.colId,
              fromClipboardCellValue(value, this.getColumnType(field.colId)),
            );
          }
        }
      } else {
        // No column mapping - paste by position into visible fields
        const visibleFields = this.formConfig.fields.filter((f) => !f.hidden);
        for (let i = 0; i < row.length && i < visibleFields.length; i++) {
          const value = row[i];
          if (value !== undefined) {
            this.setFieldValue(
              visibleFields[i].colId,
              fromClipboardCellValue(value, this.getColumnType(visibleFields[i].colId)),
            );
          }
        }
      }
    } else if (payload.text) {
      // Parse text as TSV and paste first data row
      this.pasteFromText(payload.text);
    }
  }

  /**
   * Parse TSV text and paste into form fields.
   */
  private pasteFromText(text: string): void {
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return;

    // If multiple lines, first might be header - use second line for data
    // If single line, use it as data
    const dataLine = lines.length > 1 ? lines[1] : lines[0];
    const values = dataLine.split('\t');

    const visibleFields = this.formConfig.fields.filter((f) => !f.hidden);
    for (let i = 0; i < values.length && i < visibleFields.length; i++) {
      const value = values[i].trim();
      if (value !== '') {
        this.setFieldValue(
          visibleFields[i].colId,
          fromClipboardCellValue(value, this.getColumnType(visibleFields[i].colId)),
        );
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Edit Contract
  // ═══════════════════════════════════════════════════════════════════════════

  isEditing(): boolean {
    // Form is always in "edit mode" when visible
    return true;
  }

  startEdit(target: unknown): void {
    // Target can be a row ID to edit an existing record
    if (typeof target === 'string') {
      this.editingRowId = toRowId(target);

      // Load existing record values from kernel (async)
      void this.getRecordFromContext(this.editingRowId).then((record) => {
        if (record) {
          // Clear existing values and populate from record
          this.fieldValues.clear();
          for (const [colId, value] of record.entries()) {
            this.fieldValues.set(colId, value);
          }
          this.isDirty = false;
          this.notifySelectionChange();
          this.notifyToolbarChange();
        }
      });
    }
  }

  /**
   * Get record data from workbook.
   */
  private async getRecordFromContext(rowId: RowId): Promise<Map<ColId, CellValue> | null> {
    const record = await this.workbook.records.get(this.tableId, rowId);
    if (record) {
      const map = new Map<ColId, CellValue>();
      for (const [key, value] of Object.entries(record.values)) {
        map.set(toColId(key), value as CellValue);
      }
      return map;
    }
    return null;
  }

  async commitEdit(): Promise<void> {
    // Validate before committing
    const validationErrors = this.validateForm();
    if (validationErrors.size > 0) {
      this.fieldErrors = validationErrors;
      this.notifyToolbarChange();
      throw new Error('Form validation failed');
    }

    // Build values object from field values
    const values: Record<ColId, CellValue> = {};
    for (const [colId, value] of this.fieldValues) {
      values[colId] = value;
    }

    // Create or update record via Kernel API
    if (this.editingRowId) {
      // Update existing record
      await this.updateRecord(this.editingRowId, values);
    } else {
      // Create new record
      await this.createRecord(values);
    }

    // Reset dirty state after successful commit
    this.isDirty = false;
    this.notifyToolbarChange();
  }

  /**
   * Create a new record in the table.
   */
  private async createRecord(values: Record<ColId, CellValue>): Promise<RowId> {
    return toRowId(await this.workbook.records.create(this.tableId, values));
  }

  /**
   * Update an existing record in the table.
   */
  private async updateRecord(rowId: RowId, values: Record<ColId, CellValue>): Promise<void> {
    await this.workbook.records.update(this.tableId, rowId, values);
  }

  cancelEdit(): void {
    this.initializeFieldValues();
    this.notifySelectionChange();
    this.notifyToolbarChange();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Toolbar Contract
  // ═══════════════════════════════════════════════════════════════════════════

  getToolbarContext(): ToolbarContext {
    return {
      formatting: {
        // Form view doesn't support formatting
        canBold: false,
        canItalic: false,
        canUnderline: false,
        canChangeFont: false,
        canChangeFontSize: false,
        canChangeColor: false,
        canChangeFillColor: false,
        canChangeAlignment: false,
        canChangeBorders: false,
      },
      state: {
        isBold: null,
        isItalic: null,
        isUnderline: null,
        fontFamily: null,
        fontSize: null,
        textColor: null,
        fillColor: null,
        horizontalAlign: null,
        verticalAlign: null,
      },
      structure: {
        canInsertRow: false,
        canDeleteRow: false,
        canInsertColumn: false,
        canDeleteColumn: false,
        canMerge: false,
        canUnmerge: false,
        canSort: false,
        canFilter: false,
      },
      selection: {
        hasSelection: this.focusedField !== null,
        selectionCount: this.focusedField ? 1 : 0,
        selectionLabel: this.focusedField ? this.getFieldLabel(this.focusedField) : '',
      },
    };
  }

  onToolbarContextChange(listener: (ctx: ToolbarContext) => void): () => void {
    this.toolbarListeners.add(listener);
    return () => this.toolbarListeners.delete(listener);
  }

  private notifyToolbarChange(): void {
    const ctx = this.getToolbarContext();
    for (const listener of this.toolbarListeners) {
      listener(ctx);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Keyboard
  // ═══════════════════════════════════════════════════════════════════════════

  handleKeyboard(event: KeyboardEvent): boolean {
    const { key, ctrlKey, metaKey } = event;
    const cmdKey = ctrlKey || metaKey;

    switch (key) {
      case 'Tab':
        // Tab navigation between fields is handled by the browser
        return false;

      case 'Enter':
        if (cmdKey) {
          // Cmd/Ctrl+Enter submits the form
          this.commitEdit().catch(console.error);
          return true;
        }
        return false;

      case 'Escape':
        // Escape resets the form
        this.cancelEdit();
        return true;

      default:
        return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Formatting
  // ═══════════════════════════════════════════════════════════════════════════

  applyFormatting(_format: Partial<CellFormat>): void {
    // Form view doesn't support formatting
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  mount(_container: HTMLElement): void {
    // Form view mounting handled by React
  }

  unmount(): void {
    // Keep state for caching
  }

  dispose(): void {
    this.fieldValues.clear();
    this.fieldErrors.clear();
    this.selectionListeners.clear();
    this.toolbarListeners.clear();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Form-specific methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the form configuration.
   */
  getConfig(): FormViewConfig {
    return this.formConfig;
  }

  /**
   * Get the current value of a field.
   */
  getFieldValue(colId: ColId): CellValue {
    return this.fieldValues.get(colId) ?? null;
  }

  /**
   * Set the value of a field.
   */
  setFieldValue(colId: ColId, value: CellValue): void {
    this.fieldValues.set(colId, value);
    this.isDirty = true;

    // Clear error for this field
    this.fieldErrors.delete(colId);

    this.notifyToolbarChange();
  }

  /**
   * Get all field values.
   */
  getAllFieldValues(): Map<ColId, CellValue> {
    return new Map(this.fieldValues);
  }

  /**
   * Get the error for a field.
   */
  getFieldError(colId: ColId): string | null {
    return this.fieldErrors.get(colId) ?? null;
  }

  /**
   * Check if the form has been modified.
   */
  getIsDirty(): boolean {
    return this.isDirty;
  }

  /**
   * Get the label for a field.
   */
  private getFieldLabel(colId: ColId): string {
    const field = this.formConfig.fields.find((f) => f.colId === colId);
    return field?.label ?? colId;
  }

  /**
   * Validate the form and return errors.
   * Uses type-specific validation based on column type.
   */
  private validateForm(): Map<ColId, string> {
    const errors = new Map<ColId, string>();

    for (const field of this.formConfig.fields) {
      if (field.hidden) continue;

      const value = this.fieldValues.get(field.colId) ?? null;
      const columnType = this.getColumnType(field.colId);

      // Required validation
      if (field.required) {
        const requiredResult = validateRequired(value);
        if (!requiredResult.isValid) {
          errors.set(field.colId, requiredResult.message ?? 'This field is required');
          continue; // Skip type-specific validation if required fails
        }
      }

      // Skip type-specific validation if value is empty (and not required)
      if (value === null || value === undefined || value === '') {
        continue;
      }

      // Type-specific validation
      const typeValidationResult = this.validateFieldByType(value, columnType, field);
      if (!typeValidationResult.isValid) {
        errors.set(field.colId, typeValidationResult.message ?? 'Invalid value');
      }
    }

    return errors;
  }

  /**
   * Validate a field value based on its column type.
   */
  private validateFieldByType(
    value: CellValue,
    columnType: ColumnTypeKind,
    field: FormFieldConfig,
  ): ValidationResult {
    switch (columnType) {
      case 'email':
        return validateEmail(value);

      case 'url':
        return validateUrl(value);

      case 'number':
      case 'rating':
      case 'progress': {
        // Get min/max from column schema if available
        const schema = field.columnSchema;
        const min = columnType === 'progress' ? 0 : undefined;
        const max =
          columnType === 'progress'
            ? 100
            : columnType === 'rating'
              ? (schema?.maxRating ?? 5)
              : undefined;
        return validateNumberRange(value, min, max);
      }

      case 'date':
      case 'createdTime':
      case 'modifiedTime': {
        // Basic date validation
        if (value !== null && value !== undefined) {
          if (typeof value === 'number') {
            return { isValid: true };
          }
          const dateValue = new Date(String(value));
          if (Number.isNaN(dateValue.getTime())) {
            return { isValid: false, message: 'Please enter a valid date' };
          }
        }
        return { isValid: true };
      }

      case 'select': {
        // Validate that value is one of the allowed options
        const options = field.options ?? field.columnSchema?.options;
        if (options && options.length > 0) {
          const validValues = options.map((opt) => opt.id);
          if (!validValues.includes(String(value))) {
            return { isValid: false, message: 'Please select a valid option' };
          }
        }
        return { isValid: true };
      }

      case 'checkbox': {
        // Checkbox should be boolean
        if (typeof value !== 'boolean') {
          return { isValid: false, message: 'Invalid checkbox value' };
        }
        return { isValid: true };
      }

      case 'phone': {
        // Basic phone validation - allow digits, spaces, hyphens, parentheses, plus
        const phoneRegex = /^[+]?[\d\s\-()]+$/;
        if (!phoneRegex.test(String(value))) {
          return { isValid: false, message: 'Please enter a valid phone number' };
        }
        return { isValid: true };
      }

      // Text and other types - no additional validation
      case 'text':
      case 'person':
      case 'file':
      case 'relation':
      case 'lookup':
      case 'rollup':
      case 'formula':
      case 'createdBy':
      case 'modifiedBy':
      case 'autoNumber':
      default:
        return { isValid: true };
    }
  }

  /**
   * Reset the form for creating another record.
   */
  resetForNewRecord(): void {
    this.editingRowId = null;
    this.initializeFieldValues();
    this.notifySelectionChange();
    this.notifyToolbarChange();
  }

  /**
   * Get the column type for a field.
   * Returns from fieldConfig.columnType if set, or from columnSchema, or defaults to 'text'.
   */
  getColumnType(colId: ColId): ColumnTypeKind {
    const field = this.formConfig.fields.find((f) => f.colId === colId);
    if (field?.columnType) {
      return field.columnType;
    }
    if (field?.columnSchema?.kind) {
      return field.columnSchema.kind;
    }
    return 'text';
  }

  /**
   * Get the column schema for a field.
   * Returns the full schema if available, otherwise constructs a minimal schema.
   */
  getColumnSchema(colId: ColId): ColumnSchema | null {
    const field = this.formConfig.fields.find((f) => f.colId === colId);
    if (field?.columnSchema) {
      return field.columnSchema;
    }
    // Construct minimal schema from field config
    if (field) {
      return {
        id: colId,
        name: field.label ?? colId,
        kind: field.columnType ?? 'text',
        required: field.required,
        options: field.options,
      };
    }
    return null;
  }

  /**
   * Get the field configuration for a column.
   */
  getFieldConfig(colId: ColId): FormFieldConfig | undefined {
    return this.formConfig.fields.find((f) => f.colId === colId);
  }
}
