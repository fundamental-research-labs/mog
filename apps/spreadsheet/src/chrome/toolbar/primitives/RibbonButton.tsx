/**
 * RibbonButton - Orthogonal Architecture
 *
 * SINGLE SOURCE OF TRUTH for all ribbon buttons in the toolbar.
 *
 * This component uses THREE ORTHOGONAL PROPS to express any button configuration:
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │ DIMENSION 1: layout - How icon and label are arranged │
 * │ │
 * │ "icon-only" │ Just icon, no visible label (uses --ribbon-button-height-third)│
 * │ "vertical" │ Icon above label │
 * │ "horizontal" │ Icon beside label │
 * ├─────────────────────────────────────────────────────────────────────────────────┤
 * │ DIMENSION 2: height - How tall, relative to ribbon content area │
 * │ │
 * │ "full" │ var(--ribbon-button-height-full) = 62px │
 * │ "half" │ var(--ribbon-button-height-half) = 30px (fits 2 stacked) │
 * │ "third" │ var(--ribbon-button-height-third) = ~19px (fits 3 stacked) │
 * ├─────────────────────────────────────────────────────────────────────────────────┤
 * │ DIMENSION 3: width - How wide (only for vertical layout) │
 * │ │
 * │ "normal" │ min-width: 48px (default) │
 * │ "narrow" │ min-width: 36px │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * CONSTRAINT-BASED HEIGHTS:
 * Heights are derived from --ribbon-content-height via CSS calc().
 * This guarantees N stacked buttons ALWAYS fit. Overflow is impossible.
 *
 * COLLAPSE SUPPORT (
 * RibbonButton reads GroupRenderModeContext to adapt its layout.
 * - 'icons' mode: All buttons become icon-only
 * - 'compact' mode: Vertical buttons become horizontal
 * - 'full' mode: Use preferred layout
 *
 * MIGRATION FROM OLD API:
 * ┌──────────────────────┬─────────────────────────────────────────────────────────┐
 * │ Old │ New │
 * ├──────────────────────┼─────────────────────────────────────────────────────────┤
 * │ variant="icon" │ layout="icon-only" │
 * │ variant="large" │ layout="vertical" height="full" │
 * │ variant="compact" │ layout="vertical" height="full" width="narrow" │
 * │ variant="inline" │ layout="horizontal" height="third" │
 * │ 2-stacked compact │ layout="vertical" height="half" │
 * │ 2-stacked horizontal │ layout="horizontal" height="half" │
 * │ 3-stacked inline │ layout="horizontal" height="third" │
 * └──────────────────────┴─────────────────────────────────────────────────────────┘
 *
 * IMPORTANT: All ribbon buttons MUST use this component or SplitButton.
 * Do NOT use raw <button> elements or ui/Button in ribbon components.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import React from 'react';

import type { GroupRenderMode } from '@mog-sdk/contracts/ribbon';
import { useGroupRenderMode } from '../collapse/context';
import { useRibbonButtonVisible } from '../visibility/RibbonVisibilityContext';
import { DropdownArrowIcon } from './ToolbarIcons';

// =============================================================================
// Types - Orthogonal Dimensions
// =============================================================================

/** How icon and label are arranged */
export type Layout = 'icon-only' | 'vertical' | 'horizontal' | 'text';

/** How tall the button is, relative to ribbon content area */
type Height = 'full' | 'half' | 'third';

/** How wide the button is (only applies to vertical layout) */
type Width = 'normal' | 'narrow';

// =============================================================================
// Props - Discriminated Union by Layout
// =============================================================================

/** Props for icon-only layout - label is optional (for tooltip/aria) */
interface IconOnlyProps {
  layout: 'icon-only';
  /** Icon element (should be 16x16) */
  icon: ReactNode;
  /** Optional label for tooltip/aria-label only (not displayed) */
  label?: string;
  // Height uses constraint-based --ribbon-button-height-third to guarantee 3 buttons fit
}

/** Props for vertical layout - icon above label */
interface VerticalProps {
  layout: 'vertical';
  /** Button height relative to ribbon content area */
  height: Height;
  /** Button width - 'normal' (48px) or 'narrow' (36px). Default: 'normal' */
  width?: Width;
  /** Icon element (20x20 for full height, 16x16 for half/third) */
  icon: ReactNode;
  /**
   * Button label displayed below icon.
   * Use \n for multi-line labels (e.g., "Header &\nFooter")
   */
  label: string;
}

/** Props for horizontal layout - icon beside label */
interface HorizontalProps {
  layout: 'horizontal';
  /** Button height relative to ribbon content area */
  height: Height;
  /** Icon element (16x16) */
  icon: ReactNode;
  /** Button label displayed beside icon */
  label: string;
}

