/**
 * RibbonDropdown
 *
 * Single source of truth for all ribbon/toolbar dropdown menus.
 * Now uses the Popover primitive internally for portal rendering,
 * positioning, and dismiss logic.
 *
 * @example
 * ```tsx
 * // Simple dropdown
 * <RibbonDropdown
 * open={isOpen}
 * onOpenChange={setIsOpen}
 * trigger={<Button>Click me</Button>}
 * >
 * <RibbonDropdownItem onClick={handleAction}>Action</RibbonDropdownItem>
 * </RibbonDropdown>
 *
 * // With submenu
 * <RibbonDropdown open={isOpen} onOpenChange={setIsOpen} trigger={...}>
 * <RibbonDropdownSubmenu label="More options">
 * <RibbonDropdownItem onClick={...}>Sub-action</RibbonDropdownItem>
 * </RibbonDropdownSubmenu>
 * </RibbonDropdown>
 * ```
 */

import type { ReactNode } from 'react';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@mog/shell';

// =============================================================================
// Context for nested dropdowns
// =============================================================================

interface RibbonDropdownContextValue {
  /** Close the entire dropdown tree */
  closeAll: () => void;
  /** Current nesting level (0 = root) */
  level: number;
}

const RibbonDropdownContext = createContext<RibbonDropdownContextValue>({
  closeAll: () => {},
  level: 0,
});

// =============================================================================
// Types
// =============================================================================

type DropdownPosition = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
type DropdownWidth = 'auto' | 'sm' | 'md' | 'lg' | number;

interface RibbonDropdownProps {
  /** Whether the dropdown is open */
  open: boolean;
  /** Called when open state should change */
  onOpenChange: (open: boolean) => void;
  /** The trigger element (button that opens the dropdown) */
  trigger: ReactNode;
  /** Dropdown content */
  children: ReactNode;
  /** Position relative to trigger */
  position?: DropdownPosition;
  /** Width preset or pixel value */
  width?: DropdownWidth;
  /** Additional class names for the dropdown panel */
  className?: string;
  /** Additional class names for the container */
  containerClassName?: string;
  /** Accessible label for the dropdown menu */
  menuLabel?: string;
  /**
   * Stable selector for the dropdown menu wrapper (rendered on the
   * PopoverContent as `data-testid`). Convention is
   * `ribbon-dropdown-menu-<id>`; pair with the trigger's
   * `data-testid="ribbon-dropdown-<id>"` for the generalized testid
   * contract. Optional so existing callers that wrap children in a
   * dedicated `<div data-testid="...">` keep working unchanged.
   */
  menuTestId?: string;
  /**
   * Manual trigger mode - when true, the trigger element controls when to open/close.
   * Use this for SplitButton or other triggers with multiple click zones where
   * only part of the trigger should open the dropdown.
   *
   * When true, clicking the trigger does NOT auto-toggle the dropdown.
   * The trigger must call onOpenChange explicitly (e.g., via onDropdownClick).
   */
  manualTrigger?: boolean;
}

// =============================================================================
// Position mapping utilities
// =============================================================================

/**
 * Map our position prop to Popover's side/align props
 */
function mapPositionToSideAlign(position: DropdownPosition): {
  side: 'top' | 'bottom' | 'left' | 'right';
  align: 'start' | 'center' | 'end';
} {
  switch (position) {
    case 'bottom-left':
      return { side: 'bottom', align: 'start' };
    case 'bottom-right':
      return { side: 'bottom', align: 'end' };
    case 'top-left':
      return { side: 'top', align: 'start' };
    case 'top-right':
      return { side: 'top', align: 'end' };
  }
}

/**
 * Convert width prop to appropriate className
 */
