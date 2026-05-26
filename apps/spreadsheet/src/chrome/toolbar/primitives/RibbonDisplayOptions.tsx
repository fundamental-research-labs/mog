/**
 * RibbonDisplayOptions - Dropdown for command-bar display mode selection.
 *
 * Provides command-bar display options:
 * - Show Tabs and Commands (full mode)
 * - Show Tabs (tabs-only mode)
 * - Auto-hide command bar (auto-hide mode)
 *
 * This component is positioned in the title bar area (right side).
 * Uses dispatch() for all actions per architecture requirements.
 */

import React, { useCallback, useState } from 'react';
import { useStore } from 'zustand';
import { dispatch, useDocumentContext } from '../../../internal-api';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';
import type { RibbonDisplayMode } from '../../../ui-store/slices/ribbon/ribbon';
import { RibbonDropdown, RibbonDropdownDivider, RibbonDropdownItem } from './RibbonDropdown';

// =============================================================================
// Icons
// =============================================================================

/**
 * Icon showing ribbon display options (matches Excel's ribbon display button)
 */
function RibbonDisplayIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-ss-text-secondary"
    >
      {/* Tab bar */}
      <rect x="2" y="2" width="12" height="3" fill="currentColor" opacity="0.6" rx="0.5" />
      {/* Ribbon content area */}
      <rect x="2" y="6" width="12" height="8" stroke="currentColor" strokeWidth="1" rx="0.5" />
      {/* Horizontal lines representing ribbon groups */}
      <line x1="4" y1="8" x2="12" y2="8" stroke="currentColor" strokeWidth="0.75" />
      <line x1="4" y1="10" x2="12" y2="10" stroke="currentColor" strokeWidth="0.75" />
      <line x1="4" y1="12" x2="8" y2="12" stroke="currentColor" strokeWidth="0.75" />
    </svg>
  );
}

// =============================================================================
// Display Mode Options
// =============================================================================

interface DisplayModeOption {
  mode: RibbonDisplayMode;
  label: string;
  description: string;
}

const DISPLAY_MODE_OPTIONS: DisplayModeOption[] = [
  {
    mode: 'full',
    label: 'Show Tabs and Commands',
    description: 'Keep the command bar expanded',
  },
  {
    mode: 'tabs-only',
    label: 'Show Tabs',
    description: 'Show only tabs, click to show commands',
  },
  {
    mode: 'auto-hide',
    label: 'Auto-hide command bar',
    description: 'Hide commands until you hover at top',
  },
];

// =============================================================================
// Component
// =============================================================================

export interface RibbonDisplayOptionsProps {
  /** Additional class names for the container */
  className?: string;
}

/**
 * RibbonDisplayOptions - Dropdown button for ribbon display mode selection.
 *
 * Architecture compliance:
 * - Uses dispatch() for all mode changes (Unified Action System)
 * - Reads state from UIStore via useStore hook
 * - Persists preference in localStorage (handled by slice)
 */
export const RibbonDisplayOptions = React.memo(function RibbonDisplayOptions({
  className = '',
}: RibbonDisplayOptionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const deps = useActionDependencies();
  const { uiStore } = useDocumentContext();

  // Read current display mode from UIStore
  const displayMode = useStore(uiStore, (s) => s.displayMode);

  // Handle mode selection via dispatch
  const handleModeSelect = useCallback(
    (mode: RibbonDisplayMode) => {
      dispatch('SET_RIBBON_DISPLAY_MODE', deps, { mode });
      setIsOpen(false);
    },
    [deps],
  );

  return (
    <div className={`flex items-center ${className}`}>
      <RibbonDropdown
        open={isOpen}
        onOpenChange={setIsOpen}
        position="bottom-right"
        width={280}
        menuLabel="Command bar display options"
        trigger={
          <button
            type="button"
            className="
 flex items-center justify-center
 w-[var(--quick-access-button-size)] h-[var(--quick-access-button-size)] rounded
 bg-transparent hover:bg-ss-surface-hover
 transition-colors duration-ss-fast
 focus:outline-none focus-visible:ring-2 focus-visible:ring-ss-primary
 "
            title="Command bar display options"
            aria-label="Command bar display options"
            aria-haspopup="menu"
            aria-expanded={isOpen}
          >
            <RibbonDisplayIcon />
          </button>
        }
      >
        {/* Header */}
        <div className="px-3 py-2 text-dropdown font-medium text-ss-text-secondary border-b border-ss-border-light">
          Command bar display options
        </div>

        {/* Display mode options */}
        {DISPLAY_MODE_OPTIONS.map((option) => (
          <RibbonDropdownItem
            key={option.mode}
            onClick={() => handleModeSelect(option.mode)}
            isSelected={displayMode === option.mode}
            closeOnClick={false}
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{option.label}</span>
              <span className="text-caption text-ss-text-tertiary">{option.description}</span>
            </div>
          </RibbonDropdownItem>
        ))}

        <RibbonDropdownDivider />

        {/* Keyboard shortcuts info */}
        <div className="px-3 py-2 text-caption text-ss-text-tertiary">
          <div className="flex justify-between">
            <span>Toggle tabs mode:</span>
            <span className="font-medium">Ctrl+F1</span>
          </div>
          <div className="flex justify-between mt-1">
            <span>Collapse/expand ribbon:</span>
            <span className="font-medium">Ctrl+Shift+F1</span>
          </div>
        </div>
      </RibbonDropdown>
    </div>
  );
});
