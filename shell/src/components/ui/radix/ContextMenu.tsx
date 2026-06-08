/**
 * Context Menu Radix Wrapper
 *
 * Wraps @radix-ui/react-context-menu with our design tokens and component API.
 * Replaces 580 lines of manual keyboard navigation with Radix's battle-tested implementation.
 *
 * Features provided by Radix (no manual implementation needed):
 * - Keyboard navigation (Arrow keys, Home/End)
 * - Type-ahead search
 * - Submenu positioning with viewport flip
 * - Click-outside dismissal
 * - Escape key handling
 * - Focus management
 * - Scroll/blur handling (NO ContextMenuOverlay needed!)
 *
 */

import * as RadixContextMenu from '@radix-ui/react-context-menu';
import { CheckSvg, ChevronRightSvg, CircleSvg } from '@mog/icons';
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
// ICONS (Internal)
// =============================================================================

function CheckIcon({ className }: { className?: string }) {
  return <CheckSvg className={className} style={{ width: 12, height: 12 }} />;
}

function ChevronRightIcon({ className }: { className?: string }) {
  return <ChevronRightSvg className={className} style={{ width: 12, height: 12 }} />;
}

function DotIcon({ className }: { className?: string }) {
  return <CircleSvg className={className} style={{ width: 8, height: 8 }} />;
}

const MAC_SYMBOL_SHORTCUT_REPLACEMENTS: Record<string, string> = {
  '\u2303': 'Control',
  '\u2325': 'Alt',
  '\u2318': 'Meta',
  '\u21E7': 'Shift',
};

export function toAriaKeyShortcuts(shortcut: string): string {
  const replacements: Record<string, string> = {
    alt: 'Alt',
    cmd: 'Meta',
    command: 'Meta',
    control: 'Control',
    ctrl: 'Control',
    del: 'Delete',
    delete: 'Delete',
    esc: 'Escape',
    escape: 'Escape',
    meta: 'Meta',
    opt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
  };

  return shortcut
    .split('+')
    .flatMap((token) => {
      const expanded: string[] = [];
      let remaining = token.trim();

      while (remaining.length > 0) {
        const replacement = MAC_SYMBOL_SHORTCUT_REPLACEMENTS[remaining[0]];
        if (!replacement) break;

        expanded.push(replacement);
        remaining = remaining.slice(1);
      }

      if (remaining) expanded.push(remaining);
      return expanded;
    })
    .map((token) => {
      const trimmed = token.trim();
      return replacements[trimmed.toLowerCase()] ?? trimmed;
    })
    .join('+');
}

// =============================================================================
// ROOT & TRIGGER
// =============================================================================

/**
 * Root context menu component. Manages state for open/closed menu.
 */
export const ContextMenu = RadixContextMenu.Root;

/**
 * Trigger area that responds to right-click events.
 * Wrap this around the content that should trigger the context menu.
 *
 * @example
 * ```tsx
 * <ContextMenu>
 *   <ContextMenuTrigger asChild>
 *     <div className="w-full h-full">Right-click me</div>
 *   </ContextMenuTrigger>
 *   <ContextMenuContent>
 *     <ContextMenuItem onSelect={handleCopy}>Copy</ContextMenuItem>
 *   </ContextMenuContent>
 * </ContextMenu>
 * ```
 */
export const ContextMenuTrigger = RadixContextMenu.Trigger;

/**
 * ContextMenuGroup - Groups related items together.
 */
export const ContextMenuGroup = RadixContextMenu.Group;

// =============================================================================
// CONTENT
// =============================================================================

export interface ContextMenuContentProps extends ComponentPropsWithoutRef<
  typeof RadixContextMenu.Content
> {
  /** Additional CSS classes */
  className?: string;
}

