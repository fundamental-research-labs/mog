/**
 * Checkbox Radix Wrapper
 *
 * Wraps @radix-ui/react-checkbox with our styling and API.
 * Uses semantic design tokens from tokens.css - never Tailwind defaults.
 *
 */

import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { CheckSvg, SubtractSvg } from '@mog/icons';
import { type ReactNode, useId } from 'react';

export interface CheckboxProps {
  /** Checked state - boolean for checked/unchecked, 'indeterminate' for mixed state */
  checked?: boolean | 'indeterminate';
  /** Callback when checked state changes */
  onChange?: (checked: boolean) => void;
  /** Label text or element */
  label?: ReactNode;
  /** Position of the label relative to the checkbox */
  labelPosition?: 'left' | 'right';
  /** Custom CSS classes for the label element */
  labelClassName?: string;
  /** Whether the checkbox is disabled */
  disabled?: boolean;
  /** Additional CSS classes for the wrapper */
  className?: string;
  /** Custom ID for the checkbox input */
  id?: string;
  /** Name attribute for form submission */
  name?: string;
  /** Value attribute for form submission */
  value?: string;
  /** Whether the checkbox is required */
  required?: boolean;
  /** Optional stable test selector forwarded to the Radix root */
  'data-testid'?: string;
  /** Accessible label forwarded to the Radix root */
  'aria-label'?: string;
}

// Checkbox base styles using semantic design tokens
const checkboxClasses = [
  'h-4 w-4',
  'rounded-ss-sm',
  'border border-ss-border',
  'bg-ss-surface',
  'cursor-pointer',
  // Checked state
  'data-[state=checked]:bg-ss-primary',
  'data-[state=checked]:border-ss-primary',
  // Indeterminate state
  'data-[state=indeterminate]:bg-ss-primary',
  'data-[state=indeterminate]:border-ss-primary',
  // Disabled state
  'data-[disabled]:opacity-40',
  'data-[disabled]:cursor-not-allowed',
  // Focus state
  'focus:outline-none focus:ring-2 focus:ring-ss-primary/20 focus:ring-offset-0',
  // Flex for centering indicator
  'flex items-center justify-center',
].join(' ');

// Icon styles for check/minus indicators
const iconClasses = 'h-3 w-3 text-white';

/**
 * Checkbox - Radix-based checkbox with consistent styling.
 *
 * Features:
 * - Full keyboard accessibility (handled by Radix)
 * - Support for indeterminate state
 * - Optional label with configurable position
 * - Uses semantic design tokens
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Checkbox
 *   checked={isChecked}
 *   onChange={setIsChecked}
 *   label="Enable feature"
 * />
 *
 * // Indeterminate state (for multi-selection)
 * <Checkbox
 *   checked="indeterminate"
 *   onChange={handleChange}
 *   label="Select all"
 * />
 *
 * // Label on left
 * <Checkbox
 *   checked={isChecked}
 *   onChange={setIsChecked}
 *   label="Feature enabled"
 *   labelPosition="left"
 * />
 * ```
 */
export function Checkbox({
  checked = false,
  onChange,
  label,
  labelPosition = 'right',
  labelClassName,
  disabled = false,
  className = '',
  id,
  name,
  value,
  required,
  'data-testid': dataTestId,
  'aria-label': ariaLabel,
}: CheckboxProps) {
  // Generate a stable unique ID if not provided
  const generatedId = useId();
  const checkboxId = id ?? `checkbox-${generatedId}`;

  // Map our checked prop to Radix's checked prop
  // Radix accepts: true | false | 'indeterminate'
  const radixChecked = checked;

  // Handle change from Radix (receives boolean | 'indeterminate')
  const handleCheckedChange = (state: boolean | 'indeterminate') => {
    if (onChange) {
      // Convert 'indeterminate' to false for toggle behavior
      // User clicking indeterminate checkbox should uncheck it
      onChange(state === true);
    }
  };

  const labelClasses = [
    // Use custom label classes if provided, otherwise default
    labelClassName ?? 'text-body text-ss-text',
    'cursor-pointer select-none',
    disabled ? 'text-ss-text-disabled cursor-not-allowed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const wrapperClasses = [
    'inline-flex items-center gap-2',
    labelPosition === 'left' ? 'flex-row-reverse' : 'flex-row',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const checkboxElement = (
    <RadixCheckbox.Root
      id={checkboxId}
      checked={radixChecked}
      onCheckedChange={handleCheckedChange}
      disabled={disabled}
      name={name}
      value={value}
      required={required}
      className={checkboxClasses}
      data-testid={dataTestId}
      aria-label={ariaLabel}
    >
      <RadixCheckbox.Indicator className="flex items-center justify-center">
        {radixChecked === 'indeterminate' ? (
          <SubtractSvg className={iconClasses} />
        ) : (
          <CheckSvg className={iconClasses} />
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );

  // Without label, just return the checkbox
  if (!label) {
    return checkboxElement;
  }

  // With label, wrap in a container with the label
  return (
    <div className={wrapperClasses}>
      {checkboxElement}
      <label htmlFor={checkboxId} className={labelClasses}>
        {label}
      </label>
    </div>
  );
}
