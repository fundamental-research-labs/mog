/**
 * FormField Primitive
 *
 * Wrapper component that combines Label with form inputs.
 * Uses Tailwind classes mapped to design tokens from globals.css.
 *
 * Automatically generates and injects IDs for accessibility compliance.
 * Labels are always properly associated with inputs via htmlFor/id pairing.
 */

import { Children, cloneElement, isValidElement, useId, type ReactNode } from 'react';
import { Label } from './Label';

interface FormFieldProps {
  /** Field label text */
  label: string;
  /** Form input element(s) */
  children: ReactNode;
  /** Mark field as required */
  required?: boolean;
  /** Error message to display */
  error?: string;
  /** Help text to display below the input */
  helpText?: string;
  /** HTML for attribute for the label (auto-generated if not provided) */
  htmlFor?: string;
  /** Additional class names */
  className?: string;
}

/**
 * FormField - Wrapper that combines label, input, and error/help text.
 *
 * Accessibility: FormField automatically generates IDs and injects them
 * into child inputs, ensuring labels are always properly associated.
 * This makes screen readers work correctly without manual ID management.
 *
 * @example
 * ```tsx
 * // Auto-generated ID - recommended approach
 * <FormField label="Email Address" required>
 *   <Input type="email" placeholder="user@example.com" />
 * </FormField>
 *
 * // Explicit ID - still works if needed
 * <FormField label="Password" htmlFor="custom-id">
 *   <Input id="custom-id" type="password" />
 * </FormField>
 *
 * <FormField label="Theme" helpText="Choose your preferred color scheme">
 *   <Select options={themeOptions} />
 * </FormField>
 * ```
 */
export function FormField({
  label,
  children,
  required = false,
  error,
  helpText,
  htmlFor,
  className = '',
}: FormFieldProps) {
  // Auto-generate a stable ID if not provided
  const autoId = useId();
  const fieldId = htmlFor || autoId;

  // Inject id into the first valid React element child that doesn't already have one
  const childrenWithId = Children.map(children, (child, index) => {
    // Only inject into the first element (typically the input)
    if (index === 0 && isValidElement<{ id?: string }>(child) && !child.props.id) {
      return cloneElement(child, { id: fieldId } as Record<string, unknown>);
    }
    return child;
  });

  return (
    <div className={`mb-4 ${className}`}>
      <Label htmlFor={fieldId} required={required}>
        {label}
      </Label>
      {childrenWithId}
      {error && <p className="mt-1 text-caption text-ss-error">{error}</p>}
      {helpText && !error && <p className="mt-1 text-caption text-ss-text-tertiary">{helpText}</p>}
    </div>
  );
}
