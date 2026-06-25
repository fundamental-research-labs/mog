/**
 * ZoomSlider Component
 *
 * Provides zoom controls for the status bar including:
 * - Zoom out button (-)
 * - Slider for continuous zoom adjustment
 * - Zoom percentage display (with custom input and presets dropdown)
 * - Zoom in button (+)
 *
 * Excel Parity Quickwin G5: Zoom Slider
 *
 * Custom Zoom Input:
 * - Click percentage to enter custom zoom value
 * - Validates range (10% - 400%)
 *
 * ARCHITECTURE:
 * - Uses dispatch() for all zoom actions
 * - Reads zoom state from UIStore
 * - Zoom levels are per-sheet (stored in zoomLevels map)
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ActionType } from '@mog-sdk/contracts/actions';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_PRESETS } from '@mog-sdk/contracts/rendering';
import { dispatch } from '../../actions';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useActiveSheetId, useUIStore } from '../../infra/context';
import { formatZoomPercent, getZoomLevel } from '../../infra/utils';
// =============================================================================
// Component
// =============================================================================

export interface ZoomSliderProps {
  className?: string;
}

export function ZoomSlider({ className = '' }: ZoomSliderProps) {
  const deps = useActionDependencies();
  const activeSheetId = useActiveSheetId();
  const zoomLevels = useUIStore((s) => s.zoomLevels);

  // Custom zoom input state
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Hover state for dropdown (state-based instead of CSS-only to handle gap traversal)
  const [isDropdownHovered, setIsDropdownHovered] = useState(false);
  const hoverTimeoutRef = useRef<number | null>(null);

  // Get current zoom level for active sheet
  const currentZoom = getZoomLevel(zoomLevels, activeSheetId);

  // Handle zoom in
  const handleZoomIn = useCallback(() => {
    dispatch('ZOOM_IN' as ActionType, deps);
  }, [deps]);

  // Handle zoom out
  const handleZoomOut = useCallback(() => {
    dispatch('ZOOM_OUT' as ActionType, deps);
  }, [deps]);

  // Handle slider change
  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const level = parseInt(e.target.value, 10) / 100;
      dispatch('SET_ZOOM' as ActionType, deps, {
        sheetId: activeSheetId,
        level,
      });
    },
    [deps, activeSheetId],
  );

  // Handle preset selection from dropdown
  const handlePresetClick = useCallback(
    (preset: number) => {
      dispatch('SET_ZOOM' as ActionType, deps, {
        sheetId: activeSheetId,
        level: preset,
      });
    },
    [deps, activeSheetId],
  );

  // Custom zoom input handlers
  const handlePercentageClick = useCallback(() => {
    setInputValue(Math.round(currentZoom * 100).toString());
    setIsEditing(true);
    // Focus the input after state update
    setTimeout(() => inputRef.current?.select(), 0);
  }, [currentZoom]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Only allow digits
    const value = e.target.value.replace(/[^0-9]/g, '');
    setInputValue(value);
  }, []);

  const applyCustomZoom = useCallback(() => {
    const percent = parseInt(inputValue, 10);
    if (!isNaN(percent)) {
      // Clamp to valid range
      const clampedPercent = Math.max(MIN_ZOOM * 100, Math.min(MAX_ZOOM * 100, percent));
      const level = clampedPercent / 100;
      dispatch('SET_ZOOM' as ActionType, deps, {
        sheetId: activeSheetId,
        level,
      });
    }
    setIsEditing(false);
  }, [inputValue, deps, activeSheetId]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        applyCustomZoom();
      } else if (e.key === 'Escape') {
        setIsEditing(false);
      }
    },
    [applyCustomZoom],
  );

  const handleInputBlur = useCallback(() => {
    applyCustomZoom();
  }, [applyCustomZoom]);

  // Hover handlers with debounce to allow mouse to traverse the gap
  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsDropdownHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    // Small delay before hiding to allow mouse to traverse gap
    hoverTimeoutRef.current = window.setTimeout(() => {
      setIsDropdownHovered(false);
    }, 100);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        window.clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {/* Zoom Out Button */}
      <button
        onClick={handleZoomOut}
        disabled={currentZoom <= MIN_ZOOM}
        className="p-1 text-ss-text-secondary hover:text-text hover:bg-ss-surface-tertiary rounded disabled:opacity-50 disabled:cursor-not-allowed"
        title="Zoom Out"
        aria-label="Zoom out"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
        </svg>
      </button>

      {/* Zoom Slider */}
      <input
        type="range"
        min={MIN_ZOOM * 100}
        max={MAX_ZOOM * 100}
        value={currentZoom * 100}
        onChange={handleSliderChange}
        className="mog-zoom-slider w-20 h-1 bg-ss-surface-hover rounded-ss-lg appearance-none cursor-pointer"
        title={`Zoom: ${formatZoomPercent(currentZoom)}`}
        aria-label="Zoom level"
      />

      {/* Zoom Percentage Display / Custom Input */}
      <div className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        {isEditing ? (
          // Custom zoom input
          <div className="flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onBlur={handleInputBlur}
              className="w-10 px-1 text-caption text-center border border-ss-border-focus rounded focus:outline-none focus:ring-1 focus:ring-ss-primary"
              maxLength={3}
              aria-label="Custom zoom percentage"
            />
            <span className="text-caption text-ss-text-secondary ml-0.5">%</span>
          </div>
        ) : (
          // Display button with hover dropdown
          <button
            onClick={handlePercentageClick}
            className="min-w-[40px] px-1 text-caption text-ss-text-secondary hover:text-text hover:bg-ss-surface-tertiary rounded cursor-text"
            title="Click to edit"
            aria-label={`Click to edit zoom (${formatZoomPercent(currentZoom)})`}
          >
            {formatZoomPercent(currentZoom)}
          </button>
        )}

        {/* Preset Dropdown (shown on hover, only when not editing) */}
        {!isEditing && isDropdownHovered && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-ss-popover">
            <div className="bg-ss-surface border border-ss-border rounded shadow-ss-lg py-1 min-w-[80px]">
              {ZOOM_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => handlePresetClick(preset)}
                  className={`block w-full px-3 py-1 text-caption text-left hover:bg-ss-surface-hover ${
                    Math.abs(currentZoom - preset) < 0.01
                      ? 'font-bold text-ss-primary'
                      : 'text-ss-text-secondary'
                  }`}
                >
                  {formatZoomPercent(preset)}
                </button>
              ))}
              {/* Separator and hint for custom input */}
              <div className="border-t border-ss-border mt-1 pt-1">
                <div className="px-3 py-1 text-caption text-ss-text-tertiary italic">
                  Click to edit
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Zoom In Button */}
      <button
        onClick={handleZoomIn}
        disabled={currentZoom >= MAX_ZOOM}
        className="p-1 text-ss-text-secondary hover:text-text hover:bg-ss-surface-tertiary rounded disabled:opacity-50 disabled:cursor-not-allowed"
        title="Zoom In"
        aria-label="Zoom in"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  );
}
