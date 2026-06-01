/**
 * RadioGroup Radix Wrapper
 *
 * Radio button group built on @radix-ui/react-radio-group.
 * Uses our semantic design tokens (not Tailwind defaults).
 *
 * Features:
 * - Simple label-only options
 * - Rich options with description text
 * - Horizontal and vertical layouts
 * - Disabled option support (per-option and group-level)
 * - Full accessibility (ARIA and keyboard nav via Radix)
 *
 */

import * as RadixRadioGroup from '@radix-ui/react-radio-group';

// =============================================================================
// Types
// =============================================================================

export interface RadioOption {
  /** Option value */
  value: string;
  /** Display label */
  label: string;
  /** Optional description text below the label */
  description?: string;
  /** Disable this option */
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Form field name (groups radio buttons) */
  name: string;
  /** Available options */
  options: RadioOption[];
  /** Currently selected value */
  value: string;
  /** Called when selection changes */
  onChange: (value: string) => void;
  /** Layout direction */
  orientation?: 'horizontal' | 'vertical';
  /** Size variant */
  size?: 'sm' | 'md';
  /** Disable all options */
  disabled?: boolean;
  /** Additional class names */
  className?: string;
  /** ARIA label for the radiogroup */
  'aria-label'?: string;
  /** ID of element labelling this radiogroup */
  'aria-labelledby'?: string;
}

// =============================================================================
// Styles
// =============================================================================

const radioClasses = [
  'h-4 w-4',
  'rounded-full',
  'border border-ss-border',
  'bg-ss-surface',
  'data-[state=checked]:border-ss-primary',
  'data-[disabled]:opacity-50',
  'data-[disabled]:cursor-not-allowed',
  'focus:outline-none focus:ring-2 focus:ring-ss-primary focus:ring-offset-1',
  'cursor-pointer',
  'shrink-0',
  'overflow-hidden text-[0px] leading-none',
].join(' ');

// Empirical workaround: Tailwind v4 in this workspace does NOT compile
// `after:*` pseudo-element variants into CSS, even though
// `shell/src/styles/globals.css:16` sets the scan root to the workspace
// root via `@import 'tailwindcss' source('../../..')`. Verified twice
// (once on `c38453e8e`, once on this branch) by running app-eval and
// reading `getComputedStyle(indicator, '::after').backgroundColor` —
// returns `rgba(0,0,0,0)` with `content: none`. A canonical
// Radix-Tailwind `after:bg-* after:content-['']` Indicator renders with
// no fill. The root cause inside Tailwind/Vite hasn't been isolated; it
// is NOT (as a prior comment claimed) that JIT only scans `apps/`.
//
// Until that is fixed at the toolchain layer, render the dot as an
// explicit child <span> using non-prefixed utility classes. The
// regression test below asserts both halves of this contract.
const indicatorClasses = 'flex items-center justify-center w-full h-full';

// =============================================================================
// Component
// =============================================================================

/**
 * RadioGroup - Radio button group built on Radix UI primitives.
 *
 * Supports both simple label-only options and rich options with descriptions.
 *
 * @example
 * ```tsx
 * // Simple options
 * <RadioGroup
 *   name="alignment"
 *   value={alignment}
 *   onChange={setAlignment}
 *   options={[
 *     { value: 'left', label: 'Left' },
 *     { value: 'center', label: 'Center' },
 *     { value: 'right', label: 'Right' },
 *   ]}
 * />
 *
 * // Horizontal layout
 * <RadioGroup
 *   name="size"
 *   value={size}
 *   onChange={setSize}
 *   orientation="horizontal"
 *   options={[
 *     { value: 'sm', label: 'Small' },
 *     { value: 'md', label: 'Medium' },
 *     { value: 'lg', label: 'Large' },
 *   ]}
 * />
 *
 * // With descriptions
 * <RadioGroup
 *   name="dataType"
 *   value={dataType}
 *   onChange={setDataType}
 *   options={[
 *     {
 *       value: 'delimited',
 *       label: 'Delimited',
 *       description: 'Characters such as commas or tabs separate each field'
 *     },
 *     {
 *       value: 'fixedWidth',
 *       label: 'Fixed width',
 *       description: 'Fields are aligned in columns with spaces between them'
 *     },
 *   ]}
 * />
 * ```
 */
export function RadioGroup({
  name,
  options,
  value,
  onChange,
  orientation = 'vertical',
  size = 'md',
  disabled,
  className = '',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: RadioGroupProps) {
  // Check if any option has a description (changes layout)
  const hasDescriptions = options.some((opt) => opt.description);

  // Size variants use semantic tokens
  const labelSizeClass = size === 'sm' ? 'text-body-sm' : 'text-body';

  const rootClasses = [
    orientation === 'horizontal' ? 'flex flex-wrap gap-4' : 'flex flex-col gap-2.5',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <RadixRadioGroup.Root
      name={name}
      value={value}
      onValueChange={onChange}
      orientation={orientation}
      disabled={disabled}
      className={rootClasses}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
    >
      {options.map((opt) => {
        const itemDisabled = disabled || opt.disabled;
        // Use items-start alignment when descriptions are present
        const alignmentClass = hasDescriptions ? 'items-start' : 'items-center';

        const labelClasses = [
          'flex gap-2 cursor-pointer select-none',
          alignmentClass,
          labelSizeClass,
          'text-ss-text',
          itemDisabled && 'opacity-50 cursor-not-allowed',
        ]
          .filter(Boolean)
          .join(' ');

        const radioItemClasses = [radioClasses, hasDescriptions && 'mt-0.5']
          .filter(Boolean)
          .join(' ');

        return (
          <label key={opt.value} className={labelClasses}>
            <RadixRadioGroup.Item
              value={opt.value}
              disabled={itemDisabled}
              className={radioItemClasses}
              aria-label={opt.label}
            >
              {opt.label}
              <RadixRadioGroup.Indicator className={indicatorClasses}>
                <span className="block w-2 h-2 rounded-full bg-ss-primary" />
              </RadixRadioGroup.Indicator>
            </RadixRadioGroup.Item>
            {opt.description ? (
              <div>
                <span className="font-medium">{opt.label}</span>
                <div className="text-caption text-ss-text-secondary mt-0.5">{opt.description}</div>
              </div>
            ) : (
              opt.label
            )}
          </label>
        );
      })}
    </RadixRadioGroup.Root>
  );
}
