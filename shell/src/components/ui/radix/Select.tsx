/**
 * Select Radix Wrapper
 *
 * Wraps @radix-ui/react-select. Replaces the styled native `<select>`
 * primitive that lived at `shell/src/components/ui/Select.tsx`.
 *
 * Why Radix (not native):
 * - Native `<select>` opens an OS-controlled popup that DOM
 *   `querySelector` cannot reach. Open-state styling, hover tokens,
 *   keyboard parity, and accessible focus rings can't be expressed
 *   on the native primitive.
 * - The chevron arrow is an explicit `<svg>` child here — not a long
 *   `bg-[url(data:image/svg+xml,…)]` arbitrary-value Tailwind class
 *   (Tailwind v4 JIT does not extract that encoded URL).
 *
 * API mirrors RadioGroup: declarative `value` / `onChange(value)`.
 *
 */

import { ChevronDownSvg, CheckmarkSvg } from '@mog/icons';
import * as RadixSelect from '@radix-ui/react-select';
import { usePortalContainer } from '../../../contexts/PortalContainerContext';

import { cn, selectContentClasses, selectItemClasses, selectTriggerClasses } from './styles';

// =============================================================================
// Types
// =============================================================================

export interface SelectOption {
  /** Option value */
  value: string;
  /** Display label */
  label: string;
  /** Disable this option */
  disabled?: boolean;
}

export interface SelectProps {
  /** Available options */
  options: readonly SelectOption[];
  /**
   * Currently selected value. Pass `undefined` to render the placeholder
   * (used for mixed-state controls in the Format Cells dialog).
   */
  value?: string;
  /** Called when selection changes */
  onChange: (value: string) => void;
  /** Placeholder rendered when value is empty/undefined */
  placeholder?: string;
  /** Disable the entire select */
  disabled?: boolean;
  /**
   * Size variant.
   * - `xs` = compact toolbar (h-7).
   * - `sm` = dialog standard (h-8).
   * - `md` = comfortable form (default).
   */
  size?: 'xs' | 'sm' | 'md';
  /** Surface error border tone */
  error?: boolean;
  /** Additional class names applied to the trigger */
  className?: string;
  /** Trigger ID (use with `<label htmlFor>`) */
  id?: string;
  /** ARIA label when there is no visible label */
  'aria-label'?: string;
  /** Stable test selector forwarded to the trigger */
  'data-testid'?: string;
}

// =============================================================================
// Size variants
// =============================================================================

const triggerSizeClasses: Record<NonNullable<SelectProps['size']>, string> = {
  xs: 'h-7 px-1 py-0 text-ribbon',
  sm: 'h-8 px-2 py-1 text-dropdown',
  md: 'px-3 py-2 text-body',
};

const MIXED_VALUE = '__mog_select_mixed__';

function toRadixOptionValue(index: number): string {
  return `__mog_select_option_${index}__`;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Select - Radix-based select with consistent styling and a declarative
 * `onChange(value)` API.
 *
 * @example
 * ```tsx
 * <Select
 *   value={alignment}
 *   onChange={setAlignment}
 *   options={[
 *     { value: 'left', label: 'Left' },
 *     { value: 'center', label: 'Center' },
 *     { value: 'right', label: 'Right' },
 *   ]}
 * />
 * ```
 */
export function Select({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  size = 'md',
  error = false,
  className,
  id,
  'aria-label': ariaLabel,
  'data-testid': dataTestId,
}: SelectProps) {
  const portalContainer = usePortalContainer();
  const triggerClasses = cn(selectTriggerClasses, triggerSizeClasses[size], className);

  // Mixed-state support: when `value` is undefined, render a controlled Root
  // with a sentinel that matches no option so RadixSelect.Value falls back to
  // the placeholder. Using a sentinel (instead of leaving value uncontrolled)
  // keeps the Root controlled across the lifetime of the component, so React
  // does not warn when the user picks a real value.
  //
  // Radix reserves the empty string as the "clear selection / show placeholder"
  // root value and forbids <Select.Item value="">. The Mog Select API still
  // allows a real empty-string option for UI concepts like "(none)" and
  // "Automatic", so the wrapper maps public option values to private non-empty
  // Radix values and maps them back in onChange.
  const radixOptions = options.map((opt, index) => ({
    option: opt,
    value: toRadixOptionValue(index),
  }));
  const selectedOption = radixOptions.find((opt) => opt.option.value === value);
  const radixValue = value === undefined ? MIXED_VALUE : (selectedOption?.value ?? value);

  return (
    <RadixSelect.Root
      value={radixValue}
      onValueChange={(nextValue) => {
        const selected = radixOptions.find((opt) => opt.value === nextValue);
        onChange(selected?.option.value ?? nextValue);
      }}
      disabled={disabled}
    >
      <RadixSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        data-testid={dataTestId}
        data-value={value}
        data-error={error || undefined}
        className={triggerClasses}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon asChild>
          <ChevronDownSvg className="h-3 w-3 shrink-0 text-ss-text-secondary" aria-hidden="true" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal container={portalContainer}>
        <RadixSelect.Content className={selectContentClasses} position="popper" sideOffset={4}>
          <RadixSelect.Viewport className="p-1">
            {radixOptions.map(({ option: opt, value: optionValue }) => (
              <RadixSelect.Item
                key={optionValue}
                value={optionValue}
                disabled={opt.disabled}
                data-value={opt.value}
                className={selectItemClasses}
              >
                <RadixSelect.ItemIndicator className="absolute left-2 inline-flex items-center justify-center">
                  <CheckmarkSvg className="h-3 w-3 text-ss-primary" aria-hidden="true" />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
