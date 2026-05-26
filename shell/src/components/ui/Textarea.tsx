/**
 * Textarea Primitive
 *
 * Multi-line text input component with error state support.
 * Uses Tailwind classes mapped to design tokens from globals.css.
 * Styling matches Input primitive for visual consistency.
 */

import { forwardRef, type TextareaHTMLAttributes } from 'react';

// =============================================================================
// Types
// =============================================================================

interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  /** Show error styling */
  error?: boolean;
  /** Size preset - ribbon is for toolbar contexts */
  size?: 'sm' | 'md' | 'ribbon';
  /** Resize behavior */
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
  /** Called when value changes - simplified to just pass the string value */
  onChange?: (value: string) => void;
  /** Called with the native event if needed */
  onChangeEvent?: TextareaHTMLAttributes<HTMLTextAreaElement>['onChange'];
}

// =============================================================================
// Component
// =============================================================================

/**
 * Textarea - Reusable multi-line text input primitive with consistent styling.
 *
 * Matches Input primitive styling for visual consistency across forms.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Textarea
 *   value={message}
 *   onChange={setMessage}
 *   placeholder="Enter your message..."
 * />
 *
 * // With error state
 * <Textarea
 *   value={description}
 *   onChange={setDescription}
 *   error={hasError}
 *   aria-invalid={hasError}
 * />
 *
 * // Controlled resize
 * <Textarea
 *   value={notes}
 *   onChange={setNotes}
 *   resize="vertical"
 *   rows={4}
 * />
 *
 * // Using native event handler
 * <Textarea
 *   value={text}
 *   onChangeEvent={(e) => setText(e.target.value)}
 * />
 * ```
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    error = false,
    size = 'md',
    resize = 'vertical',
    className = '',
    onChange,
    onChangeEvent,
    rows = 3,
    ...props
  },
  ref,
) {
  // Size variants matching Input primitive
  const sizes: Record<NonNullable<TextareaProps['size']>, string> = {
    sm: 'px-2 py-1.5 text-body-sm',
    md: 'px-3 py-2.5 text-body',
    ribbon: 'px-2 py-1 text-ribbon',
  };

  // Resize utility classes
  const resizeClasses: Record<NonNullable<TextareaProps['resize']>, string> = {
    none: 'resize-none',
    vertical: 'resize-y',
    horizontal: 'resize-x',
    both: 'resize',
  };

  const classes = [
    // Base styles
    'w-full',
    sizes[size],
    'border rounded outline-none',
    'bg-ss-surface text-text',
    'transition-colors duration-ss-fast',
    // Minimum height for usability
    'min-h-[60px]',
    // Border color based on error state
    error ? 'border-ss-error' : 'border-ss-border',
    // Focus state
    'focus:border-ss-border-focus focus:ring-1 focus:ring-ss-primary/20',
    // Disabled state
    'disabled:bg-ss-surface-secondary disabled:text-ss-text-disabled disabled:cursor-not-allowed',
    // Placeholder
    'placeholder:text-ss-text-tertiary',
    // Resize behavior
    resizeClasses[resize],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // Handle change - support both simplified onChange and native onChangeEvent
  const handleChange: TextareaHTMLAttributes<HTMLTextAreaElement>['onChange'] = (e) => {
    onChange?.(e.target.value);
    onChangeEvent?.(e);
  };

  return <textarea ref={ref} className={classes} rows={rows} onChange={handleChange} {...props} />;
});
