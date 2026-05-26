/**
 * Shared styles for Radix UI wrapper components
 *
 * CRITICAL: All styles use semantic design tokens from tokens.css.
 * NEVER use Tailwind defaults (bg-white, text-gray-*, shadow-lg, etc.)
 *
 */

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Combines class names, filtering out falsy values.
 * Lightweight alternative to clsx/classnames libraries.
 */
export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// =============================================================================
// ANIMATION CLASSES
// =============================================================================

/**
 * Animation classes for floating UI elements (dropdown, popover, tooltip, dialog).
 * Uses Tailwind CSS animate plugin with Radix data attributes.
 */
export const floatingAnimationClasses = [
  // Enter animation
  'data-[state=open]:animate-in',
  'data-[state=open]:fade-in-0',
  'data-[state=open]:zoom-in-95',
  // Exit animation
  'data-[state=closed]:animate-out',
  'data-[state=closed]:fade-out-0',
  'data-[state=closed]:zoom-out-95',
  // Position-aware slide animations
  'data-[side=bottom]:slide-in-from-top-2',
  'data-[side=top]:slide-in-from-bottom-2',
  'data-[side=left]:slide-in-from-right-2',
  'data-[side=right]:slide-in-from-left-2',
  // Duration
  'duration-ss-fast',
].join(' ');

// =============================================================================
// FLOATING CONTENT CLASSES
// =============================================================================

/**
 * Base classes for floating content containers (dropdown, popover, context menu).
 */
export const floatingContentClasses = [
  // Portaled content is mounted under a full-screen pointer-transparent host.
  // The host must not block the app, but the actual floating surface must
  // participate in hit testing.
  'pointer-events-auto',
  // Background and border
  'bg-ss-surface',
  'border',
  'border-ss-border',
  // Border radius and shadow
  'rounded-ss-md',
  'shadow-ss-dropdown',
  // Z-index
  'z-ss-popover',
  // Padding
  'py-1',
  // Min width for usability
  'min-w-[160px]',
  // Viewport-aware max-height using Radix's CSS variable (set by Popper primitive)
  // --radix-popper-available-height is the space between trigger and viewport edge
  // Falls back to viewport-based calc if variable isn't set
  'max-h-[var(--radix-popper-available-height,calc(100vh-120px))]',
  // Overflow handling: hidden on x-axis, scrollable on y-axis when content exceeds max-height
  'overflow-x-hidden',
  'overflow-y-auto',
].join(' ');

/**
 * Combined floating content classes with animations.
 */
export const floatingContentWithAnimationClasses = cn(
  floatingContentClasses,
  floatingAnimationClasses,
);

/**
 * Base classes for floating picker content (BorderPicker, ColorPicker, FontPicker, etc.).
 * Same as floatingContentClasses but WITHOUT overflow-x-hidden and max-h constraints,
 * since picker panels need all sections fully visible without scrolling.
 */
export const floatingPickerContentClasses = [
  'pointer-events-auto',
  'bg-ss-surface',
  'border',
  'border-ss-border',
  'rounded-ss-md',
  'shadow-ss-dropdown',
  'z-ss-popover',
  'py-1',
  'min-w-[160px]',
].join(' ');

/**
 * Combined floating picker content classes with animations.
 */
export const floatingPickerContentWithAnimationClasses = cn(
  floatingPickerContentClasses,
  floatingAnimationClasses,
);

// =============================================================================
// MENU ITEM CLASSES
// =============================================================================

/**
 * Base classes for menu items (dropdown items, context menu items).
 */
export const menuItemClasses = [
  // Layout
  'flex',
  'items-center',
  'gap-2',
  // Padding
  'px-3',
  'py-2',
  // Typography
  'text-dropdown',
  'text-ss-text',
  // Interaction
  'cursor-pointer',
  'select-none',
  'outline-none',
  // Highlighted state (hover/keyboard focus)
  'hover:bg-ss-surface-hover',
  'data-[highlighted]:bg-ss-surface-hover',
  // Disabled state
  'data-[disabled]:text-ss-text-disabled',
  'data-[disabled]:pointer-events-none',
].join(' ');

