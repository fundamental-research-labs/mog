/**
 * DropdownMenu Radix Wrapper
 *
 * Wraps @radix-ui/react-dropdown-menu with our styling and API.
 * Uses semantic design tokens from tokens.css - never Tailwind defaults.
 *
 * CRITICAL: This fixes the submenu click bug in conditional formatting!
 * The old Popover-based implementation used manual click-outside detection,
 * which fired before click events in portaled submenus. Radix's DismissableLayer
 * uses a context-based layer stack that handles nested portals correctly.
 *
 */

import * as RadixDropdown from '@radix-ui/react-dropdown-menu';
import { ChevronRightSvg } from '@mog/icons';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { forwardRef } from 'react';
import { usePortalContainer } from '../../../contexts/PortalContainerContext';

import {
  cn,
  floatingContentWithAnimationClasses,
  menuItemClasses,
  menuLabelClasses,
  menuSeparatorClasses,
} from './styles';

// =============================================================================
// ROOT & TRIGGER
// =============================================================================

/**
 * DropdownMenu - Root component for dropdown menus.
 * Controls the open/closed state of the menu.
 */
export const DropdownMenu = RadixDropdown.Root;

/**
 * DropdownMenuTrigger - The element that opens/closes the dropdown.
 * Use with asChild to compose with custom trigger elements.
 *
 * @example
 * ```tsx
 * <DropdownMenuTrigger asChild>
 *   <Button>Open Menu</Button>
 * </DropdownMenuTrigger>
 * ```
 */
export const DropdownMenuTrigger = RadixDropdown.Trigger;

/**
 * DropdownMenuGroup - Groups related items together.
 */
export const DropdownMenuGroup = RadixDropdown.Group;

// =============================================================================
// CONTENT
// =============================================================================

export interface DropdownMenuContentProps extends ComponentPropsWithoutRef<
  typeof RadixDropdown.Content
> {
  /** Additional CSS classes */
  className?: string;
}

/**
 * DropdownMenuContent - The popover that contains the menu items.
 * Automatically rendered in a portal to avoid z-index issues.
 *
 * @example
 * ```tsx
 * <DropdownMenuContent align="start" sideOffset={4}>
 *   <DropdownMenuItem>Edit</DropdownMenuItem>
 *   <DropdownMenuItem>Delete</DropdownMenuItem>
 * </DropdownMenuContent>
 * ```
 */
export const DropdownMenuContent = forwardRef<HTMLDivElement, DropdownMenuContentProps>(
  function DropdownMenuContent({ className, children, sideOffset = 4, ...props }, ref) {
    const portalContainer = usePortalContainer();
    return (
      <RadixDropdown.Portal container={portalContainer}>
        <RadixDropdown.Content
          ref={ref}
          sideOffset={sideOffset}
          className={cn(floatingContentWithAnimationClasses, className)}
          {...props}
        >
          {children}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    );
  },
);
DropdownMenuContent.displayName = 'DropdownMenuContent';

// =============================================================================
// ITEM
// =============================================================================

export interface DropdownMenuItemProps extends Omit<
  ComponentPropsWithoutRef<typeof RadixDropdown.Item>,
  'className'
