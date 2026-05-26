/**
 * Input Primitive
 *
 * Base text input component with error state and size variants.
 * Uses Tailwind classes mapped to design tokens from globals.css.
 */

import { forwardRef, type InputHTMLAttributes } from 'react';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Show error styling */
  error?: boolean;
  /** Size preset - sm is compact for inline forms, ribbon is for toolbar contexts */
  size?: 'sm' | 'md' | 'ribbon';
}

/**
 * Input - Reusable text input primitive with consistent styling.
 *
 * @example
 * ```tsx
 * // Standard form input
 * <Input placeholder="Enter value..." />
 * <Input type="number" value={count} onChange={handleChange} />
 * <Input error={hasError} aria-invalid={hasError} />
 *
 * // Compact input for inline forms
 * <Input size="sm" type="number" className="w-20" />
 *
 * // With ref for focus management
 * <Input ref={inputRef} />
 * ```
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { error = false, size = 'md', className = '', ...props },
  ref,
) {
  const sizes: Record<NonNullable<InputProps['size']>, string> = {
    sm: 'px-2 py-1.5 text-body-sm', // Compact for inline forms
    md: 'px-3 py-2.5 text-body', // Standard form input
    ribbon: 'px-2 py-0 text-ribbon', // Toolbar/ribbon contexts (11px)
  };

  const classes = [
    // Base styles
    'w-full border rounded outline-none',
    'bg-ss-surface text-text',
    'transition-colors duration-ss-fast',
    // Size
    sizes[size],
    // Border color based on error state
    error ? 'border-ss-error' : 'border-ss-border',
    // Focus state
    'focus:border-ss-border-focus focus:ring-1 focus:ring-ss-primary/20',
    // Disabled state
    'disabled:bg-ss-surface-secondary disabled:text-ss-text-disabled disabled:cursor-not-allowed',
    // Placeholder
    'placeholder:text-ss-text-tertiary',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <input ref={ref} className={classes} {...props} />;
});