// Dropdown width presets
function getWidthClassName(width: DropdownWidth, additionalClassName: string = ''): string {
  let widthClass = '';
  if (typeof width === 'number') {
    // For numeric widths, we'll use inline style via the className approach
    // This is a simplification - numeric widths will need a wrapper or style prop
    widthClass = `w-[${width}px]`;
  } else {
    switch (width) {
      case 'sm':
        widthClass = 'w-48'; // 192px
        break;
      case 'md':
        widthClass = 'w-64'; // 256px
        break;
      case 'lg':
        widthClass = 'w-80'; // 320px
        break;
      case 'auto':
      default:
        widthClass = '';
        break;
    }
  }
  return [widthClass, additionalClassName].filter(Boolean).join(' ');
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * RibbonDropdown - Container for toolbar dropdown menus.
 *
 * Features:
 * - Portal-based rendering (via Popover primitive)
 * - Floating UI positioning with flip/shift
 * - Click-outside to close
 * - Escape key to close
 * - Supports nested submenus
 * - Manual trigger mode for split buttons
 */
export function RibbonDropdown({
  open,
  onOpenChange,
  trigger,
  children,
  position = 'bottom-left',
  width = 'auto',
  className = '',
  containerClassName = '',
  menuLabel,
  menuTestId,
  manualTrigger = false,
}: RibbonDropdownProps) {
  const { side, align } = mapPositionToSideAlign(position);

  // Close handler
  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Context value for nested dropdowns (memoized to prevent unnecessary re-renders)
  const contextValue = useMemo<RibbonDropdownContextValue>(
    () => ({
      closeAll: handleClose,
      level: 0,
    }),
    [handleClose],
  );

  return (
    <RibbonDropdownContext.Provider value={contextValue}>
      <Popover open={open} onOpenChange={onOpenChange}>
        {manualTrigger ? (
          <PopoverAnchor asChild>
            <div className={containerClassName}>{trigger}</div>
          </PopoverAnchor>
        ) : (
          <PopoverTrigger asChild>
            <div className={containerClassName}>{trigger}</div>
          </PopoverTrigger>
        )}
        <PopoverContent
          side={side}
          align={align}
          sideOffset={4}
          className={getWidthClassName(width, className)}
          role="menu"
          aria-label={menuLabel}
          data-testid={menuTestId}
        >
          {children}
        </PopoverContent>
      </Popover>
    </RibbonDropdownContext.Provider>
  );
}

function getOwningMenu(item: HTMLElement): HTMLElement | null {
  return item.closest<HTMLElement>('[role="menu"]');
}

function isEnabledVisibleMenuItem(item: HTMLElement): boolean {
  const disabled =
    item.getAttribute('aria-disabled') === 'true' ||
    item.hasAttribute('disabled') ||
    ('disabled' in item && Boolean((item as HTMLButtonElement).disabled)) ||
    item.tabIndex < 0;
  if (disabled || item.hidden) return false;

  const view = item.ownerDocument.defaultView;
  if (!view) return true;

  const style = view.getComputedStyle(item);
  return (
    style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse'
  );
}

function getPeerMenuItems(item: HTMLElement): HTMLElement[] {
  const menu = getOwningMenu(item);
  if (!menu) return [];

  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
    (candidate) =>
      candidate.closest<HTMLElement>('[role="menu"]') === menu &&
      isEnabledVisibleMenuItem(candidate),
  );
}

function focusMenuItem(item: HTMLElement): void {
  item.focus({ preventScroll: true });
}

function moveMenuFocus(item: HTMLElement, direction: 1 | -1): boolean {
  const items = getPeerMenuItems(item);
  if (items.length === 0) return false;

  const currentIndex = Math.max(items.indexOf(item), 0);
  focusMenuItem(items[(currentIndex + direction + items.length) % items.length]);
  return true;
}

function focusMenuEdge(item: HTMLElement, edge: 'first' | 'last'): boolean {
  const items = getPeerMenuItems(item);
  if (items.length === 0) return false;

  focusMenuItem(edge === 'first' ? items[0] : items[items.length - 1]);
  return true;
}

