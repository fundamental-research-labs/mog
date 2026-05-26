/**
 * FormViewContainer
 *
 * React component that wraps FormView for direct rendering.
 * FormView doesn't use XState - it manages state internally via the adapter.
 */

import { toColId, type ColId, type RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import React, { useEffect, useMemo, useState } from 'react';
import { useWorkbook } from '../../infra/context';
import type { TableId, ViewId } from '../types';
import type { FormFieldConfig, FormViewConfig } from './config';
import { createFormConfig } from './config';
import { FormView } from './FormView';
export interface FormViewContainerProps {
  viewId: ViewId;
  tableId?: TableId;
  sheetId: SheetId;
  config: Record<string, unknown>;
}

/**
 * Form View Container
 *
 * Creates a fully self-contained form view instance that can be rendered
 * directly in the React tree without using createRoot().
 */
export function FormViewContainer({
  viewId,
  tableId,
  sheetId,
  config,
}: FormViewContainerProps): React.ReactElement {
  const wb = useWorkbook();

  // Form state (replaces adapter's internal state)
  const [fieldValues, setFieldValues] = useState<Map<ColId, CellValue>>(new Map());
  const [fieldErrors, setFieldErrors] = useState<Map<ColId, string>>(new Map());
  const [editingRowId, setEditingRowId] = useState<RowId | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Build form config, using Worksheet API for table column auto-detection
  const [formConfig, setFormConfig] = useState<FormViewConfig>(() => {
    const fields = (config.fields as FormFieldConfig[]) ?? [];
    return createFormConfig(viewId, sheetId, tableId ?? ('' as TableId), fields, {
      title: (config.title as string) ?? 'New Record',
      description: config.description as string | undefined,
      submitButtonText: (config.submitButtonText as string) ?? 'Create',
      successMessage: (config.successMessage as string) ?? 'Record created successfully!',
      showRequiredIndicator: (config.showRequiredIndicator as boolean) ?? true,
      layout: (config.layout as 'single' | 'two-column') ?? 'single',
    });
  });

  useEffect(() => {
    const title = (config.title as string) ?? 'New Record';
    const description = config.description as string | undefined;
    const fields = (config.fields as FormFieldConfig[]) ?? [];
    const submitButtonText = (config.submitButtonText as string) ?? 'Create';
    const successMessage = (config.successMessage as string) ?? 'Record created successfully!';
    const showRequiredIndicator = (config.showRequiredIndicator as boolean) ?? true;
    const layout = (config.layout as 'single' | 'two-column') ?? 'single';

    let finalFields = fields;

    if (finalFields.length === 0 && tableId) {
      // Fetch table via Worksheet API (async)
      void (async () => {
        try {
          const ws = wb.getSheetById(sheetId);
          const tables = await ws.tables.list();
          const table = tables.find((t: any) => t.id === tableId);
          if (table?.columns) {
            finalFields = table.columns.map((col: { name: string }) => ({
              colId: toColId(col.name),
              label: col.name,
              required: false,
            }));
          }
          setFormConfig(
            createFormConfig(viewId, sheetId, tableId ?? ('' as TableId), finalFields, {
              title,
              description,
              submitButtonText,
              successMessage,
              showRequiredIndicator,
              layout,
            }),
          );
        } catch {
          // Keep default config on error
        }
      })();
    } else {
      setFormConfig(
        createFormConfig(viewId, sheetId, tableId ?? ('' as TableId), finalFields, {
          title,
          description,
          submitButtonText,
          successMessage,
          showRequiredIndicator,
          layout,
        }),
      );
    }
  }, [viewId, sheetId, tableId, config, wb]);

  // Initialize field values with defaults
  React.useEffect(() => {
    const initialValues = new Map<ColId, CellValue>();
    for (const field of formConfig.fields) {
      if (field.defaultValue !== undefined) {
        initialValues.set(field.colId, field.defaultValue);
      } else {
        initialValues.set(field.colId, null);
      }
    }
    setFieldValues(initialValues);
    setIsDirty(false);
  }, [formConfig.fields]);

  // Create a lightweight adapter-like object for FormView
  const adapter = useMemo(() => {
    return {
      getFieldValue: (colId: ColId): CellValue => {
        return fieldValues.get(colId) ?? null;
      },
      setFieldValue: (colId: ColId, value: CellValue) => {
        setFieldValues((prev) => {
          const next = new Map(prev);
          next.set(colId, value);
          return next;
        });
        setIsDirty(true);
        // Clear error for this field
        setFieldErrors((prev) => {
          const next = new Map(prev);
          next.delete(colId);
          return next;
        });
      },
      getFieldError: (colId: ColId): string | null => {
        return fieldErrors.get(colId) ?? null;
      },
      getIsDirty: () => isDirty,
      commitEdit: async () => {
        // Build values object from field values
        const values: Record<ColId, CellValue> = {};
        fieldValues.forEach((value, key) => {
          values[key] = value;
        });

        // Create or update record via Kernel API
        if (!tableId) {
          throw new Error('Cannot submit form: no table ID');
        }

        if (editingRowId) {
          // Update existing record
          await wb.records.update(tableId, editingRowId, values);
        } else {
          // Create new record
          await wb.records.create(tableId, values);
        }

        // Reset dirty state after successful commit
        setIsDirty(false);
      },
      resetForNewRecord: () => {
        setEditingRowId(null);
        const resetValues = new Map<ColId, CellValue>();
        for (const field of formConfig.fields) {
          if (field.defaultValue !== undefined) {
            resetValues.set(field.colId, field.defaultValue);
          } else {
            resetValues.set(field.colId, null);
          }
        }
        setFieldValues(resetValues);
        setFieldErrors(new Map());
        setIsDirty(false);
      },
      handleKeyboard: (event: KeyboardEvent) => {
        const { key, ctrlKey, metaKey } = event;
        const cmdKey = ctrlKey || metaKey;

        switch (key) {
          case 'Enter':
            if (cmdKey) {
              // Cmd/Ctrl+Enter submits the form
              adapter.commitEdit().catch(console.error);
              return true;
            }
            return false;

          case 'Escape':
            // Escape resets the form
            adapter.resetForNewRecord();
            return true;

          default:
            return false;
        }
      },
      getColumnType: (colId: ColId) => {
        const field = formConfig.fields.find((f) => f.colId === colId);
        return field?.columnType ?? 'text';
      },
    };
  }, [fieldValues, fieldErrors, isDirty, editingRowId, formConfig, wb, tableId]);

  return (
    <FormView
      adapter={adapter}
      config={formConfig}
      onSubmitSuccess={() => {
        console.log('Form submitted successfully');
      }}
      onSubmitError={(error) => {
        console.error('Form submission failed:', error);
      }}
    />
  );
}
