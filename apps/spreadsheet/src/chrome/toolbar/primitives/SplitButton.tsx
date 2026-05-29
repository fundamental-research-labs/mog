/**
 * SplitButton
 *
 * A button with two separate click areas:
 * - Main area: triggers the primary action
 * - Dropdown area: opens a menu with additional options
 *
 * Used for actions that have a default behavior plus alternatives:
 * - Paste (default) + Paste Values, Paste Formulas, etc.
 * - Font Color (apply last color) + Color picker
 * - Fill Color (apply last color) + Color picker
 * - Borders (apply last border) + Border picker
 *
 * Variants:
 * - 'small': Compact inline button for toolbar (28px height)
 * - 'large': Full-height ribbon button with label (66px height)
 *
 * COLLAPSE SUPPORT (
 * SplitButton reads GroupRenderModeContext to adapt its rendering.
 * - 'icons' mode: Large variant hides label (becomes icon-only)
 * - 'compact' mode: Large variant uses smaller sizing
 * - 'full' mode: Uses preferred variant
 *
 * Uses design tokens from globals.css for consistent styling.
 */

import type { ReactNode } from 'react';
import React from 'react';

import type { GroupRenderMode } from '@mog-sdk/contracts/ribbon';
import { useGroupRenderMode } from '../collapse';
import { useRibbonButtonVisible } from '../visibility/RibbonVisibilityContext';
import { DropdownArrowIcon } from './ToolbarIcons';

type SplitButtonVariant = 'small' | 'large';

interface SplitButtonProps {
  /** Optional ID for keytip positioning */
  id?: string;
  /** Icon element for the main button */
  icon: ReactNode;
  /** Label (only shown in 'large' variant) */
  label?: string;
  /** Size variant */
  variant?: SplitButtonVariant;
  /** Whether the dropdown is currently open */
  isOpen?: boolean;
  /** Whether the entire button is disabled */
  disabled?: boolean;
  /** Tooltip for main button */
  title?: string;
  /** Accessible label for main button */
  'aria-label'?: string;
  /** Called when main button is clicked */
  onMainClick: () => void;
  /** Called when dropdown trigger is clicked */
  onDropdownClick: () => void;
  /** Additional class names */
  className?: string;
  /** Optional stable test selector for the dropdown-arrow button */
  dropdownTestId?: string;
  /** Optional stable test selector for the main action button */
  mainTestId?: string;
  /** Optional typed ribbon visibility key. Defaults to test id, label, title, then aria-label. */
  visibilityKey?: string;
}

/**
 * SplitButton - Two-part button with main action and dropdown.
 *
 * @example
 * ```tsx
 * // Small inline split button (font color)
 * <SplitButton
 * icon={<FontColorIcon color={currentColor} />}
 * variant="small"
 * isOpen={colorPickerOpen}
 * onMainClick={ => applyLastColor}
 * onDropdownClick={ => setColorPickerOpen(!colorPickerOpen)}
 * />
 *
 * // Large split button (Paste)
 * <SplitButton
 * icon={<PasteIcon />}
 * label="Paste"
 * variant="large"
 * isOpen={pasteMenuOpen}
 * disabled={!hasClipboard}
 * onMainClick={onPaste}
 * onDropdownClick={ => setPasteMenuOpen(!pasteMenuOpen)}
 * />
 * ```
 */
/**
 * Derive whether to show label based on group render mode.
 * In 'icons' mode, large variant hides label to save space.
 */
function shouldShowLabel(
  groupMode: GroupRenderMode,
  variant: SplitButtonVariant,
  hasLabel: boolean,
): boolean {
  // Small variant never shows label
  if (variant === 'small') return false;

  // In icons mode, hide label even for large variant
  if (groupMode === 'icons') return false;

  // Otherwise show label if provided
  return hasLabel;
}

