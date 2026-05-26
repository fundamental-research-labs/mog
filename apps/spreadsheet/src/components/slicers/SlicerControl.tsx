/**
 * Slicer Control Component
 *
 * Slicers Implementation
 *
 * Renders an individual slicer with:
 * - Header with caption and clear button
 * - Scrollable item list with multi-column layout
 * - Interactive item buttons for filtering
 * - Visual states (selected, available, unavailable)
 * - Drag/resize handles when selected
 *
 * Architecture:
 * - Renders as absolute-positioned React element over canvas
 * - Item clicks delegate to parent handlers (single source of truth: filter state)
 * - Style presets map to CSS custom properties
 * - Keyboard navigation for accessibility
 *
 * @module components/slicers/SlicerControl
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';

import type { CellValue } from '@mog-sdk/contracts/core';
import type { SlicerStylePreset } from '@mog-sdk/contracts/slicers';
import type {
  SlicerPositionRect,
  SlicerRenderConfig,
  SlicerRenderItem,
} from '../../adapters/slicers/slicer-render-types';
// =============================================================================
// Types
// =============================================================================

export interface SlicerControlProps {
  /** Slicer configuration */
  config: SlicerRenderConfig;
  /** Computed items with states */
  items: SlicerRenderItem[];
  /** Whether the slicer is connected to its data source */
  isConnected: boolean;
  /** Whether any filter is active */
  hasActiveFilter: boolean;
  /** Whether this slicer is selected (for UI focus) */
  isSelected: boolean;
  /** Handle item click (exclusive selection) */
  onItemClick: (value: CellValue) => void;
  /** Handle item toggle (multi-select with Ctrl/Cmd) */
  onItemToggle: (value: CellValue) => void;
  /** Handle select all except clicked (Alt+click behavior) */
  onSelectAllExcept?: (value: CellValue) => void;
  /** Handle clear all selection */
  onClearAll: () => void;
  /** Handle select all items */
  onSelectAll?: () => void;
  /** Handle slicer selection */
  onSelect: () => void;
  /** Handle position change (drag/resize) */
  onPositionChange?: (position: Partial<SlicerPositionRect>) => void;
  /** Handle delete */
  onDelete?: () => void;
  /** Handle opening slicer connections dialog */
  onOpenConnections?: () => void;
}

// =============================================================================
// Style Presets
// =============================================================================

/**
 * Style preset configurations matching Excel's slicer style gallery.
 */
const STYLE_PRESETS: Record<
  SlicerStylePreset,
  {
    header: { bg: string; text: string };
    selected: { bg: string; text: string };
    available: { bg: string; text: string };
    unavailable: { bg: string; text: string };
    border: string;
    borderWidth: number;
  }
