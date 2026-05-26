/**
 * useFormState Hook
 *
 * Manages form values, validation, and dirty state.
 */

import type { ColId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue } from '@mog-sdk/contracts/core';
import * as React from 'react';
import type { FormFieldConfig } from '../config';

/**
 * Validation error for a field.
 */
export interface FieldValidationError {
  field: ColId;
  message: string;
}

/**
 * Form state returned by useFormState hook.
 */
export interface FormState {
  /** Current field values */
  values: Map<ColId, CellValue>;
  /** Field errors */
  errors: Map<ColId, string>;
  /** Whether form has been modified */
  isDirty: boolean;
  /** Whether form is valid */
  isValid: boolean;
  /** Get value for a specific field */
  getValue: (colId: ColId) => CellValue;
  /** Set value for a specific field */
  setValue: (colId: ColId, value: CellValue) => void;
  /** Get error for a specific field */
  getError: (colId: ColId) => string | null;
  /** Validate the entire form */
  validate: () => FieldValidationError[];
  /** Reset form to initial values */
  reset: () => void;
  /** Set all values at once (for loading an existing record) */
  setValues: (values: Map<ColId, CellValue>) => void;
}

/**
 * Options for useFormState hook.
 */
export interface UseFormStateOptions {
  /** Field configurations with default values */
  fields: FormFieldConfig[];
  /** Optional initial values (for editing existing record) */
  initialValues?: Map<ColId, CellValue>;
  /** Custom validation function */
  validate?: (values: Map<ColId, CellValue>) => FieldValidationError[];
}

/**
 * Hook for managing form state with validation.
 */
export function useFormState({
  fields,
  initialValues,
  validate: customValidate,
}: UseFormStateOptions): FormState {
  // Build default values from field configs
  const defaultValues = React.useMemo(() => {
    const values = new Map<ColId, CellValue>();
    for (const field of fields) {
      if (initialValues?.has(field.colId)) {
        values.set(field.colId, initialValues.get(field.colId)!);
      } else if (field.defaultValue !== undefined) {
        values.set(field.colId, field.defaultValue);
      } else {
        values.set(field.colId, null);
      }
    }
    return values;
  }, [fields, initialValues]);

  const [values, setValuesState] = React.useState<Map<ColId, CellValue>>(
    () => new Map(defaultValues),
  );
  const [errors, setErrors] = React.useState<Map<ColId, string>>(new Map());
  const [isDirty, setIsDirty] = React.useState(false);

  // Get value for a field
  const getValue = React.useCallback(
    (colId: ColId): CellValue => {
      return values.get(colId) ?? null;
    },
    [values],
  );

  // Set value for a field
  const setValue = React.useCallback((colId: ColId, value: CellValue) => {
    setValuesState((prev) => {
      const next = new Map(prev);
      next.set(colId, value);
      return next;
    });
    setIsDirty(true);

    // Clear error for this field when value changes
    setErrors((prev) => {
      const next = new Map(prev);
      next.delete(colId);
      return next;
    });
  }, []);

  // Get error for a field
  const getError = React.useCallback(
    (colId: ColId): string | null => {
      return errors.get(colId) ?? null;
    },
    [errors],
  );

  // Default validation logic
  const defaultValidate = React.useCallback(
    (vals: Map<ColId, CellValue>): FieldValidationError[] => {
      const errs: FieldValidationError[] = [];

      for (const field of fields) {
        if (field.hidden) continue;

        const value = vals.get(field.colId);
        const isEmpty =
          value === null ||
          value === undefined ||
          value === '' ||
          (typeof value === 'string' && value.trim() === '');

        // Required validation
        if (field.required && isEmpty) {
          errs.push({
            field: field.colId,
            message: 'This field is required',
          });
        }
      }

      return errs;
    },
    [fields],
  );

  // Validate the form
  const validate = React.useCallback((): FieldValidationError[] => {
    const validationFn = customValidate ?? defaultValidate;
    const validationErrors = validationFn(values);

    // Update error state
    const errorMap = new Map<ColId, string>();
    for (const err of validationErrors) {
      errorMap.set(err.field, err.message);
    }
    setErrors(errorMap);

    return validationErrors;
  }, [values, customValidate, defaultValidate]);

  // Reset form
  const reset = React.useCallback(() => {
    setValuesState(new Map(defaultValues));
    setErrors(new Map());
    setIsDirty(false);
  }, [defaultValues]);

  // Set all values at once
  const setValues = React.useCallback((newValues: Map<ColId, CellValue>) => {
    setValuesState(new Map(newValues));
    setErrors(new Map());
    setIsDirty(false);
  }, []);

  // Check if form is valid (no errors)
  const isValid = errors.size === 0;

  return {
    values,
    errors,
    isDirty,
    isValid,
    getValue,
    setValue,
    getError,
    validate,
    reset,
    setValues,
  };
}