/**
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 */
export const SplitButton = React.memo(function SplitButton({
  id,
  icon,
  label,
  variant = 'small',
  isOpen = false,
  disabled = false,
  title,
  'aria-label': ariaLabel,
  onMainClick,
  onDropdownClick,
  className = '',
  dropdownTestId,
  mainTestId,
  visibilityKey,
}: SplitButtonProps) {
  // Get group render mode from context (collapse support)
  const groupMode = useGroupRenderMode();
  const visible = useRibbonButtonVisible({
    visibilityKey,
    label,
    testId: mainTestId ?? dropdownTestId,
    title,
    ariaLabel,
  });

  if (!visible) {
    return null;
  }

  // Determine if label should be shown
  const showLabel = shouldShowLabel(groupMode, variant, !!label);

  // Common button styles
  const buttonBase = `
 flex items-center justify-center
 transition-all duration-ss-fast
 outline-none
 focus-visible:ring-2 focus-visible:ring-ss-primary focus-visible:ring-offset-1
 disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed disabled:pointer-events-none disabled:shadow-none
 `;

  const hoverStyles = 'hover:bg-ss-surface-hover hover:shadow-ss-button-hover';
  const activeStyles = 'active:bg-ss-surface-active active:shadow-ss-button-active';

  if (variant === 'large') {
    // Adjust sizing based on collapse mode
    // In icons mode, use more compact sizing
    const isCompact = groupMode === 'icons' || groupMode === 'compact';
    const mainButtonClasses = isCompact
      ? 'px-2 py-1 min-w-[32px]' // Compact sizing
      : 'px-3 py-1 min-w-[44px]'; // Full sizing

    return (
      <div id={id} className={`flex flex-row items-stretch ${className}`}>
        {/* Main Button - Large */}
        <button
          type="button"
          onClick={onMainClick}
          disabled={disabled}
          title={title}
          aria-label={ariaLabel}
          data-testid={mainTestId}
          className={`
 ${buttonBase}
 flex-col gap-0.5
 ${mainButtonClasses}
 h-[var(--ribbon-content-height)]
 text-ss-text-secondary
 border border-ss-border rounded-l
 cursor-pointer select-none
 ${hoverStyles}
 ${activeStyles}
 `}
        >
          <span className="flex items-center justify-center w-5 h-5">{icon}</span>
          {showLabel && (
            <span className="text-ribbon leading-tight whitespace-nowrap">{label}</span>
          )}
        </button>

        {/* Dropdown Trigger - Large */}
        <button
          type="button"
          onClick={onDropdownClick}
          disabled={disabled}
          title={title ? `${title} options` : 'More options'}
          aria-label={ariaLabel ? `${ariaLabel} options` : 'More options'}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          data-testid={dropdownTestId}
          className={`
 ${buttonBase}
 px-1 min-w-[16px]
 h-[var(--ribbon-content-height)]
 border border-l-0 border-ss-border rounded-r
 cursor-pointer select-none
 ${isOpen ? 'bg-ss-primary-light text-ss-primary' : `text-ss-text-secondary ${hoverStyles}`}
 ${activeStyles}
 `}
        >
          <DropdownArrowIcon />
        </button>
      </div>
    );
  }

  // Small variant (default)
  return (
    <div id={id} className={`flex flex-row items-stretch ${className}`}>
      {/* Main Button - Small */}
      <button
        type="button"
        onClick={onMainClick}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        data-testid={mainTestId}
        className={`
 ${buttonBase}
 w-6 h-7
 text-ss-text-secondary
 border border-ss-border rounded-l
 cursor-pointer select-none
 ${hoverStyles}
 ${activeStyles}
 `}
      >
        {icon}
      </button>

      {/* Dropdown Trigger - Small */}
      <button
        type="button"
        onClick={onDropdownClick}
        disabled={disabled}
        title={title ? `${title} options` : 'More options'}
        aria-label={ariaLabel ? `${ariaLabel} options` : 'More options'}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        data-testid={dropdownTestId}
        className={`
 ${buttonBase}
 px-0.5 min-w-[14px] h-7
 border border-l-0 border-ss-border rounded-r
 cursor-pointer select-none
 ${isOpen ? 'bg-ss-primary-light text-ss-primary' : `text-ss-text-secondary ${hoverStyles}`}
 ${activeStyles}
 `}
      >
        <DropdownArrowIcon />
      </button>
    </div>
  );
});
