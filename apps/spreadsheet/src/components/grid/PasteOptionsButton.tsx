/**
 * PasteOptionsButton Component
 *
 * Floating button that appears after paste operations with quick access
 * to paste options (Values Only, Formulas, Formatting, etc.).
 *
 * Excel Parity Quickwin G3: Paste Options Button
 *
 * ARCHITECTURE:
 * - Renders as floating button below the paste range
 * - Uses dispatch() for all actions (not direct UIStore calls)
 * - Auto-hides when user starts editing, navigates, or presses Escape
 * - Uses Radix Popover for click-outside and ESC handling
 */

import { useCallback, useEffect, useState } from 'react';

import type { ActionType } from '@mog-sdk/contracts/actions';
import { dispatch } from '../../actions';
import { PasteDefaultsDialog } from '../paste/PasteDefaultsDialog';
import { ENABLE_PASTE_DEFAULTS_V1 } from '../../domain/clipboard/paste-defaults';
import { useCoordinator } from '../../hooks/shared/use-coordinator';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useActiveSheetId, useUIStore } from '../../infra/context';
import {
  usePasteDefaultsPreference,
  writePasteDefaultsPreference,
  type PasteDefaultTypeV1,
} from '../../infra/state/paste-defaults-store';
import type { PasteOption } from '../../ui-store/slices/clipboard/paste-options';
import { Popover, PopoverContent, PopoverTrigger } from '@mog/shell/components/ui';

// =============================================================================
// Types
// =============================================================================

interface PasteOptionItem {
  key: PasteOption;
  label: string;
  shortcut?: string;
  icon: string;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Available paste options in the dropdown
 */
const PASTE_OPTIONS: PasteOptionItem[] = [
  { key: 'all', label: 'Paste', shortcut: 'Ctrl+V', icon: 'clipboard' },
  { key: 'valuesOnly', label: 'Values', shortcut: 'V', icon: '123' },
  { key: 'formulas', label: 'Formulas', shortcut: 'F', icon: 'fx' },
  { key: 'formatting', label: 'Formatting', shortcut: 'R', icon: 'paintbrush' },
  { key: 'keepSourceFormatting', label: 'Keep Source Formatting', icon: 'format-source' },
  { key: 'matchDestination', label: 'Match Destination Formatting', icon: 'format-dest' },
  { key: 'transpose', label: 'Transpose', shortcut: 'T', icon: 'transpose' },
  { key: 'valuesAndFormatting', label: 'Values & Number Formatting', icon: '123-format' },
  { key: 'pasteLink', label: 'Paste Link', shortcut: 'L', icon: 'link' },
  { key: 'columnWidths', label: 'Keep Source Column Widths', shortcut: 'W', icon: 'column-width' },
];

const DEFAULTABLE_OPTIONS: Partial<Record<PasteOption, PasteDefaultTypeV1>> = {
  all: 'all',
  valuesOnly: 'values',
  formulas: 'formulas',
  formatting: 'formats',
};

// =============================================================================
// Component
// =============================================================================

export function PasteOptionsButton() {
  const deps = useActionDependencies();
  const activeSheetId = useActiveSheetId();
  const coordinator = useCoordinator();

  // Get paste options state from UIStore
  const pasteOptions = useUIStore((s) => s.pasteOptions);
  const hidePasteOptionsButton = useUIStore((s) => s.hidePasteOptionsButton);
  const closePasteOptionsMenu = useUIStore((s) => s.closePasteOptionsMenu);
  const pasteDefaultsPreference = usePasteDefaultsPreference();

  // Dropdown state - syncs with UIStore's isMenuOpen for Ctrl keyup feature
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isDefaultsDialogOpen, setIsDefaultsDialogOpen] = useState(false);

  // Sync local dropdown state with UIStore's isMenuOpen (for Ctrl keyup to open menu)
  useEffect(() => {
    if (pasteOptions.isMenuOpen && !isDropdownOpen) {
      setIsDropdownOpen(true);
    }
  }, [pasteOptions.isMenuOpen, isDropdownOpen]);

