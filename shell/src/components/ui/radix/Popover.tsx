/**
 * Popover Radix Wrapper
 *
 * Wraps @radix-ui/react-popover to provide:
 * 1. CORRECT nested portal handling via Radix's DismissableLayer
 * 2. Virtual positioning for context menus
 * 3. Semantic design tokens (not Tailwind defaults)
 *
 * This component is the HUB for all floating UI elements (dropdowns, pickers, context menus).
 *
 * WHY RADIX:
 * The old Popover had a race condition with nested portals:
 *   User clicks submenu item → mousedown fires → parent's click-outside handler
 *   → Parent checks: is click inside my contentRef? NO (submenu is portaled)
 *   → Parent closes → submenu unmounts → click handler never fires
 *
 * Radix's DismissableLayer uses a context-based layer stack that handles this correctly.
 *
 */

import * as RadixPopover from '@radix-ui/react-popover';
import type { ComponentPropsWithoutRef, ReactNode, RefObject } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePortalContainer } from '../../../contexts/PortalContainerContext';

import {
  cn,
  floatingContentWithAnimationClasses,
  floatingPickerContentWithAnimationClasses,
} from './styles';

// =============================================================================
// Types
// =============================================================================

/**
 * Event type for pointer down outside the popover content.
 * Radix provides this event when clicking outside to allow preventing dismissal.
 */
export type PointerDownOutsideEvent = CustomEvent<{ originalEvent: PointerEvent }>;

/**
 * Event type for any interaction outside the popover content.
 * This includes both pointer events and focus events.
 */
export type InteractOutsideEvent =
  | PointerDownOutsideEvent
  | CustomEvent<{ originalEvent: FocusEvent }>;

type RadixPopoverContentProps = ComponentPropsWithoutRef<typeof RadixPopover.Content>;

// =============================================================================
// Context for Popover Hierarchy
// =============================================================================

interface PopoverHierarchyContextValue {
  /** Close just this popover (not parents) */
  close: () => void;
  /** Close all popovers in the hierarchy */
  closeAll: () => void;
  /** Current nesting level */
  level: number;
}

const PopoverHierarchyContext = createContext<PopoverHierarchyContextValue>({
  close: () => {},
  closeAll: () => {},
  level: 0,
});

/**
 * Hook to close the popover from within content.
 * Returns functions to close current popover or all nested popovers.
 */
export function usePopoverClose() {
  const hierarchy = useContext(PopoverHierarchyContext);
  return {
    /** Close just this popover (not parents) */
    close: hierarchy.close,
    /** Close all popovers in the hierarchy (including parents) */
    closeAll: hierarchy.closeAll,
  };
}

// =============================================================================
// Popover (Root)
// =============================================================================

export interface PopoverProps {
  /** Controlled open state */
  open?: boolean;
  /** Default open state for uncontrolled usage */
  defaultOpen?: boolean;
  /** Called when open state should change */
  onOpenChange?: (open: boolean) => void;
  /**
   * Whether the popover is modal.
   * When true, interaction with outside elements will be disabled and only popover content will be visible to screen readers.
   * Default: false
   */
  modal?: boolean;
  /** Child components (PopoverTrigger + PopoverContent) */
  children: ReactNode;
}

/**
 * Popover - Root component that provides context to child components.
 *
 * @example
 * ```tsx
 * <Popover open={isOpen} onOpenChange={setIsOpen}>
 *   <PopoverTrigger asChild>
 *     <Button>Open Menu</Button>
 *   </PopoverTrigger>
 *   <PopoverContent side="bottom" align="start">
 *     <DropdownItem>Option 1</DropdownItem>
 *     <DropdownItem>Option 2</DropdownItem>
 *   </PopoverContent>
 * </Popover>
 * ```
 */
export function Popover({
  open,
  defaultOpen,
  onOpenChange,
  modal = false,
  children,
}: PopoverProps) {
  const parentHierarchy = useContext(PopoverHierarchyContext);

  const close = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  const closeAll = useCallback(() => {
    onOpenChange?.(false);
    parentHierarchy.closeAll();
  }, [onOpenChange, parentHierarchy]);

  const hierarchyValue: PopoverHierarchyContextValue = {
    close,
    closeAll,
    level: parentHierarchy.level + 1,
  };

  return (
    <PopoverHierarchyContext.Provider value={hierarchyValue}>
      <RadixPopover.Root
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        modal={modal}
      >
        {children}
      </RadixPopover.Root>
    </PopoverHierarchyContext.Provider>
  );
}

// =============================================================================
// PopoverTrigger
// =============================================================================