function normalizedMenuText(item: HTMLElement): string {
  return (item.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function activateMenuItemByPrefix(item: HTMLElement, key: string): boolean {
  const prefix = key.toLowerCase();
  const match = getPeerMenuItems(item).find((candidate) =>
    normalizedMenuText(candidate).startsWith(prefix),
  );
  if (!match) return false;

  match.click();
  return true;
}

function handleMenuItemNavigationKey(e: React.KeyboardEvent, disabled: boolean): boolean {
  if (disabled) return false;

  const item = e.currentTarget as HTMLElement;
  switch (e.key) {
    case 'Enter':
    case ' ':
      item.click();
      return true;
    case 'ArrowDown':
      return moveMenuFocus(item, 1);
    case 'ArrowUp':
      return moveMenuFocus(item, -1);
    case 'Home':
      return focusMenuEdge(item, 'first');
    case 'End':
      return focusMenuEdge(item, 'last');
    default:
      break;
  }

  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    return activateMenuItemByPrefix(item, e.key);
  }

  return false;
}

// =============================================================================
// MenuItemRow — shared row layout
// =============================================================================
//
// Single source of truth for the visual structure of every `role="menuitem"`
// rendered by this primitive. Both `RibbonDropdownItem` (leaf) and
// `RibbonDropdownSubmenu` (parent) compose this so their padding, icon-column
// reserve, focus styles, and label-flex behavior cannot drift independently.
// Misaligned Conditional Formatting labels exposed the previous
// parallel-implementation arrangement: leaves reserved the icon column while
// submenu triggers omitted it, so labels drifted by 24 px whenever a dropdown
// mixed both at the top level.

interface MenuItemRowProps {
  /** Slotted into the always-reserved `w-4 h-4` icon column. */
  iconSlot?: ReactNode;
  /** Label content (gets `flex-1` so the trailing slot pins to the right edge). */
  children: ReactNode;
  /** Slotted at the right edge — chevron, keyboard shortcut, etc. */
  trailingSlot?: ReactNode;
  disabled?: boolean;
  isSelected?: boolean;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  tabIndex?: number;
  'aria-haspopup'?: boolean | 'menu' | 'true';
  'aria-expanded'?: boolean;
  'data-testid'?: string;
  'data-value'?: string;
}

const MenuItemRow = forwardRef<HTMLDivElement, MenuItemRowProps>(function MenuItemRow(
  {
    iconSlot,
    children,
    trailingSlot,
    disabled = false,
    isSelected = false,
    className = '',
    onClick,
    onKeyDown,
    onMouseEnter,
    onMouseLeave,
    tabIndex,
    'aria-haspopup': ariaHasPopup,
    'aria-expanded': ariaExpanded,
    'data-testid': testId,
    'data-value': dataValue,
    ...rest
  },
  ref,
) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;

      if (handleMenuItemNavigationKey(e, disabled)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [disabled, onKeyDown],
  );

  return (
    <div
      ref={ref}
      role="menuitem"
      tabIndex={tabIndex ?? (disabled ? -1 : 0)}
      className={`
 flex items-center gap-2 px-3 py-1.5 text-dropdown w-full text-left
 cursor-pointer transition-colors duration-ss-fast
 focus:outline-none focus-visible:ring-2 focus-visible:ring-ss-primary focus-visible:ring-inset
 ${disabled ? 'opacity-40 cursor-not-allowed text-ss-text-disabled' : 'text-ss-text hover:bg-ss-surface-hover'}
 ${isSelected ? 'bg-ss-primary-light font-medium' : ''}
 ${className}
 `}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      aria-disabled={disabled}
      aria-checked={isSelected}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      data-testid={testId}
      data-value={dataValue}
      {...rest}
    >
      <span className="w-4 h-4 flex items-center justify-center shrink-0">{iconSlot}</span>
      <span className="flex-1">{children}</span>
      {trailingSlot}
    </div>
  );
});

const SelectedCheckmark = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M2 6L5 9L10 3"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// =============================================================================
// RibbonDropdownItem
// =============================================================================

