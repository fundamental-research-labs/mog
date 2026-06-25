/**
 * CollapsedGroupDropdown
 *
 * Renders a collapsed group as a single button with dropdown.
 * Used when GroupRenderMode is 'dropdown'.
 *
 * ARCHITECTURE:
 * - ToolbarGroup renders this when collapse config indicates 'dropdown' mode
 * - Children are rendered inside the dropdown panel
 * - Actions still flow through the same hooks → dispatch() → handlers
 *
 * RADIX MIGRATION:
 * - Uses Radix Popover for built-in click-outside and escape key handling
 * - Eliminates manual event listener management
 * - Proper portal-based rendering with correct dismiss behavior
 *
 */

import type { ReactNode } from 'react';
import React, { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@mog/shell';
import { useRibbonCollapseLevel } from '../collapse';

// =============================================================================
// Chevron Icon
// =============================================================================

/**
 * Small chevron icon for dropdown indicator.
 */
function ChevronDownIcon() {
  return (
    <svg
      width="10"
      height="6"
      viewBox="0 0 10 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 1L5 5L9 1" />
    </svg>
  );
}

// =============================================================================
// Types
// =============================================================================

export interface CollapsedGroupDropdownProps {
  /** Group label shown on the collapsed button */
  label: string;
  /** Icon to show on the collapsed button (optional) */
  icon?: ReactNode;
  /** Whether this is the last group (no right separator) */
  isLast?: boolean;
  /** Group content - rendered inside the dropdown panel */
  children: ReactNode;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Renders a collapsed group as a single button with dropdown.
 * Used when GroupRenderMode is 'dropdown'.
 *
 * When a group collapses to dropdown mode:
 * 1. ToolbarGroup renders this component instead of normal layout
 * 2. This renders a button that opens a dropdown panel
 * 3. Children (the same RibbonButton components) are rendered inside the panel
 * 4. Actions still flow through the same hooks → dispatch() → handlers
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 */
export const CollapsedGroupDropdown = React.memo(function CollapsedGroupDropdown({
  label,
  icon,
  isLast = false,
  children,
}: CollapsedGroupDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { level } = useRibbonCollapseLevel();
  const isDense = level >= 3;
  const labelClassName = isDense
    ? 'text-ribbon-compact text-ss-text-secondary leading-none whitespace-nowrap max-w-[58px] overflow-hidden text-ellipsis'
    : 'text-ribbon text-ss-text-secondary whitespace-nowrap max-w-[68px] overflow-hidden text-ellipsis';

  return (
    <div
      className={`relative flex flex-col ${isDense ? 'px-1' : 'px-[var(--ribbon-group-padding-x)]'}`}
    >
      {/* Collapsed button with Radix Popover */}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center justify-center h-[var(--ribbon-content-height)]">
          <Tooltip title={label}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={`flex flex-col items-center justify-center rounded hover:bg-ss-surface-hover transition-colors duration-ss-fast ${
                  isDense ? 'gap-0.5 px-1 py-1 min-w-[42px]' : 'gap-1 px-2 py-1'
                }`}
                aria-expanded={isOpen}
                aria-haspopup="true"
                aria-label={`${label} group`}
              >
                {/* Icon */}
                {icon && (
                  <span
                    className={`flex items-center justify-center text-ss-text-secondary ${
                      isDense ? 'w-5 h-5' : 'w-6 h-6'
                    }`}
                  >
                    {icon}
                  </span>
                )}
                {/* Label + Chevron row */}
                <span className={`flex items-center ${isDense ? 'gap-0.5' : 'gap-1'}`}>
                  <span className={labelClassName}>{label}</span>
                  <ChevronDownIcon />
                </span>
              </button>
            </PopoverTrigger>
          </Tooltip>
        </div>

        {/* Dropdown panel - rendered via portal by Radix */}
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={4}
          className="p-3 min-w-max"
          role="menu"
          aria-label={`${label} group menu`}
        >
          {/* Panel header */}
          <div className="text-caption font-medium text-ss-text-tertiary uppercase tracking-wide mb-2 px-1">
            {label}
          </div>
          {/* Group content rendered in a flex layout */}
          <div className="flex flex-wrap items-start gap-2">{children}</div>
        </PopoverContent>
      </Popover>

      {/* Separator - matches ToolbarGroup */}
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
  );
});
