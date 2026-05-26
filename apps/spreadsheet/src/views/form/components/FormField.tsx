/**
 * Form Field Component
 *
 * Generic wrapper for form fields with label, error, and help text.
 */

import * as React from 'react';

export interface FormFieldProps {
  /** Field label */
  label: string;
  /** Whether field is required */
  required?: boolean;
  /** Whether to show asterisk for required fields */
  showRequiredIndicator?: boolean;
  /** Error message */
  error?: string | null;
  /** Help text shown below the field */
  helpText?: string;
  /** The field input component */
  children: React.ReactNode;
}

/**
 * Form field wrapper with label and error display.
 */
export function FormField({
  label,
  required,
  showRequiredIndicator = true,
  error,
  helpText,
  children,
}: FormFieldProps): React.ReactElement {
  const hasError = !!error;

  return (
    <div className={`flex flex-col gap-1 ${hasError ? 'form-field--error' : ''}`}>
      <label className="text-body font-medium text-ss-text">
        {label}
        {required && showRequiredIndicator && (
          <span className="text-ss-error ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </label>

      <div className="w-full">{children}</div>

      {helpText && !hasError && (
        <p className="m-0 text-caption text-ss-text-secondary">{helpText}</p>
      )}

      {hasError && (
        <p className="m-0 text-caption text-ss-error" role="alert">
          {error}
        </p>
      )}

      <style>{`
 .form-field--error input,
 .form-field--error select,
 .form-field--error textarea {
 border-color: var(--color-ss-error) !important;
 }
 `}</style>
    </div>
  );
}