  // Close UIStore menu state when local dropdown closes
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsDropdownOpen(open);
      if (!open) {
        closePasteOptionsMenu();
      }
    },
    [closePasteOptionsMenu],
  );

  // Calculate pixel position from cell coordinates
  const [pixelPosition, setPixelPosition] = useState<{ x: number; y: number } | null>(null);

  // Update pixel position when position changes
  useEffect(() => {
    if (!pasteOptions.isVisible || !pasteOptions.position) {
      setPixelPosition(null);
      return;
    }

    // Use geometry capability for page-coord positioning.
    const geometry = coordinator.renderer.getGeometry();
    if (!geometry) {
      // Fallback: geometry not yet available
      setPixelPosition(null);
      return;
    }

    const cellRect = geometry.getCellPageRect({
      row: pasteOptions.position.row,
      col: pasteOptions.position.col,
    });
    if (!cellRect) {
      setPixelPosition(null); // Cell not visible
      return;
    }

    // Position below the cell
    const x = cellRect.x;
    const y = cellRect.y + cellRect.height + 4; // 4px gap

    setPixelPosition({ x, y });
  }, [pasteOptions.isVisible, pasteOptions.position, coordinator, activeSheetId]);

  // Hide when sheet changes
  useEffect(() => {
    if (pasteOptions.isVisible && pasteOptions.sheetId !== activeSheetId) {
      hidePasteOptionsButton();
      setIsDropdownOpen(false);
      closePasteOptionsMenu();
    }
  }, [
    activeSheetId,
    pasteOptions.isVisible,
    pasteOptions.sheetId,
    hidePasteOptionsButton,
    closePasteOptionsMenu,
  ]);

  // Handle paste option selection
  const handleOptionClick = useCallback(
    (option: PasteOption) => {
      // Dispatch PASTE_WITH_OPTIONS action
      dispatch('PASTE_WITH_OPTIONS' as ActionType, deps, { option });
      setIsDropdownOpen(false);
      closePasteOptionsMenu();
      hidePasteOptionsButton();
    },
    [deps, hidePasteOptionsButton, closePasteOptionsMenu],
  );

  const handleSetDefault = useCallback(
    (option: PasteOption) => {
      const defaultPasteType = DEFAULTABLE_OPTIONS[option];
      if (!defaultPasteType) return;
      writePasteDefaultsPreference({
        ...pasteDefaultsPreference,
        defaultPasteType,
      });
      setIsDropdownOpen(false);
      closePasteOptionsMenu();
    },
    [pasteDefaultsPreference, closePasteOptionsMenu],
  );

  // Handle ESC on the popover: also hide the entire button
  const handleEscapeKeyDown = useCallback(() => {
    hidePasteOptionsButton();
  }, [hidePasteOptionsButton]);

  // Prevent Radix from stealing focus from the grid
  const handleOpenAutoFocus = useCallback((e: Event) => {
    e.preventDefault();
  }, []);

  // Don't render if not visible or no position
  if (!pasteOptions.isVisible || !pixelPosition) {
    return null;
  }

  return (
    <div
      className="fixed z-ss-popover"
      style={{
        left: pixelPosition.x,
        top: pixelPosition.y,
      }}
    >
      <Popover open={isDropdownOpen} onOpenChange={handleOpenChange}>
        {/* Main button */}
        <PopoverTrigger asChild>
          <button
            data-testid="paste-options-button"
            className="flex items-center gap-1 px-2 py-1 text-caption bg-ss-surface border border-ss-border rounded shadow-ss-sm hover:bg-ss-surface-hover focus:outline-none focus:ring-2 focus:ring-ss-primary"
            title="Paste Options (Ctrl)"
          >
            <span className="text-ss-text-secondary">Paste Options</span>
            <svg
              className={`w-3 h-3 text-ss-text-disabled transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </PopoverTrigger>

        {/* Dropdown menu */}
        <PopoverContent
          data-testid="paste-options-menu"
          side="bottom"
          align="start"
          sideOffset={4}
          className="w-56"
          role="menu"
          onEscapeKeyDown={handleEscapeKeyDown}
          onOpenAutoFocus={handleOpenAutoFocus}
        >
          <div className="py-1">
            {ENABLE_PASTE_DEFAULTS_V1 && (
              <button
                type="button"
                data-testid="paste-options-defaults-trigger"
                onClick={() => setIsDefaultsDialogOpen(true)}
                className="flex items-center justify-between w-full px-3 py-2 text-dropdown text-left text-ss-text-secondary hover:bg-ss-surface-hover"
              >
                Set Default Paste...
              </button>
            )}
            {PASTE_OPTIONS.map((option) => (
              <div
                key={option.key}
                className="flex items-center justify-between w-full px-3 py-2 text-dropdown text-left text-ss-text-secondary hover:bg-ss-surface-hover"
              >
                <button
                  type="button"
                  onClick={() => handleOptionClick(option.key)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span>{option.label}</span>
                </button>
                <span className="ml-auto flex items-center gap-2">
                  {ENABLE_PASTE_DEFAULTS_V1 &&
                    (DEFAULTABLE_OPTIONS[option.key] ? (
                      <button
                        type="button"
                        data-testid="paste-options-set-default"
                        className="rounded border border-ss-border px-1.5 py-0.5 text-caption text-ss-text-secondary hover:bg-ss-surface"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleSetDefault(option.key);
                        }}
                      >
                        Always use this
                      </button>
                    ) : (
                      <span
                        data-testid="paste-options-set-default-disabled"
                        aria-disabled="true"
                        title="This paste type cannot be saved as a default in V1."
                        className="rounded border border-ss-border px-1.5 py-0.5 text-caption text-ss-text-disabled"
                      >
                        Always use this
                      </span>
                    ))}
                  {option.shortcut && (
                    <span className="text-caption text-ss-text-disabled">{option.shortcut}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <PasteDefaultsDialog
        open={isDefaultsDialogOpen}
        preference={pasteDefaultsPreference}
        onClose={() => setIsDefaultsDialogOpen(false)}
      />
    </div>
  );
}
