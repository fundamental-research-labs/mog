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
import React, { useMemo } from 'react';

import type { GroupCollapseConfig } from '@mog-sdk/contracts/ribbon';
import { GroupRenderModeProvider, useRibbonCollapseLevel } from '../collapse';
import { deriveCollapseLadder, LADDER_DATA_ATTRS } from '../collapse/collapse-ladder';
import {
  RibbonVisibilityGroup,
  useRibbonGroupVisibility,
} from '../visibility/RibbonVisibilityContext';
import { CollapsedGroupDropdown } from './CollapsedGroupDropdown';

// =============================================================================
// Types
// =============================================================================

export interface ToolbarGroupDialogLauncher {
  /** Accessible label for the launcher button; use the dialog command name. */
  ariaLabel: string;
  /** Click handler that opens the associated dialog. */
  onClick: () => void;
  /** Optional DOM id for stable command resolution. */
  id?: string;
  /** Optional test id for stable command resolution. */
  testId?: string;
  /** Optional tooltip/title text. Defaults to ariaLabel. */
  title?: string;
}

export interface ToolbarGroupProps {
  /** Label displayed below the group content */
  label: string;
  /** Whether this is the last group (no right separator) */
  isLast?: boolean;
  /** Group content - rendered when not collapsed to dropdown */
  children: ReactNode;

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
  /** Optional Excel-style group launcher that opens the group's detailed dialog. */
  dialogLauncher?: ToolbarGroupDialogLauncher;
}

export const ToolbarGroup = React.memo(function ToolbarGroup({
  label,
  isLast = false,
  children,
  collapseConfig,
  dropdownIcon,
  dropdownContent,
  visibilityKey,
  dialogLauncher,
}: ToolbarGroupProps) {
  const groupVisibility = useRibbonGroupVisibility(label, visibilityKey);
  const { groupModes } = useRibbonCollapseLevel();
  const ladder = useMemo(() => deriveCollapseLadder(collapseConfig), [collapseConfig]);
  const groupKey = groupVisibility.groupKey;
  // The coordinator assigns each group a render mode; absent → most-expanded
  // rung. The ladder metadata below lets the (DOM-driven) coordinator know how
  // far this group can collapse and how important it is.
  const renderMode = groupModes[groupKey] ?? ladder.rungs[0];
  const ladderAttrs = {
    [LADDER_DATA_ATTRS.key]: groupKey,
    [LADDER_DATA_ATTRS.priority]: String(ladder.priority),
    [LADDER_DATA_ATTRS.rungs]: ladder.rungs.join(','),
    [LADDER_DATA_ATTRS.canHide]: ladder.canHide ? '1' : '0',
  };

  if (!groupVisibility.visible) {
    return null;
  }

  // Hidden mode - don't render anything
  if (renderMode === 'hidden') {
    return null;
  }

  // Dropdown mode - render collapsed button with dropdown. The layout-transparent
  // (`display: contents`) wrapper carries the ladder metadata for the coordinator
  // without adding a box to the flex row.
  if (renderMode === 'dropdown') {
    return (
      <RibbonVisibilityGroup group={groupKey}>
        <div className="contents" {...ladderAttrs}>
          <CollapsedGroupDropdown
            label={label}
            groupKey={groupKey}
            icon={dropdownIcon}
            isLast={isLast}
          >
            {dialogLauncher && (
              <div className="mb-2 flex justify-end border-b border-ss-border pb-2">
                <DialogLauncherButton launcher={dialogLauncher} placement="dropdown" />
              </div>
            )}
            {dropdownContent ?? children}
          </CollapsedGroupDropdown>
        </div>
      </RibbonVisibilityGroup>
    );
  }

  const contentClassName = [
    'flex items-center justify-center gap-[var(--ribbon-group-items-gap)] h-[var(--ribbon-content-height)]',
    // The group launcher is absolutely positioned in the bottom-right corner.
    // Reserve a gutter so its hit target never covers the trailing command.
    dialogLauncher ? 'pr-5' : '',
  ].join(' ');

  return (
    <RibbonVisibilityGroup group={groupKey}>
      <GroupRenderModeProvider value={renderMode}>
        <div
          className="relative flex px-[var(--ribbon-group-padding-x)] group/toolbar-group"
          role="group"
          aria-label={label}
          {...ladderAttrs}
        >
          {/* Content area - fixed height from design token */}
          <div data-ribbon-group-content className={contentClassName}>
            {children}
          </div>
          {dialogLauncher && <DialogLauncherButton launcher={dialogLauncher} placement="group" />}
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

function DialogLauncherButton({
  launcher,
  placement,
}: {
  launcher: ToolbarGroupDialogLauncher;
  placement: 'group' | 'dropdown';
}) {
  const placementClass =
    placement === 'group' ? 'absolute bottom-0.5 right-1 h-3.5 w-3.5' : 'h-5 w-5';
  const className = [
    'flex items-center justify-center rounded-sm text-ss-text-tertiary',
    'transition-colors duration-ss-fast',
    'hover:bg-ss-surface-hover hover:text-ss-text-primary',
    'focus-visible:ring-1 focus-visible:ring-ss-primary focus-visible:ring-offset-1',
    placementClass,
  ].join(' ');

  return (
    <button
      type="button"
      id={launcher.id}
      data-testid={launcher.testId}
      className={className}
      aria-label={launcher.ariaLabel}
      title={launcher.title ?? launcher.ariaLabel}
      onClick={(event) => {
        event.stopPropagation();
        launcher.onClick();
      }}
    >
      <svg
        width="8"
        height="8"
        viewBox="0 0 8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 1.5h4.5V6" />
        <path d="M6.5 1.5 1.5 6.5" />
      </svg>
    </button>
  );
}
