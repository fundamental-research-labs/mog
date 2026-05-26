/**
 * GalleryItem
 *
 * An individual selectable item within a GallerySection. Displays a visual
 * preview (thumbnail, color swatch, chart preview, etc.) with an optional label.
 *
 * Used for visual galleries like:
 * - Chart subtypes (clustered column, stacked bar, etc.)
 * - Table styles (light, medium, dark color schemes)
 * - Cell styles (Good, Bad, Neutral with color swatches)
 *
 * Uses design tokens from globals.css for consistent styling.
 *
 * @example
 * ```tsx
 * // Chart variant with thumbnail
 * <GalleryItem
 * preview={<img src={clusteredColumnThumb} alt="" />}
 * label="Clustered Column"
 * onClick={ => insertChart('clustered-column')}
 * />
 *
 * // Cell style with color swatch
 * <GalleryItem
 * preview={<div className="w-full h-full bg-green-100 border border-green-600" />}
 * label="Good"
 * onClick={ => applyStyle('good')}
 * />
 *
 * // Without label (icon-only)
 * <GalleryItem
 * preview={<TableStylePreview colors={theme} />}
 * onClick={ => applyTableStyle(theme)}
 * />
 * ```
 */

import type { ReactNode } from 'react';
import { useCallback } from 'react';

interface GalleryItemProps {
  /** Visual preview content (image, svg, color swatch, etc.) */
  preview: ReactNode;
  /** Optional label displayed below preview */
  label?: string;
  /** Called when item is clicked */
  onClick?: () => void;
  /** Whether this item is currently selected/active */
  isSelected?: boolean;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Tooltip text on hover */
  title?: string;
  /** Additional class names */
  className?: string;
  /**
   * Stable selector for the chrome-symmetry harness (rendered as
   * `data-value`). Pair with the parent dropdown menu's
   * `data-testid="ribbon-dropdown-menu-<id>"` so the harness can pick a
   * specific gallery cell by value.
   */
  dataValue?: string;
}

/**
 * GalleryItem - Selectable item with visual preview.
 *
 * Features:
 * - Consistent hover/active/selected states
 * - Accessible keyboard navigation (Enter/Space)
 * - Optional label below preview
 * - Flexible preview content area
 */
export function GalleryItem({
  preview,
  label,
  onClick,
  isSelected = false,
  disabled = false,
  title,
  className = '',
  dataValue,
}: GalleryItemProps) {
  const handleClick = useCallback(() => {
    if (!disabled && onClick) {
      onClick();
    }
  }, [disabled, onClick]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick?.();
      }
    },
    [disabled, onClick],
  );

  return (
    <div
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      data-value={dataValue}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={title || label}
      aria-disabled={disabled}
      aria-selected={isSelected}
      className={`
 flex flex-col items-center justify-start
 p-1.5 rounded
 cursor-pointer select-none
 transition-all duration-ss-fast
 outline-none

 ${
   isSelected
     ? 'bg-ss-primary-light ring-2 ring-ss-primary'
     : 'hover:bg-ss-surface-hover active:bg-ss-surface-active'
 }

 ${disabled ? 'opacity-40 cursor-not-allowed pointer-events-none grayscale' : ''}

 focus-visible:ring-2 focus-visible:ring-ss-primary focus-visible:ring-offset-1

 ${className}
 `}
    >
      {/* Preview container - fixed aspect ratio for consistency */}
      <div
        className="
 w-full aspect-square
 flex items-center justify-center
 overflow-hidden rounded-ss-sm
 bg-ss-surface-secondary
 "
      >
        {preview}
      </div>

      {/* Optional label */}
      {label && (
        <span
          className="
 mt-1 w-full
 text-dropdown-header text-ss-text-secondary text-center
 leading-tight truncate
 "
        >
          {label}
        </span>
      )}
    </div>
  );
}