/**
 * Props for text-only layout - just text, no icon.
 * Text-only buttons cannot collapse to icon-only mode (no icon available).
 */
interface TextOnlyProps {
  layout: 'text';
  /** Text label displayed in button (required) */
  label: string;
  /**
   * Button height relative to ribbon content area.
   * Defaults to 'third' (22px via CSS var) to match icon-only buttons.
   */
  height?: Height;
  // NOTE: NO icon prop - this is text-only
}

type LayoutProps = IconOnlyProps | VerticalProps | HorizontalProps | TextOnlyProps;

/** Common props shared across all layouts */
interface CommonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Whether to show dropdown arrow */
  hasDropdown?: boolean;
  /**
   * Position of dropdown arrow (only for vertical layout with full height):
   * - 'bottom': Arrow at bottom of button, below label (default)
   * - 'inline': Arrow inline with label (more compact)
   */
  dropdownPosition?: 'bottom' | 'inline';
  /** Whether the dropdown is open or button is in "pressed" state */
  isOpen?: boolean;
  /** Optional typed ribbon visibility key. Defaults to test id, label, title, then aria-label. */
  visibilityKey?: string;
}

export type RibbonButtonProps = LayoutProps & CommonProps;

// =============================================================================
// Shared Styles
// =============================================================================

/** Base styles shared by all layouts */
const baseStyles = `
 relative
 flex items-center justify-center
 rounded cursor-pointer select-none
 transition-all duration-ss-fast
 outline-none
 focus-visible:ring-2 focus-visible:ring-ss-primary focus-visible:ring-offset-1
 disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed disabled:pointer-events-none disabled:shadow-none
`;

/** Hover state styles (when not open) */
const hoverStyles =
  'hover:bg-ss-surface-hover hover:border-ss-border-button-hover hover:shadow-ss-button-hover';

/** Active (mouse down) state styles */
const activeStyles = 'active:bg-ss-surface-active active:shadow-ss-button-active';

/** Open/pressed state styles */
const openStyles = 'bg-ss-primary-light text-ss-primary';

/** Default (closed) state styles */
const closedStyles = 'bg-transparent text-ss-text-secondary';

// =============================================================================
// Height CSS Variable Mapping
// =============================================================================

const heightVars: Record<Height, string> = {
  full: 'var(--ribbon-button-height-full)',
  half: 'var(--ribbon-button-height-half)',
  third: 'var(--ribbon-button-height-third)',
};

function getLabelWhitespaceClass(label: string): string {
  return label.includes('\n') ? 'whitespace-pre' : 'whitespace-nowrap';
}

// =============================================================================
// Layout Derivation (Collapse Support)
// =============================================================================

/**
 * Derive actual button layout from preferred layout and group render mode.
 *
 * Group mode takes precedence when more compact rendering is needed.
 * This is the key integration point for responsive ribbon collapse.
 *
 * | Group Mode | Preferred Layout | Actual Layout |
 * |------------|------------------|---------------|
 * | 'icons' | any | 'icon-only' |
 * | 'compact' | 'vertical' | 'horizontal' |
 * | 'compact' | other | unchanged |
 * | 'full' | any | unchanged |
 * | 'dropdown' | any | unchanged | (handled by ToolbarGroup)
 * | 'hidden' | any | unchanged | (component not rendered)
 */
function deriveLayout(preferred: Layout, groupMode: GroupRenderMode): Layout {
  // CRITICAL: Check this FIRST before icons mode check
  // Text-only buttons CANNOT collapse to icon-only (there's no icon!)
  if (preferred === 'text') {
    return 'text';
  }

  // In 'icons' mode, all buttons become icon-only
  if (groupMode === 'icons') {
    return 'icon-only';
  }

  // In 'compact' mode, vertical buttons become horizontal (more space efficient)
  if (groupMode === 'compact' && preferred === 'vertical') {
    return 'horizontal';
  }

  // Otherwise use preferred layout
  // Note: 'dropdown' and 'hidden' modes are handled by ToolbarGroup,
  // not by individual buttons. By the time this code runs, the group
  // has already decided to render its children (not collapse to dropdown).
  return preferred;
}

// =============================================================================
// Component
// =============================================================================