/**
 * Content container for context menu.
 * Renders in a portal with proper positioning and animations.
 *
 * Overflow handling uses Radix's built-in collision API: `avoidCollisions`
 * + `--radix-context-menu-content-available-height` clamp the menu height
 * to the visible viewport. Replaces the prior MutationObserver / rAF /
 * useLayoutEffect stack (UX-FIX string-matching transform bug — string-matching `transform`
 * polling was fragile to any Floating UI internal change).
 */
export const ContextMenuContent = forwardRef<HTMLDivElement, ContextMenuContentProps>(
  function ContextMenuContent({ className, children, style, ...props }, ref) {
    const portalContainer = usePortalContainer();
    return (
      <RadixContextMenu.Portal container={portalContainer}>
        <RadixContextMenu.Content
          ref={ref}
          avoidCollisions
          collisionPadding={8}
          style={{
            maxHeight: 'var(--radix-context-menu-content-available-height)',
            overflowY: 'auto',
            ...style,
          }}
          className={cn(floatingContentWithAnimationClasses, 'min-w-[180px]', className)}
          {...props}
        >
          {children}
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    );
  },
);
ContextMenuContent.displayName = 'ContextMenuContent';

// =============================================================================
// MENU ITEM
// =============================================================================

export interface ContextMenuItemProps extends Omit<
  ComponentPropsWithoutRef<typeof RadixContextMenu.Item>,
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

function renderContextMenuItemContent(
  children: ReactNode,
  icon?: ReactNode,
  shortcut?: string,
): ReactNode[] {
  const content: ReactNode[] = [];

  if (icon) {
    content.push(
      <span
        key="icon"
        aria-hidden="true"
        className="w-4 h-4 flex items-center justify-center shrink-0"
      >
        {icon}
      </span>,
    );
  }

  content.push(
    <span key="label" className="flex-1">
      {children}
    </span>,
  );

  if (shortcut) {
    content.push(
      <kbd
        key="shortcut"
        aria-hidden="true"
        data-shortcut={shortcut}
        className="ml-auto pl-4 text-ribbon-compact text-ss-text-tertiary"
      >
        {` ${shortcut}`}
      </kbd>,
    );
  }

  return content;
}

/**
 * Individual menu item with optional icon and shortcut.
 *
 * @example
 * ```tsx
 * <ContextMenuItem
 *   icon={<CopyIcon />}
 *   shortcut="Ctrl+C"
 *   onSelect={handleCopy}
 * >
 *   Copy
 * </ContextMenuItem>
 *
 * <ContextMenuItem destructive onSelect={handleDelete}>
 *   Delete
 * </ContextMenuItem>
 * ```
 */
export const ContextMenuItem = forwardRef<HTMLDivElement, ContextMenuItemProps>(
  ({ children, icon, shortcut, disabled, destructive, className, ...props }, ref) => (
    <RadixContextMenu.Item
      ref={ref}
      disabled={disabled}
      className={cn(
        menuItemClasses,
        destructive && 'text-ss-error data-[highlighted]:bg-ss-error-bg',
        className,
      )}
      aria-keyshortcuts={shortcut ? toAriaKeyShortcuts(shortcut) : undefined}
      {...props}
    >
      {renderContextMenuItemContent(children, icon, shortcut)}
    </RadixContextMenu.Item>
  ),
);
ContextMenuItem.displayName = 'ContextMenuItem';

// =============================================================================
// CHECKBOX ITEM
// =============================================================================

export interface ContextMenuCheckboxItemProps extends ComponentPropsWithoutRef<
  typeof RadixContextMenu.CheckboxItem