/**
 * Classes for menu item with icon on the right (e.g., submenu indicator).
 */
export const menuItemWithRightIconClasses = cn(menuItemClasses, 'justify-between');

/**
 * Classes for destructive menu items (delete, remove actions).
 */
export const menuItemDestructiveClasses = [
  // Base classes (same layout as menuItemClasses)
  'flex',
  'items-center',
  'gap-2',
  'px-3',
  'py-2',
  'text-dropdown',
  'cursor-pointer',
  'select-none',
  'outline-none',
  // Destructive color
  'text-ss-error',
  // Highlighted state with destructive background
  'hover:bg-ss-error-bg',
  'data-[highlighted]:bg-ss-error-bg',
  // Disabled state
  'data-[disabled]:text-ss-text-disabled',
  'data-[disabled]:pointer-events-none',
].join(' ');

// =============================================================================
// MENU SECTION CLASSES
// =============================================================================

/**
 * Classes for menu separator lines.
 */
export const menuSeparatorClasses = ['h-px', 'my-1', 'mx-2', 'bg-ss-border'].join(' ');

/**
 * Classes for menu group labels/headers.
 */
export const menuLabelClasses = [
  'px-3',
  'py-2',
  'text-dropdown-header',
  'text-ss-text-secondary',
  'font-medium',
  'select-none',
].join(' ');

// =============================================================================
// DIALOG CLASSES
// =============================================================================

/**
 * Classes for dialog overlay (backdrop).
 */
export const dialogOverlayClasses = [
  // Position and sizing
  'fixed',
  'inset-0',
  // Background
  'bg-black/50',
  // Z-index (below modal content)
  'z-ss-overlay',
  // Animation
  'data-[state=open]:animate-in',
  'data-[state=open]:fade-in-0',
  'data-[state=closed]:animate-out',
  'data-[state=closed]:fade-out-0',
  'duration-ss',
].join(' ');

/**
 * Classes for dialog content panel.
 */
export const dialogContentClasses = [
  // Position and centering
  'fixed',
  'left-1/2',
  'top-1/2',
  '-translate-x-1/2',
  '-translate-y-1/2',
  // Background and border
  'bg-ss-surface',
  'border',
  'border-ss-border',
  // Border radius and shadow
  'rounded-ss-lg',
  'shadow-ss-lg',
  // Z-index
  'z-ss-modal',
  // Default sizing
  'w-full',
  'max-w-md',
  'max-h-[85vh]',
  // Overflow handling
  'overflow-hidden',
  // Focus
  'outline-none',
  // Animation
  'data-[state=open]:animate-in',
  'data-[state=open]:fade-in-0',
  'data-[state=open]:zoom-in-95',
  'data-[state=closed]:animate-out',
  'data-[state=closed]:fade-out-0',
  'data-[state=closed]:zoom-out-95',
  'duration-ss',
].join(' ');

/**
 * Classes for dialog header section.
 */
export const dialogHeaderClasses = [
  'flex',
  'items-center',
  'justify-between',
  'px-4',
  'py-3',
  'border-b',
  'border-ss-border',
].join(' ');

/**
 * Classes for dialog title.
 */
export const dialogTitleClasses = ['text-body', 'font-semibold', 'text-ss-text'].join(' ');

/**
 * Classes for dialog description.
 */
export const dialogDescriptionClasses = ['text-body-sm', 'text-ss-text-secondary'].join(' ');

/**
 * Classes for dialog body/content area.
 */
export const dialogBodyClasses = ['px-4', 'py-3', 'overflow-y-auto'].join(' ');

/**
 * Classes for dialog footer section.
 */
export const dialogFooterClasses = [
  'flex',
  'items-center',
  'justify-end',
  'gap-2',
  'px-4',
  'py-3',
  'border-t',
  'border-ss-border',
].join(' ');