/**
 * RibbonButton - Unified button component for ribbon toolbar.
 *
 * @example Icon-only (22x22)
 * ```tsx
 * <RibbonButton
 * layout="icon-only"
 * icon={<BoldIcon />}
 * onClick={toggleBold}
 * isOpen={isBold}
 * title="Bold (Ctrl+B)"
 * />
 * ```
 *
 * @example Vertical full height (formerly "large")
 * ```tsx
 * <RibbonButton
 * layout="vertical"
 * height="full"
 * icon={<PasteIcon />}
 * label="Paste"
 * onClick={onPaste}
 * />
 * ```
 *
 * @example Vertical full height, narrow (formerly "compact")
 * ```tsx
 * <RibbonButton
 * layout="vertical"
 * height="full"
 * width="narrow"
 * icon={<TracePrecedentsIcon />}
 * label="Precedents"
 * />
 * ```
 *
 * @example Vertical half height (2 stacked)
 * ```tsx
 * <RibbonButton
 * layout="vertical"
 * height="half"
 * icon={<ShowHideIcon />}
 * label="Show/Hide"
 * />
 * ```
 *
 * @example Horizontal third height (3 stacked, like CellsGroup)
 * ```tsx
 * <RibbonButton
 * layout="horizontal"
 * height="third"
 * icon={<InsertIcon />}
 * label="Insert"
 * hasDropdown
 * />
 * ```
 *
 * @example Horizontal half height (2 stacked horizontal)
 * ```tsx
 * <RibbonButton
 * layout="horizontal"
 * height="half"
 * icon={<SomeIcon />}
 * label="Action"
 * />
 * ```
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 */
export const RibbonButton = React.memo(function RibbonButton(props: RibbonButtonProps) {
  const {
    hasDropdown = false,
    dropdownPosition = 'bottom',
    isOpen = false,
    className = '',
    disabled = false,
    visibilityKey,
    ...rest
  } = props;

  // Get group render mode from context (collapse support)
  const groupMode = useGroupRenderMode();

  // Extract layout-specific props
  const preferredLayout = props.layout;
  const icon = 'icon' in props ? props.icon : undefined;
  const label = 'label' in props ? props.label : undefined;
  const restRecord = rest as Record<string, unknown>;
  const visible = useRibbonButtonVisible({
    visibilityKey,
    label,
    testId: restRecord['data-testid'] as string | undefined,
    title: restRecord.title as string | undefined,
    ariaLabel: restRecord['aria-label'] as string | undefined,
  });

  if (!visible) {
    return null;
  }

  // Derive actual layout based on group render mode
  const layout = deriveLayout(preferredLayout, groupMode);

  // Compute state-dependent styles
  const stateStyles = isOpen ? openStyles : `${closedStyles} ${hoverStyles}`;

  // Filter out layout-specific props before passing to button
  const { layout: _layout, icon: _icon, ...buttonProps } = rest as Record<string, unknown>;
  delete buttonProps.visibilityKey;
  if ('height' in buttonProps) delete buttonProps.height;
  if ('width' in buttonProps) delete buttonProps.width;
  if ('label' in buttonProps) delete buttonProps.label;

  // Extract height from props (both vertical and horizontal props have height)
  // Note: When deriveLayout converts vertical→horizontal or any→icon-only,
  // we still need access to the original height for proper rendering.
  // For text-only layout, default to 'third' (22px) to match icon-only buttons.
  const defaultHeight: Height = props.layout === 'text' ? 'third' : 'full';
  const height: Height = 'height' in props ? (props.height ?? defaultHeight) : defaultHeight;
  const width: Width = 'width' in props ? (props.width ?? 'normal') : 'normal';

  // Render based on derived layout
  switch (layout) {
    case 'icon-only':
      return (
        <IconOnlyButton
          icon={icon}
          hasDropdown={hasDropdown}
          isOpen={isOpen}
          stateStyles={stateStyles}
          className={className}
          disabled={disabled}
          {...(buttonProps as ButtonHTMLAttributes<HTMLButtonElement>)}
        />
      );

    case 'vertical':
      return (
        <VerticalButton
          icon={icon}
          label={label!}
          height={height}
          width={width}
          hasDropdown={hasDropdown}
          dropdownPosition={dropdownPosition}
          isOpen={isOpen}
          stateStyles={stateStyles}
          className={className}
          disabled={disabled}
          {...(buttonProps as ButtonHTMLAttributes<HTMLButtonElement>)}
        />
      );

    case 'horizontal':
      return (
        <HorizontalButton
          icon={icon}
          label={label!}
          height={height}
          hasDropdown={hasDropdown}
          isOpen={isOpen}
          stateStyles={stateStyles}
          className={className}
          disabled={disabled}
          {...(buttonProps as ButtonHTMLAttributes<HTMLButtonElement>)}
        />
      );

    case 'text':
      return (
        <TextOnlyButton
          label={label!}
          height={height}
          hasDropdown={hasDropdown}
          isOpen={isOpen}
          stateStyles={stateStyles}
          className={className}
          disabled={disabled}
          {...(buttonProps as ButtonHTMLAttributes<HTMLButtonElement>)}
        />
      );
  }
});

