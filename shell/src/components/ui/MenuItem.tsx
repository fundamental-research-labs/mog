/**
 * Standalone Menu Item Components
 *
 * Use these components for menu-like items inside Popovers or panels
 * where you need menu styling but don't have a Radix DropdownMenu context.
 *
 * WHY THIS EXISTS:
 * Radix's DropdownMenuItem requires being inside a DropdownMenu.Root context.
 * For complex panels like FilterDropdown (which has tabs, inputs, checkboxes),
 * DropdownMenu is the wrong primitive - Popover is correct.
 * But we still want consistent menu item styling for action buttons.
 *
 * WHEN TO USE:
 * - MenuItem: Inside Popover/Panel for action buttons that look like menu items
 * - DropdownMenuItem: Inside DropdownMenu for trigger-based action menus
 *
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef, useState } from 'react';

import { cn, menuItemClasses, menuSeparatorClasses } from './radix/styles';

// =============================================================================
// MenuItem
// =============================================================================

export interface MenuItemProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'className' | 'disabled'
> {
  /** Item content (text label) */
  children: ReactNode;
  /** Icon displayed on the left side */
  icon?: ReactNode;
  /** Keyboard shortcut displayed on the right side */
  shortcut?: string;
  /** Whether this item is disabled */
  disabled?: boolean;
  /** Whether this is a destructive action (styled in red) */
  destructive?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Called when the item is selected (clicked) */
  onSelect?: () => void;
}

/**
 * Standalone menu item for use in Popovers and panels.
 *
 * Use this instead of DropdownMenuItem when not inside a DropdownMenu context.
 * Provides identical styling to DropdownMenuItem but without context requirements.
 *
 * @example
 * ```tsx
 * <Popover open={isOpen} onOpenChange={setIsOpen}>
 *   <PopoverAnchor virtualRef={virtualRef} />
 *   <PopoverContent>
 *     <MenuItem icon={<SortAscIcon />} onSelect={handleSortAsc}>
 *       Sort A to Z
 *     </MenuItem>
 *     <MenuItem icon={<SortDescIcon />} onSelect={handleSortDesc}>
 *       Sort Z to A
 *     </MenuItem>
 *     <MenuSeparator />
 *     <MenuItem destructive onSelect={handleClear}>
 *       Clear Filter
 *     </MenuItem>
 *   </PopoverContent>
 * </Popover>
 * ```
 */
export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(
  (
    {
      children,
      icon,
      shortcut,
      disabled,
      destructive,
      className,
      onSelect,
      onClick,
      onMouseEnter,
      onMouseLeave,
      ...buttonProps
    },
    ref,
  ) => {
    const [isHighlighted, setIsHighlighted] = useState(false);

    return (
      <button
        {...buttonProps}
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented && !disabled) {
            onSelect?.();
          }
        }}
        onMouseEnter={(event) => {
          setIsHighlighted(true);
          onMouseEnter?.(event);
        }}
        onMouseLeave={(event) => {
          setIsHighlighted(false);
          onMouseLeave?.(event);
        }}
        className={cn(
          menuItemClasses,
          'w-full text-left',
          // Manual highlight state (since not using Radix data-[highlighted])
          isHighlighted && !disabled && 'bg-ss-surface-hover',
          // Destructive styling
          destructive && 'text-ss-error',
          destructive && isHighlighted && !disabled && 'bg-ss-error-bg',
          className,
        )}
      >
        {icon && <span className="w-4 h-4 flex items-center justify-center shrink-0">{icon}</span>}
        <span className="flex-1">{children}</span>
        {shortcut && (
          <kbd className="ml-auto pl-4 text-ribbon-compact text-ss-text-tertiary">{shortcut}</kbd>
        )}
      </button>
    );
  },
);
MenuItem.displayName = 'MenuItem';

// =============================================================================
// MenuSeparator
// =============================================================================

export interface MenuSeparatorProps {
  /** Additional CSS classes */
  className?: string;
}

/**
 * Standalone menu separator for use in Popovers and panels.
 *
 * Use this instead of DropdownMenuSeparator when not inside a DropdownMenu context.
 */
export function MenuSeparator({ className }: MenuSeparatorProps) {
  return <div className={cn(menuSeparatorClasses, className)} role="separator" />;
}
