/**
 * Button Primitive
 *
 * Base button component with variant and size props.
 * Uses Tailwind classes mapped to design tokens from globals.css.
 *
 * Features:
 * - Toggle buttons via aria-pressed with automatic styling
 * - Excel-like tactile feedback with subtle shadows and borders
 * - Clear focus-visible ring for keyboard navigation
 * - Proper disabled state styling
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style variant */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Size preset - xs is 22x22 for toolbar icon buttons (Excel 365 parity) */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Button content */
  children: ReactNode;
}

/**
 * Button - Reusable button primitive with consistent styling.
 *
 * @example
 * ```tsx
 * // Standard buttons
 * <Button variant="primary" onClick={handleSave}>Save</Button>
 * <Button variant="secondary" size="sm">Cancel</Button>
 * <Button variant="ghost" disabled>Disabled</Button>
 *
 * // Toolbar icon button (22x22 - Excel 365 parity)
 * <Button variant="ghost" size="xs">
 *   <BoldIcon />
 * </Button>
 *
 * // Toggle button with active state
 * <Button variant="ghost" size="xs" aria-pressed={isBold}>
 *   <BoldIcon />
 * </Button>
 * ```
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className = '', children, type = 'button', ...props },
  ref,
) {
  // Base styles with improved transitions for shadow/border
  const baseStyles = [
    'inline-flex items-center justify-center font-medium rounded cursor-pointer select-none',
    'transition-all duration-ss-fast', // transition-all for shadow/border animations
    'outline-none', // Remove default outline, we use focus-visible ring
  ].join(' ');

  // Focus-visible ring for keyboard accessibility
  const focusStyles =
    'focus-visible:ring-2 focus-visible:ring-ss-primary focus-visible:ring-offset-1';

  const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
    primary: [
      'bg-ss-primary text-ss-text-inverse border border-transparent',
      'hover:bg-ss-primary-hover hover:shadow-ss-button-hover',
      'active:bg-ss-primary-active active:shadow-ss-button-active',
    ].join(' '),
    secondary: [
      'bg-ss-surface text-ss-text-secondary border border-ss-border',
      'hover:bg-ss-surface-hover hover:shadow-ss-button-hover',
      'active:bg-ss-surface-active active:shadow-ss-button-active',
    ].join(' '),
    ghost: [
      'bg-transparent text-ss-text-secondary border border-transparent',
      // Hover: subtle background + shadow + border for depth
      'hover:bg-ss-surface-hover hover:border-ss-border-button-hover hover:shadow-ss-button-hover',
      // Active (mouse down): inset shadow for pressed feel
      'active:bg-ss-surface-active active:shadow-ss-button-active',
      // Pressed toggle state (aria-pressed="true")
      'aria-pressed:bg-ss-primary-light aria-pressed:text-ss-primary aria-pressed:shadow-ss-button-pressed',
    ].join(' '),
    danger: [
      'bg-ss-error text-ss-text-inverse border border-transparent',
      'hover:opacity-90 hover:shadow-ss-button-hover',
      'active:opacity-80 active:shadow-ss-button-active',
    ].join(' '),
  };

  const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
    xs: 'w-[22px] h-[22px] text-ribbon', // 22x22 toolbar icon buttons - Excel 365 parity
    sm: 'px-3 py-1.5 text-caption gap-1', // 12px
    md: 'px-4 py-2 text-body gap-1.5', // 14px
    lg: 'px-6 py-3 text-body-lg gap-2', // 16px
  };

  // Enhanced disabled state: more muted, grayscale filter for icons
  const disabledStyles =
    'disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed disabled:pointer-events-none disabled:shadow-none';

  const classes = [
    baseStyles,
    focusStyles,
    variants[variant],
    sizes[size],
    disabledStyles,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} type={type} className={classes} {...props}>
      {children}
    </button>
  );
});
