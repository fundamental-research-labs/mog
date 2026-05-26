/**
 * ColorInput Primitive
 *
 * Color picker input with preview swatch.
 * Uses Tailwind classes mapped to design tokens from globals.css.
 */

import type { InputHTMLAttributes } from 'react';

interface ColorInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Show the hex value text next to the swatch */
  showValue?: boolean;
  /** Size of the color swatch */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * ColorInput - Reusable color picker primitive with consistent styling.
 *
 * @example
 * ```tsx
 * <ColorInput
 *   value={color}
 *   onChange={(e) => setColor(e.target.value)}
 * />
 * <ColorInput value="#ff0000" showValue size="lg" />
 * ```
 */
export function ColorInput({
  showValue = false,
  size = 'md',
  className = '',
  value,
  ...props
}: ColorInputProps) {
  // Default to black if no value provided
  const colorValue = (value as string) || '#000000';
  const sizes: Record<NonNullable<ColorInputProps['size']>, string> = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-10 h-10',
  };

  const inputClasses = [
    sizes[size],
    'p-0 border border-ss-border rounded cursor-pointer',
    'appearance-none bg-transparent',
    // Remove default browser styling for color input
    '[&::-webkit-color-swatch-wrapper]:p-0',
    '[&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded',
    '[&::-moz-color-swatch]:border-none [&::-moz-color-swatch]:rounded',
    // Focus state
    'focus:ring-2 focus:ring-ss-primary/20 focus:outline-none',
    // Disabled state
    'disabled:opacity-40 disabled:cursor-not-allowed',
  ].join(' ');

  if (!showValue) {
    return (
      <input
        type="color"
        value={colorValue}
        className={`${inputClasses} ${className}`}
        {...props}
      />
    );
  }

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <input type="color" value={colorValue} className={inputClasses} {...props} />
      <span className="text-caption text-ss-text-secondary font-ss-mono uppercase">
        {colorValue}
      </span>
    </div>
  );
}