// =============================================================================
// Layout Implementations
// =============================================================================

interface BaseButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  isOpen: boolean;
  stateStyles: string;
}

/**
 * Icon-Only Layout - 22x22 icon button
 *
 * Layout:
 * ┌──────┐
 * │ [16] │ ← 16x16 icon centered in 22x22 button
 * └──────┘
 */
function IconOnlyButton({
  icon,
  hasDropdown = false,
  isOpen,
  stateStyles,
  className,
  disabled,
  ...buttonProps
}: BaseButtonProps & { hasDropdown?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`
 ${baseStyles}
 ${hasDropdown ? 'min-w-[28px] px-0.5' : 'w-[var(--ribbon-button-height-third)]'}
 h-[var(--ribbon-button-height-third)]
 ${stateStyles}
 ${activeStyles}
 ${className}
 `}
      aria-pressed={'aria-pressed' in buttonProps ? buttonProps['aria-pressed'] : isOpen}
      aria-expanded={hasDropdown ? isOpen : buttonProps['aria-expanded']}
      aria-haspopup={hasDropdown ? 'menu' : buttonProps['aria-haspopup']}
      {...buttonProps}
    >
      {hasDropdown ? (
        <span className="flex items-center justify-center gap-[var(--ribbon-button-icon-gap)]">
          <span className="flex items-center justify-center w-4 h-4 overflow-visible">{icon}</span>
          <DropdownArrowIcon className={isOpen ? 'rotate-180' : ''} />
        </span>
      ) : (
        <span className="flex items-center justify-center w-4 h-4 overflow-visible">{icon}</span>
      )}
    </button>
  );
}

interface VerticalButtonProps extends BaseButtonProps {
  label: string;
  height: Height;
  width: Width;
  hasDropdown: boolean;
  dropdownPosition: 'bottom' | 'inline';
}

/**
 * Vertical Layout - Icon above label
 *
 * Full height layout (dropdownPosition='bottom'):
 * ┌─────────────┐
 * │ [ICON] │ ← 20x20 icon
 * │ Label │ ← Text label
 * │ │ ← flex spacer
 * │ ▼ │ ← Dropdown arrow at bottom
 * └─────────────┘
 *
 * Full height layout (dropdownPosition='inline'):
 * ┌─────────────┐
 * │ [ICON] │ ← 20x20 icon
 * │ Label ▼ │ ← Text label with inline arrow
 * └─────────────┘
 *
 * Half/Third height (compact):
 * ┌─────────────┐
 * │ [16] Label │ ← Condensed for smaller heights
 * └─────────────┘
 */
function VerticalButton({
  icon,
  label,
  height,
  width,
  hasDropdown,
  dropdownPosition,
  isOpen,
  stateStyles,
  className,
  disabled,
  ...buttonProps
}: VerticalButtonProps) {
  const isFullHeight = height === 'full';
  const isInlineDropdown = hasDropdown && dropdownPosition === 'inline';
  const isBottomDropdown = hasDropdown && dropdownPosition === 'bottom' && isFullHeight;

  // Icon size: 20x20 for full height, 16x16 for half/third
  const iconSize = isFullHeight ? 'w-5 h-5' : 'w-4 h-4';

  // Text size: normal for full height, compact for half/third
  const textClass = isFullHeight ? 'text-ribbon' : 'text-ribbon-compact';
  const labelWhitespaceClass = getLabelWhitespaceClass(label);

  // Min-width based on width prop
  const minWidth = width === 'narrow' ? 'min-w-[36px]' : 'min-w-[48px]';

  // For half/third heights, use a more horizontal layout
  if (!isFullHeight) {
    return (
      <button
        type="button"
        disabled={disabled}
        style={{ height: heightVars[height] }}
        className={`
 ${baseStyles}
 flex-col justify-center
 px-1.5 ${minWidth}
 ${stateStyles}
 ${activeStyles}
 ${className}
 `}
        aria-expanded={hasDropdown ? isOpen : undefined}
        aria-haspopup={hasDropdown ? 'menu' : undefined}
        {...buttonProps}
      >
        {/* Compact vertical layout: icon above short label */}
        <span className="flex flex-col items-center gap-0.5">
          <span className={`flex items-center justify-center ${iconSize}`}>{icon}</span>
          <span className={`${textClass} leading-tight ${labelWhitespaceClass} text-center`}>
            {label}
            {hasDropdown && (
              <DropdownArrowIcon className={`ml-0.5 inline ${isOpen ? 'rotate-180' : ''}`} />
            )}
          </span>
        </span>
      </button>
    );
  }

  // Full height vertical layout
  return (
    <button
      type="button"
      disabled={disabled}
      style={{ height: heightVars[height] }}
      className={`
 ${baseStyles}
 flex-col justify-between
 px-1.5 pt-2 pb-1 ${minWidth}
 ${stateStyles}
 ${activeStyles}
 ${className}
 `}
      aria-expanded={hasDropdown ? isOpen : undefined}
      aria-haspopup={hasDropdown ? 'menu' : undefined}
      {...buttonProps}
    >
      {/* Top content group: icon + label */}
      <span className="flex flex-col items-center gap-[var(--ribbon-button-icon-gap)]">
        {/* Icon container - 20x20 */}
        <span className={`flex items-center justify-center ${iconSize}`}>{icon}</span>
        {/* Label - with optional inline dropdown arrow */}
        {/* Supports multi-line labels via \n (e.g., "Header &\nFooter") */}
        {isInlineDropdown ? (
          <span className="flex items-center gap-0.5">
            <span className={`text-ribbon leading-tight ${labelWhitespaceClass} text-center`}>
              {label}
            </span>
            <DropdownArrowIcon className={isOpen ? 'rotate-180' : ''} />
          </span>
        ) : (
          <span className={`text-ribbon leading-tight ${labelWhitespaceClass} text-center`}>
            {label}
          </span>
        )}
      </span>

      {/* Bottom element: dropdown arrow or empty spacer for consistent layout */}
      {isBottomDropdown ? <DropdownArrowIcon /> : <span aria-hidden="true" />}
    </button>
  );
}

