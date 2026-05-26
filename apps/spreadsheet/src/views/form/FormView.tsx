/**
 * Form View Component
 *
 * Renders a data entry form for creating/editing records.
 */

import type { ColId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue } from '@mog-sdk/contracts/core';
import * as React from 'react';
import type { ColumnTypeKind } from '../../domain/clipboard/types';
import { CheckboxField } from './components/fields/CheckboxField';
import { DateField } from './components/fields/DateField';
import { NumberField } from './components/fields/NumberField';
import { PersonField } from './components/fields/PersonField';
import { SelectField, type SelectOption } from './components/fields/SelectField';
import { TextField } from './components/fields/TextField';
import { FormField } from './components/FormField';
import { FormLayout } from './components/FormLayout';
import { SubmitButton } from './components/SubmitButton';
import type { FormFieldConfig, FormViewConfig } from './config';

/**
 * Subset of FormViewAdapter methods that FormView actually uses.
 * This allows FormViewContainer to pass a lightweight adapter-like object
 * without implementing the full ViewAdapter interface.
 */
export interface FormViewAdapterLike {
  getFieldValue(colId: ColId): CellValue;
  setFieldValue(colId: ColId, value: CellValue): void;
  getFieldError(colId: ColId): string | null;
  getIsDirty(): boolean;
  commitEdit(): Promise<void>;
  resetForNewRecord(): void;
  handleKeyboard(event: KeyboardEvent): boolean;
  getColumnType(colId: ColId): ColumnTypeKind;
}

export interface FormViewProps {
  /** The adapter managing this view's state */
  adapter: FormViewAdapterLike;
  /** View configuration */
  config: FormViewConfig;
  /** Called after successful submission */
  onSubmitSuccess?: () => void;
  /** Called on submission error */
  onSubmitError?: (error: Error) => void;
}

/**
 * Form View renders a data entry form for creating/editing records.
 */
export function FormView({
  adapter,
  config,
  onSubmitSuccess,
  onSubmitError,
}: FormViewProps): React.ReactElement {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [showSuccess, setShowSuccess] = React.useState(false);
  const [createAnother, setCreateAnother] = React.useState(false);

  // Force re-render when adapter state changes
  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

  // Handle field change
  const handleFieldChange = React.useCallback(
    (colId: ColId, value: CellValue) => {
      adapter.setFieldValue(colId, value);
      forceUpdate();
    },
    [adapter],
  );

  // Handle form submission
  const handleSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      setIsSubmitting(true);
      setShowSuccess(false);

      try {
        await adapter.commitEdit();
        setShowSuccess(true);
        onSubmitSuccess?.();

        if (createAnother) {
          // Reset form for another entry after a brief delay
          setTimeout(() => {
            adapter.resetForNewRecord();
            setShowSuccess(false);
            forceUpdate();
          }, 1500);
        }
      } catch (error) {
        onSubmitError?.(error instanceof Error ? error : new Error('Submission failed'));
        forceUpdate(); // Re-render to show validation errors
      } finally {
        setIsSubmitting(false);
      }
    },
    [adapter, createAnother, onSubmitSuccess, onSubmitError],
  );

  // Handle keyboard
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (adapter.handleKeyboard(event)) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [adapter]);

  // Render field by type
  const renderField = (fieldConfig: FormFieldConfig) => {
    if (fieldConfig.hidden) {
      return null;
    }

    const colId = fieldConfig.colId;
    const value = adapter.getFieldValue(colId);
    const error = adapter.getFieldError(colId);
    const label = fieldConfig.label ?? colId;
    const isRequired = fieldConfig.required ?? false;

    // Get column type from fieldConfig or adapter
    const fieldType: ColumnTypeKind = adapter.getColumnType(colId);

    const commonProps = {
      colId,
      label,
      value,
      error,
      placeholder: fieldConfig.placeholder,
      helpText: fieldConfig.helpText,
      required: isRequired,
      showRequiredIndicator: config.showRequiredIndicator,
      onChange: (newValue: CellValue) => handleFieldChange(colId, newValue),
    };

    // Map column types to field components
    switch (fieldType) {
      case 'number':
      case 'autoNumber':
      case 'rollup':
        return <NumberField {...commonProps} />;

      case 'select':
        // Get options from fieldConfig or column schema
        const selectOptions: SelectOption[] = (
          fieldConfig.options ??
          fieldConfig.columnSchema?.options ??
          []
        ).map((opt) => ({
          value: opt.id,
          label: opt.label,
          color: opt.color,
        }));
        return <SelectField {...commonProps} options={selectOptions} />;

      case 'date':
      case 'createdTime':
      case 'modifiedTime':
        return <DateField {...commonProps} />;

      case 'checkbox':
        return <CheckboxField {...commonProps} />;

      case 'person':
      case 'createdBy':
      case 'modifiedBy':
        return <PersonField {...commonProps} />;

      case 'email':
        return <TextField {...commonProps} type="email" />;

      case 'url':
        return <TextField {...commonProps} type="url" />;

      case 'phone':
        return <TextField {...commonProps} type="tel" />;

      case 'rating':
      case 'progress':
      case 'file':
        // For rating, progress, and file types, fall back to text for now
        // TODO: Implement specialized components or use column renderer's formField
        return <TextField {...commonProps} />;

      case 'text':
      case 'formula':
      case 'lookup':
      case 'relation':
      default:
        // Default to text field
        return <TextField {...commonProps} />;
    }
  };

  // Filter visible fields
  const visibleFields = config.fields.filter((f) => !f.hidden);

  return (
    <div className="max-w-[800px] mx-auto p-6">
      <form onSubmit={handleSubmit}>
        {/* Header */}
        <div className="mb-6">
          <h2 className="m-0 mb-2 text-title font-semibold text-ss-text">{config.title}</h2>
          {config.description && (
            <p className="m-0 text-ss-text-secondary text-body">{config.description}</p>
          )}
        </div>

        {/* Success message */}
        {showSuccess && (
          <div
            className="px-4 py-3 bg-ss-success-bg border border-ss-success rounded-ss-sm text-ss-success mb-6"
            role="alert"
          >
            {config.successMessage}
          </div>
        )}

        {/* Form fields */}
        <FormLayout layout={config.layout}>
          {visibleFields.map((fieldConfig) => (
            <FormField
              key={fieldConfig.colId}
              label={fieldConfig.label ?? fieldConfig.colId}
              required={fieldConfig.required}
              showRequiredIndicator={config.showRequiredIndicator}
              error={adapter.getFieldError(fieldConfig.colId)}
              helpText={fieldConfig.helpText}
            >
              {renderField(fieldConfig)}
            </FormField>
          ))}
        </FormLayout>

        {/* Footer */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-ss-border">
          {/* Create Another checkbox */}
          <label className="flex items-center gap-2 text-body text-ss-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={createAnother}
              onChange={(e) => setCreateAnother(e.target.checked)}
              className="cursor-pointer"
            />
            <span>Create another</span>
          </label>

          {/* Submit button */}
          <SubmitButton
            text={config.submitButtonText}
            isSubmitting={isSubmitting}
            disabled={!adapter.getIsDirty()}
          />
        </div>
      </form>
    </div>
  );
}