// =============================================================================
// TOOLTIP CLASSES
// =============================================================================

/**
 * Classes for tooltip content.
 */
export const tooltipContentClasses = [
  // Background and border
  'bg-ss-text',
  'text-ss-text-inverse',
  // Border radius and shadow
  'rounded-ss',
  'shadow-ss-sm',
  // Padding
  'px-2',
  'py-1',
  // Typography
  'text-hint',
  // Z-index
  'z-ss-tooltip',
  // Animation (tooltip uses delayed-open state)
  'data-[state=delayed-open]:animate-in',
  'data-[state=delayed-open]:fade-in-0',
  'data-[state=delayed-open]:zoom-in-95',
  'data-[state=closed]:animate-out',
  'data-[state=closed]:fade-out-0',
  'data-[state=closed]:zoom-out-95',
  // Position-aware animations (shorter distance for tooltip)
  'data-[side=bottom]:slide-in-from-top-1',
  'data-[side=top]:slide-in-from-bottom-1',
  'data-[side=left]:slide-in-from-right-1',
  'data-[side=right]:slide-in-from-left-1',
  'duration-ss-fast',
].join(' ');

// =============================================================================
// FOCUS RING UTILITY
// =============================================================================

/**
 * Accessible focus ring for keyboard navigation.
 * Uses focus-visible to only show ring on keyboard focus, not mouse clicks.
 */
export const focusRingClasses = [
  'outline-none',
  'focus-visible:ring-2',
  'focus-visible:ring-ss-border-focus',
  'focus-visible:ring-offset-1',
].join(' ');

/**
 * Accessible focus ring without offset (for compact elements).
 */
export const focusRingCompactClasses = [
  'outline-none',
  'focus-visible:ring-2',
  'focus-visible:ring-ss-border-focus',
].join(' ');

// =============================================================================
// CHECKBOX & RADIO CLASSES
// =============================================================================

/**
 * Classes for checkbox indicator box.
 */
export const checkboxIndicatorClasses = [
  // Size
  'h-4',
  'w-4',
  // Border
  'border',
  'border-ss-border',
  // Border radius (small for checkbox)
  'rounded-ss-sm',
  // Background
  'bg-ss-surface',
  // Transition
  'transition-colors',
  'duration-ss-fast',
  // Checked state
  'data-[state=checked]:bg-ss-primary',
  'data-[state=checked]:border-ss-primary',
  // Disabled state
  'data-[disabled]:opacity-50',
  'data-[disabled]:cursor-not-allowed',
].join(' ');

/**
 * Classes for radio button (circular variant).
 */
export const radioIndicatorClasses = [
  // Size
  'h-4',
  'w-4',
  // Border
  'border',
  'border-ss-border',
  // Border radius (full circle for radio)
  'rounded-full',
  // Background
  'bg-ss-surface',
  // Transition
  'transition-colors',
  'duration-ss-fast',
  // Checked state
  'data-[state=checked]:border-ss-primary',
  // Disabled state
  'data-[disabled]:opacity-50',
  'data-[disabled]:cursor-not-allowed',
].join(' ');

// =============================================================================
// SELECT (Radix) CLASSES
// =============================================================================

/**
 * Trigger classes for the Radix Select wrapper.
 *
 * Notes on focus styling: we use `focus:` (not `focus-visible:`) so that
 * the focused state is observable for both keyboard and programmatic
 * focus. The shared `focusRingClasses` is `focus-visible:`-only — fine
 * for richly-interactive surfaces but the form-control-styling/focused
 * scenario asserts focus styles after `element.focus()`, which only
 * trips `:focus`, not `:focus-visible`.
 */