interface RibbonDropdownItemProps {
  /** Item content */
  children: ReactNode;
  /** Called when item is clicked */
  onClick?: () => void;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Icon to display before the label */
  icon?: ReactNode;
  /** Keyboard shortcut displayed on the right (e.g., "Ctrl+V") */
  shortcut?: string;
  /** Additional class names */
  className?: string;
  /** Whether to close dropdown after click (default: true) */
  closeOnClick?: boolean;
  /** Called when mouse enters the item (for preview on hover) */
  onMouseEnter?: () => void;
  /** Called when mouse leaves the item (for preview on hover) */
  onMouseLeave?: () => void;
  /** Whether this item is currently selected (shows checkmark or highlight) */
  isSelected?: boolean;
  /** Stable test selector (rendered as `data-testid`). */
  testId?: string;
  /**
   * Stable selector for the harness to identify which value within a
   * dropdown was chosen (rendered as `data-value`). Pair with the
   * parent's `data-testid="ribbon-dropdown-menu-<id>"` wrapper for the
   * generalized testid contract.
   */
  dataValue?: string;
}

/**
 * RibbonDropdownItem - Individual menu item.
 */
export function RibbonDropdownItem({
  children,
  onClick,
  disabled = false,
  icon,
  shortcut,
  className = '',
  closeOnClick = true,
  onMouseEnter,
  onMouseLeave,
  isSelected = false,
  testId,
  dataValue,
}: RibbonDropdownItemProps) {
  const { closeAll } = useContext(RibbonDropdownContext);

  const handleClick = useCallback(() => {
    if (disabled) return;
    onClick?.();
    if (closeOnClick) {
      closeAll();
    }
  }, [disabled, onClick, closeOnClick, closeAll]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        handleClick();
      }
    },
    [disabled, handleClick],
  );

  const handleMouseEnter = useCallback(() => {
    if (!disabled) {
      onMouseEnter?.();
    }
  }, [disabled, onMouseEnter]);

  const handleMouseLeave = useCallback(() => {
    if (!disabled) {
      onMouseLeave?.();
    }
  }, [disabled, onMouseLeave]);

  return (
    <MenuItemRow
      tabIndex={disabled ? -1 : 0}
      disabled={disabled}
      isSelected={isSelected}
      className={className}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-testid={testId}
      data-value={dataValue}
      iconSlot={isSelected ? SelectedCheckmark : (icon ?? null)}
      trailingSlot={
        shortcut ? (
          <span className="ml-2 text-ss-text-tertiary text-dropdown-header shrink-0">
            {shortcut}
          </span>
        ) : null
      }
    >
      {children}
    </MenuItemRow>
  );
}

// =============================================================================
// RibbonDropdownDivider
// =============================================================================

/**
 * RibbonDropdownDivider - Visual separator between items.
 * Styled with horizontal inset to match Excel menus.
 */
export function RibbonDropdownDivider({ className = '' }: { className?: string }) {
  return <div className={`h-px bg-ss-border-light my-1.5 mx-2 ${className}`} role="separator" />;
}

// =============================================================================
// RibbonDropdownHeader
// =============================================================================

interface RibbonDropdownHeaderProps {
  /** Header text */
  children: ReactNode;
  /** Additional class names */
  className?: string;
}

/**
 * RibbonDropdownHeader - Section header within dropdowns.
 * Non-interactive, used to label groups of related items.
 *
 * @example
 * ```tsx
 * <RibbonDropdownHeader>Paste Options</RibbonDropdownHeader>
 * <RibbonDropdownItem>Paste</RibbonDropdownItem>
 * <RibbonDropdownItem>Paste Values</RibbonDropdownItem>
 * ```
 */
export function RibbonDropdownHeader({ children, className = '' }: RibbonDropdownHeaderProps) {
  return (
    <div
      className={`
 px-3 py-1.5 text-dropdown-header text-ss-text-tertiary
 font-medium uppercase tracking-wide select-none
 ${className}
 `}
      role="presentation"
    >
      {children}
    </div>
  );
}

// =============================================================================
// RibbonDropdownSubmenu
// =============================================================================

interface RibbonDropdownSubmenuProps {
  /** Label shown in parent menu */
  label: ReactNode;
  /** Submenu content */
  children: ReactNode;
  /** Icon to display before the label */
  icon?: ReactNode;
  /** Position of submenu relative to parent item */
  position?: 'right' | 'left';
  /** Additional class names for the submenu panel */
  className?: string;
}