> = {
  // Slicer theme presets - intentional hex values for predefined themes
  light1: {
    header: { bg: '#4472c4', text: '#ffffff' },
    selected: { bg: '#4472c4', text: '#ffffff' },
    available: { bg: '#ffffff', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
  },
  light2: {
    header: { bg: '#ed7d31', text: '#ffffff' },
    selected: { bg: '#ed7d31', text: '#ffffff' },
    available: { bg: '#ffffff', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
  },
  light3: {
    header: { bg: '#a5a5a5', text: '#ffffff' },
    selected: { bg: '#a5a5a5', text: '#ffffff' },
    available: { bg: '#ffffff', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
  },
  light4: {
    header: { bg: '#ffc000', text: '#1e293b' },
    selected: { bg: '#ffc000', text: '#1e293b' },
    available: { bg: '#ffffff', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
  },
  light5: {
    header: { bg: '#5b9bd5', text: '#ffffff' },
    selected: { bg: '#5b9bd5', text: '#ffffff' },
    available: { bg: '#ffffff', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
  },
  light6: {
    header: { bg: '#70ad47', text: '#ffffff' },
    selected: { bg: '#70ad47', text: '#ffffff' },
    available: { bg: '#ffffff', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
  },
  dark1: {
    header: { bg: '#1e3a5f', text: '#ffffff' },
    selected: { bg: '#4472c4', text: '#ffffff' },
    available: { bg: '#1e293b', text: '#e2e8f0' },
    unavailable: { bg: '#374151', text: '#6b7280' },
    border: '#475569',
    borderWidth: 1,
  },
  dark2: {
    header: { bg: '#7c2d12', text: '#ffffff' },
    selected: { bg: '#ed7d31', text: '#ffffff' },
    available: { bg: '#1e293b', text: '#e2e8f0' },
    unavailable: { bg: '#374151', text: '#6b7280' },
    border: '#475569',
    borderWidth: 1,
  },
  dark3: {
    header: { bg: '#374151', text: '#ffffff' },
    selected: { bg: '#6b7280', text: '#ffffff' },
    available: { bg: '#1e293b', text: '#e2e8f0' },
    unavailable: { bg: '#374151', text: '#6b7280' },
    border: '#475569',
    borderWidth: 1,
  },
  dark4: {
    header: { bg: '#854d0e', text: '#ffffff' },
    selected: { bg: '#ffc000', text: '#1e293b' },
    available: { bg: '#1e293b', text: '#e2e8f0' },
    unavailable: { bg: '#374151', text: '#6b7280' },
    border: '#475569',
    borderWidth: 1,
  },
  dark5: {
    header: { bg: '#1e40af', text: '#ffffff' },
    selected: { bg: '#5b9bd5', text: '#ffffff' },
    available: { bg: '#1e293b', text: '#e2e8f0' },
    unavailable: { bg: '#374151', text: '#6b7280' },
    border: '#475569',
    borderWidth: 1,
  },
  dark6: {
    header: { bg: '#166534', text: '#ffffff' },
    selected: { bg: '#70ad47', text: '#ffffff' },
    available: { bg: '#1e293b', text: '#e2e8f0' },
    unavailable: { bg: '#374151', text: '#6b7280' },
    border: '#475569',
    borderWidth: 1,
  },
  other1: {
    header: { bg: '#7c3aed', text: '#ffffff' },
    selected: { bg: '#7c3aed', text: '#ffffff' },
    available: { bg: '#ffffff', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
  },
  other2: {
    header: { bg: '#db2777', text: '#ffffff' },
    selected: { bg: '#db2777', text: '#ffffff' },
    available: { bg: '#ffffff', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
  },
};

// =============================================================================
// Components
// =============================================================================

/**
 * Individual slicer item button.
 */
interface SlicerItemButtonProps {
  item: SlicerRenderItem;
  style: (typeof STYLE_PRESETS)[SlicerStylePreset];
  buttonHeight: number;
  showSelectionIndicator: boolean;
  onClick: (e: React.MouseEvent) => void;
}

const SlicerItemButton = React.memo(function SlicerItemButton({
  item,
  style,
  buttonHeight,
  showSelectionIndicator,
  onClick,
}: SlicerItemButtonProps) {
  const isSelected = item.state === 'selected';
  const isUnavailable = item.state === 'unavailable' || item.state === 'noData';

  const buttonStyle = isSelected
    ? style.selected
    : isUnavailable
      ? style.unavailable
      : style.available;

  const buttonClasses = [
    'flex items-center gap-2 px-2 text-left transition-colors',
    'border rounded text-body-sm font-medium',
    'hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-1',
    isUnavailable ? 'cursor-not-allowed opacity-60' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      onClick={onClick}
      className={buttonClasses}
      style={{
        height: buttonHeight,
        backgroundColor: buttonStyle.bg,
        color: buttonStyle.text,
        borderColor: style.border,
        borderWidth: style.borderWidth,
      }}
      disabled={isUnavailable}
      title={`${item.displayText}${item.count !== undefined ? ` (${item.count})` : ''}`}
    >
      {showSelectionIndicator && isSelected && (
        <svg className="h-3 w-3 flex-shrink-0" viewBox="0 0 12 12" fill="currentColor">
          <path d="M10.28 2.28L4.5 8.06 1.72 5.28A.75.75 0 00.66 6.34l3.5 3.5a.75.75 0 001.06 0l6.5-6.5a.75.75 0 00-1.06-1.06z" />
        </svg>
      )}
      <span className="truncate flex-1">{item.displayText}</span>
      {item.count !== undefined && (
        <span className="text-caption opacity-70 flex-shrink-0">({item.count})</span>
      )}
    </button>
  );
});

/**
 * Disconnected state overlay.
 */
function DisconnectedOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-ss-surface-secondary z-ss-sticky">
      <div className="text-center p-4">
        <svg
          className="h-8 w-8 mx-auto mb-2 text-ss-warning"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <p className="text-body-sm font-medium text-ss-text-secondary">Slicer Disconnected</p>
        <p className="text-caption text-ss-text-tertiary mt-1">Source column was deleted</p>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function SlicerControl({
  config,
  items,
  isConnected,
  hasActiveFilter,
  isSelected,
  onItemClick,
  onItemToggle,
  onSelectAllExcept,
  onClearAll,
  onSelect,
}: SlicerControlProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  // Multi-select mode toggle (like Excel's multi-select button)
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);

  // Get style configuration
  const styleConfig = useMemo(() => {
    if (config.style.custom) {
      // Custom style - map to preset format
      const custom = config.style.custom;
      return {
        header: {
          bg: custom.headerBackgroundColor ?? '#4472c4',
          text: custom.headerTextColor ?? '#ffffff',
        },
        selected: {
          bg: custom.selectedBackgroundColor ?? '#4472c4',
          text: custom.selectedTextColor ?? '#ffffff',
        },
        available: {
          bg: custom.availableBackgroundColor ?? '#ffffff',
          text: custom.availableTextColor ?? '#1e293b',
        },
        unavailable: {
          bg: custom.unavailableBackgroundColor ?? '#f1f5f9',
          text: custom.unavailableTextColor ?? '#94a3b8',
        },
        border: custom.borderColor ?? '#cbd5e1',
        borderWidth: custom.borderWidth ?? 1,
      };
    }
    return STYLE_PRESETS[config.style.preset ?? 'light1'];
  }, [config.style]);

  // Handle item click with modifier key detection
  const handleItemClick = useCallback(
    (item: SlicerRenderItem, e: React.MouseEvent) => {
      e.stopPropagation();

      if (item.state === 'unavailable' || item.state === 'noData') {
        return;
      }

      // Alt+click for "select all except this"
      if (e.altKey && onSelectAllExcept) {
        onSelectAllExcept(item.value);
        return;
      }

      // Ctrl/Cmd+click or multi-select mode for toggle
      if (e.ctrlKey || e.metaKey || isMultiSelectMode) {
        onItemToggle(item.value);
      } else {
        onItemClick(item.value);
      }
    },
    [onItemClick, onItemToggle, onSelectAllExcept, isMultiSelectMode],
  );

  // Toggle multi-select mode
  const handleMultiSelectToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMultiSelectMode((prev) => !prev);
  }, []);

  // Handle clear button click
  const handleClearClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClearAll();
    },
    [onClearAll],
  );

  // Handle container click (select slicer)
  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      // Only select if clicking on container, not items
      if (e.target === e.currentTarget || (e.target as HTMLElement).closest('[data-slicer-body]')) {
        onSelect();
      }
    },
    [onSelect],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isSelected && hasActiveFilter) {
          e.preventDefault();
          onClearAll();
        }
      }
    },
    [isSelected, hasActiveFilter, onClearAll],
  );

  // Get position from config
  const { position } = config;
  const headerHeight = config.showHeader ? 28 : 0;

  const containerClasses = [
    'absolute flex flex-col overflow-hidden bg-ss-surface rounded shadow-ss-sm',
    'transition-shadow duration-ss',
    isSelected ? 'ring-2 ring-ss-border-focus shadow-ss-md' : '',
    isHovered && !isSelected ? 'shadow-ss-md' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={containerRef}
      className={containerClasses}
      style={{
        left: position.x,
        top: position.y,
        width: position.width,
        height: position.height,
        borderColor: styleConfig.border,
        borderWidth: styleConfig.borderWidth,
        borderStyle: 'solid',
        zIndex: config.zIndex,
      }}
      onClick={handleContainerClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="listbox"
      aria-label={config.caption}
      aria-multiselectable="true"
      data-slicer-id={config.id}
      data-testid={`slicer-${config.id}`}
    >
      {/* Disconnected overlay */}
      {!isConnected && <DisconnectedOverlay />}

      {/* Header */}
      {config.showHeader && (
        <div
          className="flex items-center justify-between px-2 flex-shrink-0"
          style={{
            height: headerHeight,
            backgroundColor: styleConfig.header.bg,
            color: styleConfig.header.text,
          }}
        >
          <span className="text-body-sm font-semibold truncate flex-1">{config.caption}</span>
          <div className="flex items-center gap-1">
            {/* Multi-select mode toggle button */}
            <button
              type="button"
              onClick={handleMultiSelectToggle}
              className={`p-0.5 rounded transition-colors ${
                isMultiSelectMode ? 'bg-ss-surface/30' : 'hover:bg-ss-surface-hover'
              }`}
              title={isMultiSelectMode ? 'Single select mode' : 'Multi-select mode'}
              aria-label={isMultiSelectMode ? 'Single select mode' : 'Multi-select mode'}
              aria-pressed={isMultiSelectMode}
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                {/* Multi-select icon (checkbox stack) */}
                <path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H14zM4.5 0A2 2 0 0 0 2.5 2v8a2 2 0 0 0 2 2H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H4.5z" />
                <path d="M12.5 5.5l-4 4-2-2 .707-.707L8.5 8.086l3.293-3.293.707.707z" />
                <path d="M1.5 4a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5H11a.5.5 0 0 0 .5-.5v-.5h1v.5a1.5 1.5 0 0 1-1.5 1.5H1.5A1.5 1.5 0 0 1 0 12.5v-8A1.5 1.5 0 0 1 1.5 3H2v1h-.5z" />
              </svg>
            </button>
            {/* Clear filter button */}
            {hasActiveFilter && (
              <button
                type="button"
                onClick={handleClearClick}
                className="p-0.5 rounded hover:bg-ss-surface-hover transition-colors"
                title="Clear filter"
                aria-label="Clear filter"
              >
                <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2.5 1a.5.5 0 0 0-.5.5v1.379L7.293 8.172a.5.5 0 0 1 .207.403v4.175l1-.5V8.575a.5.5 0 0 1 .207-.403L14 2.879V1.5a.5.5 0 0 0-.5-.5h-11zM14.5 0a1.5 1.5 0 0 1 1.5 1.5v1.879a1.5 1.5 0 0 1-.44 1.061l-5.06 5.06v3.75a1.5 1.5 0 0 1-.712 1.28l-2 1.2A1.5 1.5 0 0 1 5.5 14.25V9.5L.44 4.44A1.5 1.5 0 0 1 0 3.379V1.5A1.5 1.5 0 0 1 1.5 0h13z" />
                  <path
                    d="M11.354 4.646a.5.5 0 0 1 0 .708L9.707 7l1.647 1.646a.5.5 0 0 1-.708.708L9 7.707 7.354 9.354a.5.5 0 0 1-.708-.708L8.293 7 6.646 5.354a.5.5 0 1 1 .708-.708L9 6.293l1.646-1.647a.5.5 0 0 1 .708 0z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Item list */}
      <div
        className="flex-1 overflow-auto p-1"
        data-slicer-body
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${config.style.columnCount}, 1fr)`,
          gap: 2,
          alignContent: 'start',
        }}
      >
        {items.map((item, index) => (
          <SlicerItemButton
            key={`${item.value}-${index}`}
            item={item}
            style={styleConfig}
            buttonHeight={config.style.buttonHeight}
            showSelectionIndicator={config.style.showSelectionIndicator}
            onClick={(e) => handleItemClick(item, e)}
          />
        ))}
        {items.length === 0 && isConnected && (
          <div className="col-span-full text-center text-body-sm text-ss-text-tertiary py-4">
            No items available
          </div>
        )}
      </div>
    </div>
  );
}

export default SlicerControl;