export interface PopoverTriggerProps {
  /**
   * When true, the trigger will not wrap children in a button.
   * Instead, it will merge props onto the child element.
   */
  asChild?: boolean;
  /** The trigger element */
  children: ReactNode;
}

/**
 * PopoverTrigger - Element that triggers the popover.
 * Use asChild to merge props onto a single child element.
 */
export const PopoverTrigger = RadixPopover.Trigger;

// =============================================================================
// PopoverAnchor
// =============================================================================

/**
 * Type for the virtual reference used by Radix Popover.
 * This is an object with a getBoundingClientRect method that returns position info.
 */
export type Measurable = { getBoundingClientRect: () => DOMRect };

export interface PopoverAnchorProps {
  /**
   * Virtual reference for positioning.
   * Provide a ref to an object with getBoundingClientRect method.
   * Used for context menus where position is based on click coordinates.
   *
   * NOTE: When using with useVirtualRef(), only render the Anchor when position is set.
   */
  virtualRef?: RefObject<Measurable>;
  /**
   * When true, will merge props onto the child element.
   */
  asChild?: boolean;
  /** Optional children (for non-virtual anchors) */
  children?: ReactNode;
}

/**
 * PopoverAnchor - An optional element to position the popover against.
 *
 * For virtual positioning (e.g., context menus), provide a virtualRef with a
 * getBoundingClientRect method that returns the desired position.
 *
 * @example
 * ```tsx
 * // Virtual positioning for context menu
 * const virtualRef = useRef({
 *   getBoundingClientRect: () => ({
 *     x: clickX, y: clickY, width: 0, height: 0,
 *     top: clickY, left: clickX, right: clickX, bottom: clickY,
 *     toJSON: () => ({})
 *   })
 * });
 *
 * <Popover open={isOpen} onOpenChange={setIsOpen}>
 *   <PopoverAnchor virtualRef={virtualRef} />
 *   <PopoverContent>...</PopoverContent>
 * </Popover>
 * ```
 */
export function PopoverAnchor({ virtualRef, asChild, children }: PopoverAnchorProps) {
  // For virtual positioning, we need to use the virtualRef
  if (virtualRef) {
    return <RadixPopover.Anchor virtualRef={virtualRef} />;
  }

  // For regular anchors with children
  return <RadixPopover.Anchor asChild={asChild}>{children}</RadixPopover.Anchor>;
}

// =============================================================================
// PopoverContent
// =============================================================================