export const selectTriggerClasses = [
  // Layout
  'inline-flex',
  'items-center',
  'justify-between',
  'gap-1',
  'w-full',
  // Border + radius
  'border',
  'border-ss-border',
  'rounded-ss',
  // Background and text
  'bg-ss-surface',
  'text-ss-text',
  // Cursor + transition
  'cursor-pointer',
  'transition-colors',
  'duration-ss-fast',
  // Hover (the hover-state scenario relies on this token differing
  // from `--color-ss-border`)
  'hover:border-ss-border-hover',
  // Focus (uses `focus:` so programmatic focus also lights the ring;
  // see comment above)
  'outline-none',
  'focus:border-ss-border-focus',
  'focus:ring-1',
  'focus:ring-ss-primary/20',
  // Open state
  'data-[state=open]:border-ss-border-focus',
  // Error state
  'data-[error=true]:border-ss-error',
  // Placeholder text colour
  'data-[placeholder]:text-ss-text-secondary',
  // Disabled
  'disabled:bg-ss-surface-secondary',
  'disabled:text-ss-text-disabled',
  'disabled:cursor-not-allowed',
].join(' ');

/** Content (popover) classes for the Radix Select. */
export const selectContentClasses = [
  // See floatingContentClasses: Select content is portaled into the same
  // pointer-transparent host and must opt back into hit testing.
  'pointer-events-auto',
  // Background and border
  'bg-ss-surface',
  'border',
  'border-ss-border',
  // Border radius and shadow
  'rounded-ss-md',
  'shadow-ss-dropdown',
  // Z-index
  'z-ss-popover',
  // Padding
  'py-1',
  // Min width: match trigger + leave room for indicator
  'min-w-[var(--radix-select-trigger-width)]',
  // Bound height to viewport per Radix conventions
  'max-h-[var(--radix-select-content-available-height,calc(100vh-120px))]',
  // Overflow handling
  'overflow-hidden',
  // Animation
  'data-[state=open]:animate-in',
  'data-[state=open]:fade-in-0',
  'data-[state=open]:zoom-in-95',
  'data-[state=closed]:animate-out',
  'data-[state=closed]:fade-out-0',
  'data-[state=closed]:zoom-out-95',
  'data-[side=bottom]:slide-in-from-top-2',
  'data-[side=top]:slide-in-from-bottom-2',
  'duration-ss-fast',
].join(' ');

/**
 * Item classes for individual Radix Select options.
 */
export const selectItemClasses = [
  // Layout
  'relative',
  'flex',
  'items-center',
  'gap-2',
  // Padding (left padding leaves room for the check indicator)
  'pl-7',
  'pr-3',
  'py-1.5',
  // Typography
  'text-dropdown',
  'text-ss-text',
  // Interaction
  'cursor-pointer',
  'select-none',
  'outline-none',
  // Highlighted (hover/keyboard nav)
  'data-[highlighted]:bg-ss-surface-hover',
  // Disabled
  'data-[disabled]:text-ss-text-disabled',
  'data-[disabled]:pointer-events-none',
].join(' ');

// =============================================================================
// TABS CLASSES
// =============================================================================

/**
 * Classes for tab trigger (tab button).
 */
export const tabTriggerClasses = [
  // Layout
  'px-3',
  'py-2',
  // Typography
  'text-label',
  'text-ss-text-secondary',
  // Interaction
  'cursor-pointer',
  'select-none',
  'outline-none',
  // Border (bottom indicator)
  'border-b-2',
  'border-transparent',
  // Transition
  'transition-colors',
  'duration-ss-fast',
  // Hover state
  'hover:text-ss-text',
  // Active state
  'data-[state=active]:text-ss-primary',
  'data-[state=active]:border-ss-primary',
  // Focus
  'focus-visible:ring-2',
  'focus-visible:ring-ss-border-focus',
  'focus-visible:ring-inset',
].join(' ');

/**
 * Classes for tabs list container.
 */
export const tabsListClasses = ['flex', 'border-b', 'border-ss-border'].join(' ');

/**
 * Classes for tab content panel.
 */
export const tabContentClasses = ['outline-none', 'pt-3'].join(' ');
