/**
 * SectionLabel Primitive
 *
 * Small label used to title sections in pickers and panels.
 * Supports both compact (default) and form section header styles.
 */

import type { HTMLAttributes, ReactNode } from 'react';

interface SectionLabelProps extends HTMLAttributes<HTMLDivElement> {
  /** Label content */
  children: ReactNode;
  /** Size variant */
  size?: 'xs' | 'sm' | 'md';
  /** Whether to use uppercase with tracking (for form section headers) */
  uppercase?: boolean;
}

/**
 * SectionLabel - Consistent section header styling for pickers/panels.
 *
 * @example
 * ```tsx
 * // Compact (pickers)
 * <SectionLabel>Theme Colors</SectionLabel>
 *
 * // Form section header (uppercase, wider tracking)
 * <SectionLabel size="md" uppercase>Chart Type</SectionLabel>
 * ```
 */
export function SectionLabel({
  children,
  size = 'xs',
  uppercase = false,
  className = '',
  ...props
}: SectionLabelProps) {
  const sizes: Record<NonNullable<SectionLabelProps['size']>, string> = {
    xs: 'text-ribbon-group', // 9px - compact section headers
    sm: 'text-hint', // 11px - slightly larger headers
    md: 'text-caption', // 12px - form section headers
  };

  const classes = [
    sizes[size],
    'text-ss-text-secondary font-medium mb-1',
    uppercase && 'uppercase tracking-wide',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
}