export interface PopoverContentProps {
  [key: `data-${string}`]: string | number | boolean | undefined;
  /** The content to display inside the popover */
  children: ReactNode;
  /** Which side of the trigger to position on. Default: 'bottom' */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Alignment along the side. Default: 'start' */
  align?: 'start' | 'center' | 'end';
  /** Offset from the trigger in pixels. Default: 4 */
  sideOffset?: number;
  /** Offset along the alignment axis in pixels. Default: 0 */
  alignOffset?: number;
  /** Additional class names */
  className?: string;
  /**
   * Whether clicking outside closes the popover. Default: true
   * When false, prevents the popover from closing on outside clicks.
   */
  closeOnClickOutside?: boolean;
  /**
   * Whether escape key closes the popover. Default: true
   */
  closeOnEscape?: boolean;
  /**
   * Handler called when escape key is pressed.
   * Call event.preventDefault() to prevent closing.
   */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  /**
   * Handler called when pointer down outside the popover.
   * Call event.preventDefault() to prevent closing.
   */
  onPointerDownOutside?: (event: PointerDownOutsideEvent) => void;
  /**
   * Handler called when any interaction outside the popover.
   * Call event.preventDefault() to prevent closing.
   */
  onInteractOutside?: (event: InteractOutsideEvent) => void;
  /**
   * Handler called when focus moves outside the popover.
   * Call event.preventDefault() to prevent closing.
   */
  onFocusOutside?: (event: CustomEvent<{ originalEvent: FocusEvent }>) => void;
  /**
   * Used to force mounting when more control is needed.
   * Useful for controlling animation.
   */
  forceMount?: true;
  /**
   * When true, prevents the scroll of the body when the popover is open.
   */
  avoidCollisions?: boolean;
  /**
   * The element that should take focus when the popover opens.
   * By default, focus goes to the content element.
   */
  onOpenAutoFocus?: (event: Event) => void;
  /**
   * The element that should take focus when the popover closes.
   * By default, focus returns to the trigger.
   */
  onCloseAutoFocus?: (event: Event) => void;
  /**
   * Whether to hide content behind other elements. Default: true
   */
  hideWhenDetached?: boolean;
  /**
   * Specify a container element to portal the content into.
   */
  container?: HTMLElement | null;
  /**
   * Custom z-index for layering control.
   * If not provided, uses default from styles.
   */
  style?: React.CSSProperties;
  /**
   * ARIA role for the popover. Default: 'dialog'
   */
  role?: 'dialog' | 'menu' | 'listbox' | 'tooltip';
  /**
   * ARIA label for accessibility
   */
  'aria-label'?: string;
  /**
   * Test hook for harness selectors. Forwarded to the rendered content
   * element so popover-based menus (e.g. TabContextMenu) can be queried
   * by the same `[data-testid="context-menu"]` convention as the
   * Radix-ContextMenu-based menus (CellContextMenu, etc.).
   */
  'data-testid'?: string;
  /**
   * CSS class for shadow (e.g., 'shadow-ss-dropdown').
   * Applied to the content element.
   */
  shadow?: string;
  /**
   * CSS class for border radius (e.g., 'rounded-ss-md').
   * Applied to the content element.
   */
  rounded?: string;
  /**
   * Width of the popover content.
   * Can be a number (pixels) or string (CSS value like '200px' or 'auto').
   */
  width?: number | string;
  /**
   * Whether scrolling outside closes the popover. Default: true
   * Note: This is a legacy API prop. Radix Popover doesn't natively support this,
   * but accepting the prop maintains backwards compatibility.
   */
  closeOnScroll?: boolean;
  /**
   * Handler called when mouse enters the popover content.
   * Useful for hover-based interactions (e.g., comment popover safe zones).
   */
  onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
  /**
   * Handler called when mouse leaves the popover content.
   * Useful for hover-based interactions (e.g., comment popover safe zones).
   */
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
  /** Handler called when pointer down starts inside the popover content. */
  onPointerDown?: RadixPopoverContentProps['onPointerDown'];
  /** Handler called when a key is pressed while focus is inside the popover content. */
  onKeyDown?: RadixPopoverContentProps['onKeyDown'];
  /**
   * When true, uses picker-specific content classes that omit overflow-x-hidden
   * and max-h constraints. Use for picker panels (BorderPicker, ColorPicker, etc.)
   * where all sections must be fully visible without scrolling.
   */
  disableScrollConstraints?: boolean;
}

/**
 * PopoverContent - The floating content panel.
 *
 * Radix handles all the complex dismiss behavior correctly:
 * - Click outside detection works with nested portals
 * - Escape key closes from innermost to outermost
 * - Focus management is handled automatically
 *
 * @example
 * ```tsx
 * <PopoverContent side="bottom" align="start" sideOffset={4}>
 *   <div className="p-2">
 *     Popover content here
 *   </div>
 * </PopoverContent>
 * ```
 */
export function PopoverContent({
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  alignOffset = 0,
  className,
  closeOnClickOutside = true,
  closeOnEscape = true,
  onEscapeKeyDown,
  onPointerDownOutside,
  onInteractOutside,
  onFocusOutside,
  forceMount,
  avoidCollisions = true,
  onOpenAutoFocus,
  onCloseAutoFocus,
  hideWhenDetached = true,
  container,
  style,
  role = 'dialog',
  'aria-label': ariaLabel,
  'data-testid': dataTestId,
  shadow,
  rounded,
  width,
  closeOnScroll: _closeOnScroll, // Legacy prop - accepted for API compatibility
  onMouseEnter,
  onMouseLeave,
  onPointerDown,
  onKeyDown,
  disableScrollConstraints,
  ...dataAttributes
}: PopoverContentProps) {
  const portalContainer = usePortalContainer();
  const resolvedContainer = container ?? portalContainer;

  // Handler that prevents closing if closeOnClickOutside is false
  const handlePointerDownOutside = useCallback(
    (event: PointerDownOutsideEvent) => {
      if (!closeOnClickOutside) {
        event.preventDefault();
      }
      onPointerDownOutside?.(event);
    },
    [closeOnClickOutside, onPointerDownOutside],
  );

  // Handler that prevents closing if closeOnEscape is false
  const handleEscapeKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!closeOnEscape) {
        event.preventDefault();
      }
      onEscapeKeyDown?.(event);
    },
    [closeOnEscape, onEscapeKeyDown],
  );

  // Compute style with width if provided
  const computedStyle: React.CSSProperties | undefined =
    width !== undefined
      ? { ...style, width: typeof width === 'number' ? `${width}px` : width }
      : style;

  return (
    <RadixPopover.Portal container={resolvedContainer}>
      <RadixPopover.Content
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn(
          disableScrollConstraints
            ? floatingPickerContentWithAnimationClasses
            : floatingContentWithAnimationClasses,
          shadow,
          rounded,
          className,
        )}
        onEscapeKeyDown={handleEscapeKeyDown}
        onPointerDownOutside={handlePointerDownOutside}
        onInteractOutside={onInteractOutside}
        onFocusOutside={onFocusOutside}
        forceMount={forceMount}
        avoidCollisions={avoidCollisions}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        hideWhenDetached={hideWhenDetached}
        style={computedStyle}
        role={role}
        aria-label={ariaLabel}
        {...dataAttributes}
        data-testid={dataTestId}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}

