/**
 * Label Primitive
 *
 * Base label component for form fields.
 * Uses Tailwind classes mapped to design tokens from globals.css.
 */

import type { LabelHTMLAttributes, ReactNode } from 'react';

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /** Label content */
  children: ReactNode;
  /** Mark field as required (shows asterisk) */
  required?: boolean;
}

/**
 * Label - Reusable label primitive with consistent styling.
 *
 * @example
 * ```tsx
 * <Label htmlFor="email">Email Address</Label>
 * <Label required>Username</Label>
 * ```
 */
export function Label({ children, required = false, className = '', ...props }: LabelProps) {
  const classes = [
    // Base font size - uses text-label token (13px)
    'block text-label font-medium text-ss-text-secondary mb-1.5',
    'select-none',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <label className={classes} {...props}>
      {children}
      {required && <span className="text-ss-error ml-0.5">*</span>}
    </label>
  );
}
