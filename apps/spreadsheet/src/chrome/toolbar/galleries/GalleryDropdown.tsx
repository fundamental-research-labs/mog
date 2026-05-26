/**
 * GalleryDropdown
 *
 * Container for visual gallery dropdowns like Chart types, Table Styles, Cell Styles.
 * Uses Radix UI Popover for correct portal handling, click-outside, and escape key behavior.
 *
 * This component wraps Radix Popover with gallery-specific styling:
 * - Grid layout with configurable columns
 * - Proper padding and spacing for gallery items
 * - Support for sections with titles
 *
 * COLLAPSE SUPPORT (
 * GalleryDropdown reads GroupRenderModeContext to adapt its sizing.
 * - 'compact' mode: Uses fewer columns for more compact display
 * - 'icons' mode: Same as compact (trigger is icon-only, gallery still full)
 * - 'full' mode: Uses preferred column count
 *
 * Uses semantic design tokens from tokens.css for consistent styling.
 *
 * @example
 * ```tsx
 * <GalleryDropdown
 * open={isOpen}
 * onClose={ => setIsOpen(false)}
 * trigger={<RibbonButton layout="vertical" height="full" icon={<StylesIcon />} label="Cell Styles" hasDropdown />}
 * columns={4}
 * >
 * <GallerySection title="Good, Bad and Neutral">
 * <GalleryItem preview={<ColorSwatch bg="green" />} label="Good" onClick={...} />
 * <GalleryItem preview={<ColorSwatch bg="red" />} label="Bad" onClick={...} />
 * </GallerySection>
 * </GalleryDropdown>
 * ```
 *
 */

import type { ReactNode } from 'react';
import React, { useCallback } from 'react';

import { cn, Popover, PopoverContent, PopoverTrigger } from '@mog/shell';
import type { GroupRenderMode } from '@mog-sdk/contracts/ribbon';

import { useGroupRenderMode } from '../collapse';

// =============================================================================
// Types
// =============================================================================

type DropdownPosition = 'bottom-left' | 'bottom-right';

interface GalleryDropdownProps {
  /** Whether the dropdown is open */
  open: boolean;
  /** Called when dropdown should close */
  onClose: () => void;
  /** The trigger element (typically RibbonButton) */
  trigger: ReactNode;
  /** Gallery content (GallerySections and GalleryItems) */
  children: ReactNode;
  /** Number of columns in the grid (for GalleryItem children) */
  columns?: 3 | 4 | 5 | 6;
  /** Width preset */
  width?: 'sm' | 'md' | 'lg' | 'xl' | 'auto';
  /** Position relative to trigger */
  position?: DropdownPosition;
  /** Additional class names for the dropdown panel */
  className?: string;
}

// Width presets for galleries
const WIDTH_MAP: Record<string, string> = {
  sm: 'min-w-[240px]',
  md: 'min-w-[320px]',
  lg: 'min-w-[400px]',
  xl: 'min-w-[480px]',
  auto: 'min-w-[240px]',
};

// =============================================================================
// Collapse Support
// =============================================================================

/**
 * Derive effective column count based on group render mode.
 * In compact modes, reduce columns to fit narrower space.
 */
function deriveColumns(preferredColumns: 3 | 4 | 5 | 6, groupMode: GroupRenderMode): number {
  // In compact or icons mode, reduce columns for narrower display
  if (groupMode === 'compact' || groupMode === 'icons') {
    return Math.max(3, preferredColumns - 1);
  }

  // In full mode, use preferred columns
  return preferredColumns;
}

// =============================================================================
// Component
// =============================================================================

/**
 * GalleryDropdown - Container for visual gallery menus.
 *
 * Features:
 * - Radix Popover for correct nested portal handling
 * - CSS variable for columns (--gallery-columns) for child grids
 * - Click-outside and Escape key handling (via Radix)
 * - Smooth entrance animation
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 */
export const GalleryDropdown = React.memo(function GalleryDropdown({
  open,
  onClose,
  trigger,
  children,
  columns: preferredColumns = 4,
  width = 'md',
  position = 'bottom-left',
  className = '',
}: GalleryDropdownProps) {
  // Get group render mode from context (collapse support)
  const groupMode = useGroupRenderMode();

  // Derive effective columns based on collapse mode
  const columns = deriveColumns(preferredColumns, groupMode);

  // Handle open state changes from Radix
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        onClose();
      }
    },
    [onClose],
  );

  const widthClass = WIDTH_MAP[width] || WIDTH_MAP.md;

  // Map position prop to Radix side/align
  const align = position === 'bottom-right' ? 'end' : 'start';

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/* Trigger wrapper - asChild merges props onto the child */}
      <PopoverTrigger asChild>
        <div className="inline-flex">{trigger}</div>
      </PopoverTrigger>

      {/* Gallery panel - Radix handles portal, click-outside, escape */}
      <PopoverContent
        side="bottom"
        align={align}
        sideOffset={4}
        className={cn(
          widthClass,
          'bg-ss-surface border border-ss-border rounded-ss-md shadow-ss-dropdown',
          'z-ss-popover p-2',
          className,
        )}
        style={
          {
            // Expose columns as CSS variable for child grids
            '--gallery-columns': columns.toString(),
          } as React.CSSProperties & { '--gallery-columns': string }
        }
        role="menu"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
});