interface HorizontalButtonProps extends BaseButtonProps {
  label: string;
  height: Height;
  hasDropdown: boolean;
}

/**
 * Horizontal Layout - Icon beside label
 *
 * Layout:
 * ┌────────────────────┐
 * │ [16] Label ▼ │ ← 16x16 icon, label, optional arrow
 * └────────────────────┘
 */
function HorizontalButton({
  icon,
  label,
  height,
  hasDropdown,
  isOpen,
  stateStyles,
  className,
  disabled,
  ...buttonProps
}: HorizontalButtonProps) {
  // Text size based on height - smaller for third height
  const textClass = height === 'third' ? 'text-ribbon-compact' : 'text-ribbon';
  const labelWhitespaceClass = getLabelWhitespaceClass(label);

  return (
    <button
      type="button"
      disabled={disabled}
      style={{ height: heightVars[height] }}
      className={`
 ${baseStyles}
 flex-row
 px-1.5 gap-1
 ${stateStyles}
 ${activeStyles}
 ${className}
 `}
      aria-expanded={hasDropdown ? isOpen : undefined}
      aria-haspopup={hasDropdown ? 'menu' : undefined}
      {...buttonProps}
    >
      {/* Icon container - 16x16 */}
      <span className="flex items-center justify-center w-4 h-4">{icon}</span>

      {/* Label */}
      <span className={`${textClass} leading-tight ${labelWhitespaceClass} text-center`}>
        {label}
      </span>

      {/* Dropdown arrow */}
      {hasDropdown && <DropdownArrowIcon className={isOpen ? 'rotate-180' : ''} />}
    </button>
  );
}

interface TextOnlyButtonProps extends Omit<BaseButtonProps, 'icon'> {
  label: string;
  height: Height;
  hasDropdown: boolean;
}

/**
 * Text-Only Layout - Just text, no icon
 *
 * Layout:
 * ┌────────────────────┐
 * │ 100% ▼ │ ← text label, optional arrow
 * └────────────────────┘
 *
 * Used for buttons where the content IS the text (e.g., "100%" zoom button).
 * Cannot collapse to icon-only mode (no icon available).
 */
function TextOnlyButton({
  label,
  height,
  hasDropdown,
  isOpen,
  stateStyles,
  className,
  disabled,
  ...buttonProps
}: TextOnlyButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      style={{ height: heightVars[height] }}
      className={`
 ${baseStyles}
 px-2 min-w-fit
 ${stateStyles}
 ${activeStyles}
 ${className}
 `}
      aria-expanded={hasDropdown ? isOpen : undefined}
      aria-haspopup={hasDropdown ? 'menu' : undefined}
      {...buttonProps}
    >
      <span className="text-ribbon font-medium whitespace-nowrap">{label}</span>
      {hasDropdown && <DropdownArrowIcon className={`ml-0.5 ${isOpen ? 'rotate-180' : ''}`} />}
    </button>
  );
}
