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

import type { GroupCollapseConfig, GroupRenderMode } from '@mog-sdk/contracts/ribbon';
import { GroupRenderModeProvider, useRibbonCollapseLevel } from '../collapse';
import {
  RibbonVisibilityGroup,
  useRibbonGroupVisibility,
} from '../visibility/RibbonVisibilityContext';
import { CollapsedGroupDropdown } from './CollapsedGroupDropdown';

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

  return (
    <RibbonVisibilityGroup group={groupVisibility.groupKey}>
      <GroupRenderModeProvider value={renderMode}>
        <div className="relative flex px-[var(--ribbon-group-padding-x)] group/toolbar-group">
          {/* Content area - fixed height from design token */}
          <div className="flex items-center justify-center gap-[var(--ribbon-group-items-gap)] h-[var(--ribbon-content-height)]">
            {children}
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
