/**
 * ColorSwatch Primitive
 *
 * Clickable color square used in color pickers throughout the app.
 * Handles selected, focused, and hover states consistently.
 *
 * Features:
 * - Automatic light color detection for visible borders
 * - Checkmark overlay for selected state
 * - Scale animation on hover
 * - Keyboard navigation support
 */

import type { ButtonHTMLAttributes } from 'react';

interface ColorSwatchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  /** The color to display (hex value) */
  color: string;
  /** Whether this swatch is currently selected */
  selected?: boolean;
  /** Whether this swatch is currently focused (keyboard nav) */
  focused?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Determine if a hex color is "light" (needs visible border).
 * Uses relative luminance calculation.
 *
 * Exported so decorative <span> swatches (e.g. inside BorderPicker /
 * BorderTab line-color triggers, where nesting <button> would break
 * hydration) can reuse the same threshold and stay visually consistent
 * with the interactive ColorSwatch.
 */
export function isLightColor(hex: string): boolean {
  // Remove # if present
  const cleanHex = hex.replace('#', '');

  // Handle 3-char hex
  const fullHex =
    cleanHex.length === 3
      ? cleanHex[0] + cleanHex[0] + cleanHex[1] + cleanHex[1] + cleanHex[2] + cleanHex[2]
      : cleanHex;

  const r = parseInt(fullHex.slice(0, 2), 16);
  const g = parseInt(fullHex.slice(2, 4), 16);
  const b = parseInt(fullHex.slice(4, 6), 16);

  // Calculate relative luminance (simplified)
  // Colors with luminance > 0.7 need visible borders
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.7;
}

/**
 * ColorSwatch - Reusable color square for color pickers.
 *
 * @example
 * ```tsx
 * <ColorSwatch
 *   color="#FF0000"
 *   selected={currentColor === '#FF0000'}
 *   onClick={() => setColor('#FF0000')}
 * />
 * ```
 */
export function ColorSwatch({
  color,
  selected = false,
  focused = false,
  size = 'sm',
  className = '',
  ...props
}: ColorSwatchProps) {
  const sizes: Record<NonNullable<ColorSwatchProps['size']>, string> = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-7 h-7',
  };

  const isLight = isLightColor(color);

  const classes = [
    // Base
    sizes[size],
    'relative rounded-ss-sm cursor-pointer p-0 outline-none',
    'transition-all duration-ss-fast',
    // Border: stronger on light colors for visibility
    isLight ? 'border border-ss-border' : 'border border-transparent',
    // Hover state
    'hover:scale-110 hover:shadow-ss-sm hover:border-text-tertiary',
    // Focus/selected states - ring around the swatch
    // focus: handles native browser focus (keyboard nav, programmatic .focus())
    'focus:ring-2 focus:ring-ss-primary focus:ring-offset-1',
    selected || focused ? 'ring-2 ring-ss-primary ring-offset-1' : '',
    focused ? 'scale-110 z-10' : '',
    // Disabled
    'disabled:cursor-not-allowed disabled:opacity-50',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      data-testid="color-swatch"
      data-color={color}
      data-value={color}
      className={classes}
      style={{ backgroundColor: color }}
      title={color}
      aria-label={`Select color ${color}`}
      aria-pressed={selected}
      {...props}
    >
      {/* Checkmark overlay for selected state */}
      {selected && (
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 8l3 3 5-6"
            stroke={isLight ? '#000' : '#fff'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