// =============================================================================
// PopoverClose
// =============================================================================

export interface PopoverCloseProps {
  /**
   * When true, will merge props onto the child element.
   */
  asChild?: boolean;
  /** The close button element */
  children: ReactNode;
  /** Whether to close all nested popovers. Default: false */
  closeAll?: boolean;
}

/**
 * PopoverClose - Element that closes the popover when clicked.
 *
 * @example
 * ```tsx
 * <PopoverClose asChild>
 *   <Button>Close</Button>
 * </PopoverClose>
 * ```
 */
export function PopoverClose({ asChild, children, closeAll: shouldCloseAll }: PopoverCloseProps) {
  const hierarchy = useContext(PopoverHierarchyContext);

  if (shouldCloseAll) {
    // Custom behavior to close all nested popovers
    // We wrap the child and handle the click ourselves
    return (
      <RadixPopover.Close asChild={asChild} onClick={hierarchy.closeAll}>
        {children}
      </RadixPopover.Close>
    );
  }

  return <RadixPopover.Close asChild={asChild}>{children}</RadixPopover.Close>;
}

// =============================================================================
// Virtual Reference Helper
// =============================================================================

/**
 * Creates a virtual reference for positioning a popover at specific coordinates.
 * Useful for context menus where the position is based on click/touch coordinates.
 *
 * @example
 * ```tsx
 * const handleContextMenu = (event: React.MouseEvent) => {
 *   event.preventDefault();
 *   virtualRefRef.current = createVirtualRef(event.clientX, event.clientY);
 *   setIsOpen(true);
 * };
 *
 * <Popover open={isOpen} onOpenChange={setIsOpen}>
 *   <PopoverAnchor virtualRef={virtualRefRef} />
 *   <PopoverContent>...</PopoverContent>
 * </Popover>
 * ```
 */
export function createVirtualRef(x: number, y: number): { getBoundingClientRect: () => DOMRect } {
  return {
    getBoundingClientRect: () => ({
      x,
      y,
      width: 0,
      height: 0,
      top: y,
      left: x,
      right: x,
      bottom: y,
      toJSON: () => ({ x, y, width: 0, height: 0, top: y, left: x, right: x, bottom: y }),
    }),
  };
}

/**
 * Hook to create and manage a virtual reference for context menu positioning.
 *
 * @example
 * ```tsx
 * const { virtualRef, setPosition } = useVirtualRef();
 *
 * const handleContextMenu = (event: React.MouseEvent) => {
 *   event.preventDefault();
 *   setPosition(event.clientX, event.clientY);
 *   setIsOpen(true);
 * };
 *
 * <Popover open={isOpen} onOpenChange={setIsOpen}>
 *   <PopoverAnchor virtualRef={virtualRef} />
 *   <PopoverContent>...</PopoverContent>
 * </Popover>
 * ```
 */
export function useVirtualRef() {
  const [position, setPositionState] = useState<{ x: number; y: number } | null>(null);

  // Create a stable ref that always has the current virtual position
  // We use a stable object that gets mutated to avoid ref changes
  const virtualRefObject = useRef<Measurable>(createVirtualRef(0, 0));
  const virtualRef = useRef<Measurable>(virtualRefObject.current);

  // Update the ref object's getBoundingClientRect when position changes
  useEffect(() => {
    if (position) {
      virtualRefObject.current = createVirtualRef(position.x, position.y);
      virtualRef.current = virtualRefObject.current;
    }
  }, [position]);

  const setPosition = useCallback((x: number, y: number) => {
    setPositionState({ x, y });
  }, []);

  const clearPosition = useCallback(() => {
    setPositionState(null);
  }, []);

  return {
    /** The ref to pass to PopoverAnchor. Only render when position is set. */
    virtualRef,
    /** Current position, or null if not set */
    position,
    /** Set the position (x, y coordinates) */
    setPosition,
    /** Clear the position */
    clearPosition,
  };
}
