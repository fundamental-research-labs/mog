/**
 * ToolbarGroup
 *
 * Reusable wrapper for ribbon groups with label.
 * Uses Tailwind classes for consistent styling.
 *
 * ARCHITECTURE (Collapse Owner):
 * - Reads collapse level from RibbonCollapseContext (provided by TabbedToolbar)
 * - Uses collapseConfig prop to determine render mode for current level
 * - Provides GroupRenderModeContext to children (RibbonButton, etc.)
 * - Handles hidden/dropdown/normal rendering based on collapse level
 *
 * polish:
 * - Gradient fade separator (E2) - fades at top/bottom for softer appearance
 * - Dialog launcher support - Excel-style diagonal arrow to open dialogs
 *
 */

import type { ReactNode } from 'react';
import React from 'react';

import { Tooltip } from '@mog/shell';
import type { GroupCollapseConfig, GroupRenderMode } from '@mog-sdk/contracts/ribbon';
import { GroupRenderModeProvider, useRibbonCollapseLevel } from '../collapse';
import {
  RibbonVisibilityGroup,
  RibbonVisibilityItem,
  useRibbonGroupVisibility,
} from '../visibility/RibbonVisibilityContext';
import { CollapsedGroupDropdown } from './CollapsedGroupDropdown';

// =============================================================================
// Dialog Launcher Icon
// =============================================================================

/**
 * Small diagonal arrow icon for dialog launcher.
 * Matches Excel's visual style - subtle, small (10x10).
 * Points to bottom-right to indicate "more options".
 */
function DialogLauncherIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Diagonal arrow pointing to bottom-right corner */}
      <path d="M3 3L7 7" />
      <path d="M7 4V7H4" />
    </svg>
  );
}

// =============================================================================
// Types
// =============================================================================

export interface ToolbarGroupProps {
  /** Label displayed below the group content */
  label: string;
  /** Whether this is the last group (no right separator) */
  isLast?: boolean;
  /** Group content - rendered when not collapsed to dropdown */
  children: ReactNode;
  /**
   * Optional callback when dialog launcher is clicked.
   * When provided, renders a small diagonal arrow icon in the bottom-right
   * corner that opens a related dialog (Excel-style dialog launcher).
   */
  onDialogLaunch?: () => void;
  /**
   * Tooltip text for the dialog launcher icon.
   * Defaults to "{label} Settings" if not provided.
   */
  dialogLaunchTitle?: string;

  // === Collapse configuration (NEW) ===

  /**
   * Collapse configuration for this group.
   * If not provided, group never collapses (always 'full').
   *
   * @see contracts/src/ribbon/collapse-configs.ts for predefined configs
   */
  collapseConfig?: GroupCollapseConfig;

  /**
   * Icon to show when collapsed to dropdown mode.
   * Required if collapseConfig can result in 'dropdown' mode.
   */
  dropdownIcon?: ReactNode;

  /**
   * Custom content for dropdown when collapsed.
   * If not provided, children are rendered inside the dropdown.
   */
  dropdownContent?: ReactNode;
  /** Optional typed ribbon visibility key. Defaults to a normalized label. */
  visibilityKey?: string;
}

export const ToolbarGroup = React.memo(function ToolbarGroup({
  label,
  isLast = false,
  children,
  onDialogLaunch,
  dialogLaunchTitle,
  collapseConfig,
  dropdownIcon,
  dropdownContent,
  visibilityKey,
}: ToolbarGroupProps) {
  const groupVisibility = useRibbonGroupVisibility(label, visibilityKey);
  // Get current collapse level from context (provided by TabbedToolbar)
  const { level } = useRibbonCollapseLevel();

  // Determine render mode from config + current collapse level
  // If no config provided, always render in 'full' mode
  const renderMode: GroupRenderMode = collapseConfig?.levels[level] ?? 'full';

  if (!groupVisibility.visible) {
    return null;
  }

  // Hidden mode - don't render anything
  if (renderMode === 'hidden') {
    return null;
  }

  // Dropdown mode - render collapsed button with dropdown
  if (renderMode === 'dropdown') {
    return (
      <RibbonVisibilityGroup group={groupVisibility.groupKey}>
        <CollapsedGroupDropdown label={label} icon={dropdownIcon} isLast={isLast}>
          {dropdownContent ?? children}
        </CollapsedGroupDropdown>
      </RibbonVisibilityGroup>
    );
  }

  // Full/Compact/Icons mode - render normal group with mode context
  // Default tooltip title if not provided
  const launchTitle = dialogLaunchTitle ?? `${label} Settings`;

  return (
    <RibbonVisibilityGroup group={groupVisibility.groupKey}>
      <GroupRenderModeProvider value={renderMode}>
        <div className="relative flex flex-col px-[var(--ribbon-group-padding-x)] group/toolbar-group">
          {/* Content area - fixed height from design token */}
          <div className="flex items-center justify-center gap-[var(--ribbon-group-items-gap)] h-[var(--ribbon-content-height)]">
            {children}
          </div>
          {/* Label area - fixed height from design token */}
          {/* Excel uses UPPERCASE group labels */}
          {/* Position relative to allow dialog launcher positioning */}
          <div
            className="relative flex items-center justify-center h-[var(--ribbon-label-height)] text-ribbon-group leading-none text-ss-text-tertiary whitespace-nowrap uppercase"
            style={{ letterSpacing: 'var(--ribbon-group-label-letter-spacing)' }}
          >
            {label}
            {/* Dialog Launcher - Excel-style small arrow in bottom-right corner */}
            {/* Only rendered when onDialogLaunch is provided */}
            {onDialogLaunch && (
              <RibbonVisibilityItem item="dialogLauncher">
                <Tooltip title={launchTitle}>
                  <button
                    type="button"
                    onClick={onDialogLaunch}
                    className="
 absolute right-0 bottom-0
 w-3 h-3
 flex items-center justify-center
 text-ss-text-tertiary
 opacity-50 group-hover/toolbar-group:opacity-100
 hover:!opacity-100 hover:text-ss-primary
 transition-opacity duration-ss-fast
 cursor-pointer
 bg-transparent border-none outline-none
 rounded-ss-sm
 focus-visible:ring-1 focus-visible:ring-ss-primary focus-visible:opacity-100
 "
                    aria-label={launchTitle}
                  >
                    <DialogLauncherIcon />
                  </button>
                </Tooltip>
              </RibbonVisibilityItem>
            )}
          </div>
          {/* E2: Gradient fade separator - softer than solid border */}
          {/* Extended fade region (10%-90%) for more visible separator while keeping soft edges */}
          {!isLast && (
            <div
              className="absolute right-0 top-2 bottom-2 w-[var(--ribbon-group-separator-width)]"
              style={{
                background:
                  'linear-gradient(to bottom, transparent 0%, var(--color-ss-border) 10%, var(--color-ss-border) 90%, transparent 100%)',
              }}
            />
          )}
        </div>
      </GroupRenderModeProvider>
    </RibbonVisibilityGroup>
  );
});