> {
  /** Item content (text label) */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Checkbox menu item for toggle options.
 *
 * @example
 * ```tsx
 * <ContextMenuCheckboxItem
 *   checked={showGridlines}
 *   onCheckedChange={setShowGridlines}
 * >
 *   Show Gridlines
 * </ContextMenuCheckboxItem>
 * ```
 */
export const ContextMenuCheckboxItem = forwardRef<HTMLDivElement, ContextMenuCheckboxItemProps>(
  ({ children, className, ...props }, ref) => (
    <RadixContextMenu.CheckboxItem
      ref={ref}
      className={cn(menuItemClasses, 'pl-8', className)}
      {...props}
    >
      {[
        <span
          key="indicator"
          aria-hidden="true"
          className="absolute left-2 flex h-4 w-4 items-center justify-center"
        >
          <RadixContextMenu.ItemIndicator>
            <CheckIcon className="text-ss-primary" />
          </RadixContextMenu.ItemIndicator>
        </span>,
        <span key="label" className="flex-1">
          {children}
        </span>,
      ]}
    </RadixContextMenu.CheckboxItem>
  ),
);
ContextMenuCheckboxItem.displayName = 'ContextMenuCheckboxItem';

// =============================================================================
// RADIO GROUP & RADIO ITEM
// =============================================================================

/**
 * ContextMenuRadioGroup - Groups radio items together.
 */
export const ContextMenuRadioGroup = RadixContextMenu.RadioGroup;

export interface ContextMenuRadioGroupProps extends ComponentPropsWithoutRef<
  typeof RadixContextMenu.RadioGroup
> {
  /** Radio items */
  children: ReactNode;
}

export interface ContextMenuRadioItemProps extends ComponentPropsWithoutRef<
  typeof RadixContextMenu.RadioItem
> {
  /** Item content (text label) */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Radio item for mutually exclusive selection.
 *
 * @example
 * ```tsx
 * <ContextMenuRadioGroup value={sortOrder} onValueChange={setSortOrder}>
 *   <ContextMenuRadioItem value="asc">Ascending</ContextMenuRadioItem>
 *   <ContextMenuRadioItem value="desc">Descending</ContextMenuRadioItem>
 * </ContextMenuRadioGroup>
 * ```
 */
export const ContextMenuRadioItem = forwardRef<HTMLDivElement, ContextMenuRadioItemProps>(
  ({ children, className, ...props }, ref) => (
    <RadixContextMenu.RadioItem
      ref={ref}
      className={cn(menuItemClasses, 'pl-8', className)}
      {...props}
    >
      {[
        <span
          key="indicator"
          aria-hidden="true"
          className="absolute left-2 flex h-4 w-4 items-center justify-center"
        >
          <RadixContextMenu.ItemIndicator>
            <DotIcon className="text-ss-primary" />
          </RadixContextMenu.ItemIndicator>
        </span>,
        <span key="label" className="flex-1">
          {children}
        </span>,
      ]}
    </RadixContextMenu.RadioItem>
  ),
);
ContextMenuRadioItem.displayName = 'ContextMenuRadioItem';

// =============================================================================
// SUBMENU
// =============================================================================

/**
 * Submenu container. Manages state for nested submenu.
 * This uses Radix's DismissableLayer which correctly handles click-outside
 * coordination between nested portals - fixing the conditional formatting submenu bug!
 */
export const ContextMenuSub = RadixContextMenu.Sub;

export interface ContextMenuSubTriggerProps extends Omit<
  ComponentPropsWithoutRef<typeof RadixContextMenu.SubTrigger>,
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
 * Trigger item for opening a submenu.
 * Shows a chevron icon on the right to indicate submenu presence.
 *
 * @example
 * ```tsx
 * <ContextMenuSub>
 *   <ContextMenuSubTrigger icon={<FormatIcon />}>
 *     Formatting
 *   </ContextMenuSubTrigger>
 *   <ContextMenuSubContent>
 *     <ContextMenuItem onSelect={handleBold}>Bold</ContextMenuItem>
 *   </ContextMenuSubContent>
 * </ContextMenuSub>
 * ```
 */
export const ContextMenuSubTrigger = forwardRef<HTMLDivElement, ContextMenuSubTriggerProps>(
  ({ children, icon, className, ...props }, ref) => (
    <RadixContextMenu.SubTrigger
      ref={ref}
      className={cn(menuItemClasses, 'justify-between', className)}
      {...props}
    >
      {[
        <span key="label" className="flex items-center gap-2">
          {icon ? (
            <span aria-hidden="true" className="w-4 h-4 flex items-center justify-center shrink-0">
              {icon}
            </span>
          ) : null}
          <span>{children}</span>
        </span>,
        <ChevronRightIcon key="chevron" className="text-ss-text-secondary ml-2" />,
      ]}
    </RadixContextMenu.SubTrigger>
  ),
);
ContextMenuSubTrigger.displayName = 'ContextMenuSubTrigger';

export interface ContextMenuSubContentProps extends ComponentPropsWithoutRef<
  typeof RadixContextMenu.SubContent
> {
  /** Additional CSS classes */
  className?: string;
}

/**
 * Content container for submenu.
 * Renders in a portal with proper positioning and animations.
 * Radix handles viewport flip automatically — `--radix-popper-available-height`
 * is the universal popper var Radix exposes for both root and sub-content
 * (the package does NOT expose `--radix-context-menu-sub-content-available-height`).
 */
export const ContextMenuSubContent = forwardRef<HTMLDivElement, ContextMenuSubContentProps>(
  function ContextMenuSubContent({ className, children, sideOffset = 2, style, ...props }, ref) {
    const portalContainer = usePortalContainer();
    return (
      <RadixContextMenu.Portal container={portalContainer}>
        <RadixContextMenu.SubContent
          ref={ref}
          sideOffset={sideOffset}
          avoidCollisions
          collisionPadding={8}
          style={{
            maxHeight: 'var(--radix-popper-available-height)',
            overflowY: 'auto',
            ...style,
          }}
          className={cn(floatingContentWithAnimationClasses, 'min-w-[160px]', className)}
          {...props}
        >
          {children}
        </RadixContextMenu.SubContent>
      </RadixContextMenu.Portal>
    );
  },
);
ContextMenuSubContent.displayName = 'ContextMenuSubContent';

// =============================================================================
// SEPARATOR
// =============================================================================

export interface ContextMenuSeparatorProps extends ComponentPropsWithoutRef<
  typeof RadixContextMenu.Separator
> {
  /** Additional CSS classes */
  className?: string;
}

/**
 * Visual separator between menu items or groups.
 */
export const ContextMenuSeparator = forwardRef<HTMLDivElement, ContextMenuSeparatorProps>(
  ({ className, ...props }, ref) => (
    <RadixContextMenu.Separator
      ref={ref}
      className={cn(menuSeparatorClasses, className)}
      {...props}
    />
  ),
);
ContextMenuSeparator.displayName = 'ContextMenuSeparator';

// =============================================================================
// LABEL
// =============================================================================

export interface ContextMenuLabelProps extends ComponentPropsWithoutRef<
  typeof RadixContextMenu.Label
> {
  /** Label content */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Section label/header for grouping menu items.
 * Non-interactive, used for labeling groups of items.
 *
 * @example
 * ```tsx
 * <ContextMenuLabel>Clipboard</ContextMenuLabel>
 * <ContextMenuItem onSelect={handleCut}>Cut</ContextMenuItem>
 * <ContextMenuItem onSelect={handleCopy}>Copy</ContextMenuItem>
 * <ContextMenuSeparator />
 * <ContextMenuLabel>Actions</ContextMenuLabel>
 * <ContextMenuItem onSelect={handleDelete}>Delete</ContextMenuItem>
 * ```
 */
export const ContextMenuLabel = forwardRef<HTMLDivElement, ContextMenuLabelProps>(
  ({ children, className, ...props }, ref) => (
    <RadixContextMenu.Label ref={ref} className={cn(menuLabelClasses, className)} {...props}>
      {children}
    </RadixContextMenu.Label>
  ),
);
ContextMenuLabel.displayName = 'ContextMenuLabel';