/**
 * RibbonDropdownSubmenu - Nested submenu that opens on hover.
 * Uses nested Popover for portal rendering and positioning.
 */
export function RibbonDropdownSubmenu({
  label,
  children,
  icon,
  position = 'right',
  className = '',
}: RibbonDropdownSubmenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { closeAll, level } = useContext(RibbonDropdownContext);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsOpen(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    // Delay closing to allow moving to submenu
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  }, []);

  // Map position to side for Popover
  const side = position === 'right' ? 'right' : 'left';

  // Nested context with incremented level (memoized to prevent unnecessary re-renders)
  const nestedContextValue = useMemo<RibbonDropdownContextValue>(
    () => ({
      closeAll,
      level: level + 1,
    }),
    [closeAll, level],
  );

  return (
    <RibbonDropdownContext.Provider value={nestedContextValue}>
      <div className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <MenuItemRow
              aria-haspopup="true"
              aria-expanded={isOpen}
              iconSlot={icon ?? null}
              trailingSlot={<span className="ml-2 text-ss-text-secondary">&#9656;</span>}
            >
              {label}
            </MenuItemRow>
          </PopoverTrigger>
          <PopoverContent
            side={side}
            align="start"
            sideOffset={1}
            className={`w-[180px] min-w-[180px] ${className}`}
            role="menu"
            closeOnClickOutside={false}
          >
            {children}
          </PopoverContent>
        </Popover>
      </div>
    </RibbonDropdownContext.Provider>
  );
}

// =============================================================================
// RibbonDropdownPanel (for custom content like pickers)
// =============================================================================

interface RibbonDropdownPanelProps {
  /** Whether the panel is open */
  open: boolean;
  /** Called when panel should close */
  onClose: () => void;
  /** Panel content (e.g., ColorPicker, FontPicker) */
  children: ReactNode;
  /** Position relative to trigger */
  position?: DropdownPosition;
  /** Additional class names */
  className?: string;
}

/**
 * RibbonDropdownPanel - For embedding custom content like pickers in dropdowns.
 *
 * Uses Popover primitive for portal rendering and positioning.
 * Handles click-outside and escape key automatically.
 *
 * @example
 * ```tsx
 * <div className="relative inline-flex">
 * <Button onClick={ => setOpen(!open)}>Pick Color</Button>
 * <RibbonDropdownPanel open={open} onClose={ => setOpen(false)}>
 * <ColorPicker value={color} onChange={setColor} />
 * </RibbonDropdownPanel>
 * </div>
 * ```
 */
export function RibbonDropdownPanel({
  open,
  onClose,
  children,
  position = 'bottom-left',
  className = '',
}: RibbonDropdownPanelProps) {
  const placeholderRef = useRef<HTMLSpanElement>(null);
  const { side, align } = mapPositionToSideAlign(position);

  // Handle open change from Popover
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        onClose();
      }
    },
    [onClose],
  );

  const contextValue = useMemo<RibbonDropdownContextValue>(
    () => ({
      closeAll: onClose,
      level: 0,
    }),
    [onClose],
  );

  return (
    <RibbonDropdownContext.Provider value={contextValue}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        {/* Zero-size placeholder anchored to parent's top-left corner.
 IMPORTANT: Cannot use "hidden" (display:none) because getBoundingClientRect() returns zeros.
 Must use absolute positioning to maintain a position reference for Floating UI. */}
        <PopoverTrigger asChild>
          <span
            ref={placeholderRef}
            className="absolute left-0 top-full w-0 h-0"
            aria-hidden="true"
          />
        </PopoverTrigger>
        <PopoverContent
          side={side}
          align={align}
          sideOffset={4}
          className={`shadow-none rounded-ss ${className}`}
          role="dialog"
          disableScrollConstraints
        >
          {children}
        </PopoverContent>
      </Popover>
    </RibbonDropdownContext.Provider>
  );
}