> {
  /** Item content (text label) */
  children: ReactNode;
  /** Icon displayed on the left side */
  icon?: ReactNode;
  /** Keyboard shortcut displayed on the right side */
  shortcut?: string;
  /** Whether this is a destructive action (styled in red) */
  destructive?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * DropdownMenuItem - Individual menu item.
 *
 * @example
 * ```tsx
 * <DropdownMenuItem icon={<EditIcon />} shortcut="Ctrl+E" onSelect={handleEdit}>
 *   Edit
 * </DropdownMenuItem>
 *
 * <DropdownMenuItem destructive onSelect={handleDelete}>
 *   Delete
 * </DropdownMenuItem>
 * ```
 */
export const DropdownMenuItem = forwardRef<HTMLDivElement, DropdownMenuItemProps>(
  ({ children, icon, shortcut, disabled, destructive, className, ...props }, ref) => (
    <RadixDropdown.Item
      ref={ref}
      disabled={disabled}
      className={cn(
        menuItemClasses,
        destructive && 'text-ss-error data-[highlighted]:bg-ss-error-bg',
        className,
      )}
      {...props}
    >
      {icon && <span className="w-4 h-4 flex items-center justify-center shrink-0">{icon}</span>}
      <span className="flex-1">{children}</span>
      {shortcut && (
        <kbd className="ml-auto pl-4 text-ribbon-compact text-ss-text-tertiary">{shortcut}</kbd>
      )}
    </RadixDropdown.Item>
  ),
);
DropdownMenuItem.displayName = 'DropdownMenuItem';

// =============================================================================
// SEPARATOR
// =============================================================================

export interface DropdownMenuSeparatorProps extends ComponentPropsWithoutRef<
  typeof RadixDropdown.Separator
> {
  /** Additional CSS classes */
  className?: string;
}

/**
 * DropdownMenuSeparator - Visual divider between groups of items.
 */
export const DropdownMenuSeparator = forwardRef<HTMLDivElement, DropdownMenuSeparatorProps>(
  ({ className, ...props }, ref) => (
    <RadixDropdown.Separator ref={ref} className={cn(menuSeparatorClasses, className)} {...props} />
  ),
);
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

// =============================================================================
// LABEL
// =============================================================================

export interface DropdownMenuLabelProps extends ComponentPropsWithoutRef<
  typeof RadixDropdown.Label
> {
  /** Label content */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * DropdownMenuLabel - Non-interactive section header.
 *
 * @example
 * ```tsx
 * <DropdownMenuLabel>Paste Options</DropdownMenuLabel>
 * <DropdownMenuItem>Paste</DropdownMenuItem>
 * <DropdownMenuItem>Paste Values</DropdownMenuItem>
 * ```
 */
export const DropdownMenuLabel = forwardRef<HTMLDivElement, DropdownMenuLabelProps>(
  ({ children, className, ...props }, ref) => (
    <RadixDropdown.Label ref={ref} className={cn(menuLabelClasses, className)} {...props}>
      {children}
    </RadixDropdown.Label>
  ),
);
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

// =============================================================================
// SUBMENU - CRITICAL FOR FIXING THE BUG!
// =============================================================================

/**
 * DropdownMenuSub - Submenu container.
 * This is the critical fix for the conditional formatting submenu bug.
 * Radix handles the click-outside coordination automatically.
 */
export const DropdownMenuSub = RadixDropdown.Sub;

export interface DropdownMenuSubTriggerProps extends Omit<
  ComponentPropsWithoutRef<typeof RadixDropdown.SubTrigger>,
  'className'
> {
  /** Trigger content (text label) */
  children: ReactNode;
  /** Icon displayed on the left side */
  icon?: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * DropdownMenuSubTrigger - The item that opens a submenu on hover.
 * Automatically shows a chevron indicator.
 *
 * @example
 * ```tsx
 * <DropdownMenuSub>
 *   <DropdownMenuSubTrigger icon={<RulesIcon />}>
 *     Highlight Cell Rules
 *   </DropdownMenuSubTrigger>
 *   <DropdownMenuSubContent>
 *     <DropdownMenuItem onSelect={handleGreaterThan}>Greater Than...</DropdownMenuItem>
 *   </DropdownMenuSubContent>
 * </DropdownMenuSub>
 * ```
 */
export const DropdownMenuSubTrigger = forwardRef<HTMLDivElement, DropdownMenuSubTriggerProps>(
  ({ children, icon, className, ...props }, ref) => (
    <RadixDropdown.SubTrigger
      ref={ref}
      className={cn(menuItemClasses, 'justify-between', className)}
      {...props}
    >
      <span className="flex items-center gap-2">
        {icon && <span className="w-4 h-4 flex items-center justify-center shrink-0">{icon}</span>}
        <span>{children}</span>
      </span>
      <ChevronRightSvg className="w-3 h-3 text-ss-text-secondary ml-2" />
    </RadixDropdown.SubTrigger>
  ),
);
DropdownMenuSubTrigger.displayName = 'DropdownMenuSubTrigger';

export interface DropdownMenuSubContentProps extends ComponentPropsWithoutRef<
  typeof RadixDropdown.SubContent
> {
  /** Additional CSS classes */
  className?: string;
}

/**
 * DropdownMenuSubContent - The popover that contains submenu items.
 * Rendered in a portal but correctly coordinated with parent menu.
 */
export const DropdownMenuSubContent = forwardRef<HTMLDivElement, DropdownMenuSubContentProps>(
  function DropdownMenuSubContent({ className, children, sideOffset = 2, ...props }, ref) {
    const portalContainer = usePortalContainer();
    return (
      <RadixDropdown.Portal container={portalContainer}>
        <RadixDropdown.SubContent
          ref={ref}
          sideOffset={sideOffset}
          className={cn(floatingContentWithAnimationClasses, className)}
          {...props}
        >
          {children}
        </RadixDropdown.SubContent>
      </RadixDropdown.Portal>
    );
  },
);
DropdownMenuSubContent.displayName = 'DropdownMenuSubContent';

// =============================================================================
// CHECKBOX ITEM
// =============================================================================

export interface DropdownMenuCheckboxItemProps extends ComponentPropsWithoutRef<
  typeof RadixDropdown.CheckboxItem
> {
  /** Item content (text label) */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * DropdownMenuCheckboxItem - Menu item with a checkbox.
 *
 * @example
 * ```tsx
 * <DropdownMenuCheckboxItem
 *   checked={showGridlines}
 *   onCheckedChange={setShowGridlines}
 * >
 *   Show Gridlines
 * </DropdownMenuCheckboxItem>
 * ```
 */
export const DropdownMenuCheckboxItem = forwardRef<HTMLDivElement, DropdownMenuCheckboxItemProps>(
  ({ children, className, ...props }, ref) => (
    <RadixDropdown.CheckboxItem
      ref={ref}
      className={cn(menuItemClasses, 'pl-8', className)}
      {...props}
    >
      <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
        <RadixDropdown.ItemIndicator>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2 6L5 9L10 3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </RadixDropdown.ItemIndicator>
      </span>
      {children}
    </RadixDropdown.CheckboxItem>
  ),
);
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';

// =============================================================================
// RADIO GROUP & RADIO ITEM
// =============================================================================

/**
 * DropdownMenuRadioGroup - Groups radio items together.
 */
export const DropdownMenuRadioGroup = RadixDropdown.RadioGroup;

export interface DropdownMenuRadioItemProps extends ComponentPropsWithoutRef<
  typeof RadixDropdown.RadioItem
> {
  /** Item content (text label) */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * DropdownMenuRadioItem - Menu item that acts as a radio button.
 *
 * @example
 * ```tsx
 * <DropdownMenuRadioGroup value={sortOrder} onValueChange={setSortOrder}>
 *   <DropdownMenuRadioItem value="asc">Ascending</DropdownMenuRadioItem>
 *   <DropdownMenuRadioItem value="desc">Descending</DropdownMenuRadioItem>
 * </DropdownMenuRadioGroup>
 * ```
 */
export const DropdownMenuRadioItem = forwardRef<HTMLDivElement, DropdownMenuRadioItemProps>(
  ({ children, className, ...props }, ref) => (
    <RadixDropdown.RadioItem
      ref={ref}
      className={cn(menuItemClasses, 'pl-8', className)}
      {...props}
    >
      <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
        <RadixDropdown.ItemIndicator>
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="4" cy="4" r="4" />
          </svg>
        </RadixDropdown.ItemIndicator>
      </span>
      {children}
    </RadixDropdown.RadioItem>
  ),
);
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem';
