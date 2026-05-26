/**
 * AutoFillOptionsButton Component
 *
 * Floating button that appears after fill operations with options to change
 * the fill type (Copy Cells, Fill Series, Fill Formatting Only, etc.).
 *
 * Excel Parity AutoFill Options Button
 *
 * ARCHITECTURE:
 * - Renders as floating button at bottom-right corner of fill target range
 * - Uses dispatch() for all actions (not direct UIStore calls)
 * - Auto-hides when user starts editing, navigates, or presses Escape
 * - Uses Radix Popover for click-outside and ESC handling
 */

import { useCallback, useEffect, useState } from 'react';

import type { ActionType } from '@mog-sdk/contracts/actions';
import { dispatch } from '../../actions';
import { useCoordinator } from '../../hooks/shared/use-coordinator';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useActiveSheetId, useUIStore } from '../../infra/context';
import type { AutoFillOptionType } from '../../ui-store/slices/editing/autofill-options';
import { Popover, PopoverContent, PopoverTrigger } from '@mog/shell/components/ui';

// =============================================================================
// Types
// =============================================================================

interface AutoFillOptionItem {
  key: AutoFillOptionType;
  label: string;
  icon?: string;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Available autofill options in the dropdown.
 * Matches Excel's AutoFill Options menu.
 */
const AUTOFILL_OPTIONS: AutoFillOptionItem[] = [
  { key: 'copy', label: 'Copy Cells', icon: 'copy' },
  { key: 'series', label: 'Fill Series', icon: 'series' },
  { key: 'formatting', label: 'Fill Formatting Only', icon: 'format' },
  { key: 'values', label: 'Fill Without Formatting', icon: 'values' },
];

// =============================================================================
// Component
// =============================================================================

export function AutoFillOptionsButton() {
  const deps = useActionDependencies();
  const activeSheetId = useActiveSheetId();
  const coordinator = useCoordinator();

  // Get autofill options state from UIStore
  const autofillOptions = useUIStore((s) => s.autofillOptions);
  const hideAutofillOptionsButton = useUIStore((s) => s.hideAutofillOptionsButton);

  // Dropdown state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Calculate pixel position from cell coordinates
  const [pixelPosition, setPixelPosition] = useState<{ x: number; y: number } | null>(null);

  // Update pixel position when position changes
  useEffect(() => {
    if (!autofillOptions.isVisible || !autofillOptions.position) {
      setPixelPosition(null);
      return;
    }

    // Use geometry capability for page-coord positioning that works with `position: fixed`.
    const geometry = coordinator.renderer.getGeometry();
    if (!geometry) {
      setPixelPosition(null);
      return;
    }

    const cellRect = geometry.getCellPageRect({
      row: autofillOptions.position.row,
      col: autofillOptions.position.col,
    });
    if (!cellRect) {
      setPixelPosition(null); // Cell not visible
      return;
    }

    // Position at bottom-right corner of the cell
    const x = cellRect.x + cellRect.width + 2; // 2px gap from cell edge
    const y = cellRect.y + cellRect.height + 2; // 2px gap from cell edge

    setPixelPosition({ x, y });
  }, [autofillOptions.isVisible, autofillOptions.position, coordinator, activeSheetId]);

  // Hide when sheet changes
  useEffect(() => {
    if (autofillOptions.isVisible && autofillOptions.lastFillInfo?.sheetId !== activeSheetId) {
      hideAutofillOptionsButton();
      setIsDropdownOpen(false);
    }
  }, [
    activeSheetId,
    autofillOptions.isVisible,
    autofillOptions.lastFillInfo?.sheetId,
    hideAutofillOptionsButton,
  ]);

  // Handle autofill option selection
  const handleOptionClick = useCallback(
    (option: AutoFillOptionType) => {
      // Dispatch APPLY_AUTOFILL_OPTION action
      dispatch('APPLY_AUTOFILL_OPTION' as ActionType, deps, { option });
      setIsDropdownOpen(false);
      // Note: Handler will hide the button after applying
    },
    [deps],
  );

  // Handle ESC on the popover: also hide the entire button
  const handleEscapeKeyDown = useCallback(() => {
    hideAutofillOptionsButton();
  }, [hideAutofillOptionsButton]);

  // Prevent Radix from stealing focus from the grid
  const handleOpenAutoFocus = useCallback((e: Event) => {
    e.preventDefault();
  }, []);

  // Don't render if not visible or no position
  if (!autofillOptions.isVisible || !pixelPosition) {
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
      <Popover open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        {/* Main button - small square with dropdown arrow */}
        <PopoverTrigger asChild>
          <button
            className="flex items-center justify-center w-5 h-5 bg-ss-surface border border-ss-border rounded-ss shadow-ss-sm hover:bg-ss-surface-hover focus:outline-none focus:ring-1 focus:ring-ss-border-focus"
            title="Auto Fill Options"
            aria-label="Auto Fill Options"
            aria-haspopup="menu"
          >
            <svg
              className={`w-3 h-3 text-ss-text-secondary transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
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
          side="bottom"
          align="start"
          sideOffset={4}
          className="w-48"
          role="menu"
          aria-label="Auto Fill Options"
          onEscapeKeyDown={handleEscapeKeyDown}
          onOpenAutoFocus={handleOpenAutoFocus}
        >
          <div className="py-1">
            {AUTOFILL_OPTIONS.map((option) => (
              <button
                key={option.key}
                onClick={() => handleOptionClick(option.key)}
                className="flex items-center w-full px-3 py-2 text-body-sm text-left text-ss-text hover:bg-ss-surface-hover focus:bg-ss-surface-hover focus:outline-none"
                role="menuitem"
              >
                {/* Icon placeholder - can be replaced with actual icons */}
                <span className="w-4 h-4 mr-2 flex items-center justify-center text-ss-text-disabled">
                  {option.key === 'copy' && (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M8 2a2 2 0 00-2 2v10a2 2 0 002 2h6a2 2 0 002-2V4a2 2 0 00-2-2H8z" />
                      <path d="M4 6a2 2 0 012-2h1v10a3 3 0 003 3h4a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
                    </svg>
                  )}
                  {option.key === 'series' && (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zm0 6a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z" />
                    </svg>
                  )}
                  {option.key === 'formatting' && (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                  {option.key === 'values' && (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm3 1h6v4H7V5zm6 6H7v2h6v-2z" />
                    </svg>
                  )}
                </span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default AutoFillOptionsButton;
