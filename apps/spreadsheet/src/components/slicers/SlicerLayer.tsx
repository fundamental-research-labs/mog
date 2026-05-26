/**
 * Slicer Layer Component
 *
 * Slicers Implementation
 *
 * Renders all slicers for a sheet over the spreadsheet grid.
 * Slicers are positioned in DOCUMENT SPACE - the container handles scroll via CSS transform.
 *
 * Architecture:
 * - Position in document space using ObjectPosition.x/y coordinates
 * - Container applies scroll transform imperatively (no React re-render on scroll)
 * - 60fps GPU-accelerated scrolling via CSS translate3d
 * - Similar pattern to ChartLayer
 *
 * @module components/slicers/SlicerLayer
 */

import React, { useCallback } from 'react';

import type { CellValue } from '@mog-sdk/contracts/core';
import type { SlicerDefinition, SlicerPositionRect } from '../../hooks/data/use-slicers';
import SlicerControl from './SlicerControl';

// =============================================================================
// Types
// =============================================================================

export interface SlicerLayerProps {
  /** Slicers for the current sheet (with resolved items) */
  slicers: SlicerDefinition[];
  /** Currently selected slicer ID */
  selectedSlicerId: string | null;
  /** Handle slicer selection */
  onSlicerSelect: (slicerId: string | null) => void;
  /** Handle item click (exclusive selection) */
  onItemClick: (slicerId: string, value: CellValue) => void;
  /** Handle item toggle (multi-select) */
  onItemToggle: (slicerId: string, value: CellValue) => void;
  /** Handle clear all selection */
  onClearAll: (slicerId: string) => void;
  /** Handle position change (drag/resize) */
  onPositionChange?: (slicerId: string, position: Partial<SlicerPositionRect>) => void;
  /** Handle delete */
  onDelete?: (slicerId: string) => void;
}

// =============================================================================
// Memoized Slicer Wrapper
// =============================================================================

interface SlicerWrapperProps {
  definition: SlicerDefinition;
  isSelected: boolean;
  onSelect: (slicerId: string) => void;
  onItemClick: (slicerId: string, value: CellValue) => void;
  onItemToggle: (slicerId: string, value: CellValue) => void;
  onClearAll: (slicerId: string) => void;
  onPositionChange?: (slicerId: string, position: Partial<SlicerPositionRect>) => void;
  onDelete?: (slicerId: string) => void;
}

/**
 * Memoized wrapper to prevent re-renders when other slicers change.
 */
const SlicerWrapper = React.memo(
  function SlicerWrapper({
    definition,
    isSelected,
    onSelect,
    onItemClick,
    onItemToggle,
    onClearAll,
    onPositionChange,
    onDelete,
  }: SlicerWrapperProps) {
    const { config, items, isConnected, hasActiveFilter } = definition;

    // Bound handlers for this specific slicer
    const handleSelect = useCallback(() => {
      onSelect(config.id);
    }, [onSelect, config.id]);

    const handleItemClick = useCallback(
      (value: CellValue) => {
        onItemClick(config.id, value);
      },
      [onItemClick, config.id],
    );

    const handleItemToggle = useCallback(
      (value: CellValue) => {
        onItemToggle(config.id, value);
      },
      [onItemToggle, config.id],
    );

    const handleClearAll = useCallback(() => {
      onClearAll(config.id);
    }, [onClearAll, config.id]);

    const handlePositionChange = useCallback(
      (position: Partial<SlicerPositionRect>) => {
        onPositionChange?.(config.id, position);
      },
      [onPositionChange, config.id],
    );

    const handleDelete = useCallback(() => {
      onDelete?.(config.id);
    }, [onDelete, config.id]);

    return (
      <SlicerControl
        config={config}
        items={items}
        isConnected={isConnected}
        hasActiveFilter={hasActiveFilter}
        isSelected={isSelected}
        onItemClick={handleItemClick}
        onItemToggle={handleItemToggle}
        onClearAll={handleClearAll}
        onSelect={handleSelect}
        onPositionChange={handlePositionChange}
        onDelete={handleDelete}
      />
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison: only re-render if slicer definition or selection changed
    return (
      prevProps.definition === nextProps.definition && prevProps.isSelected === nextProps.isSelected
    );
  },
);

// =============================================================================
// Component
// =============================================================================

export function SlicerLayer({
  slicers,
  selectedSlicerId,
  onSlicerSelect,
  onItemClick,
  onItemToggle,
  onClearAll,
  onPositionChange,
  onDelete,
}: SlicerLayerProps) {
  // Handle background click to deselect
  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      // Only deselect if clicking the background, not a slicer
      if (e.target === e.currentTarget) {
        onSlicerSelect(null);
      }
    },
    [onSlicerSelect],
  );

  // Render all slicers positioned in DOCUMENT SPACE
  // The parent container handles scroll via CSS transform
  return (
    <div
      onClick={handleBackgroundClick}
      className="absolute pointer-events-none"
      data-testid="slicer-layer"
      style={{
        // Size to full document extent
        width: '100%',
        height: '100%',
      }}
    >
      {slicers.map((definition) => (
        <div
          key={definition.config.id}
          className="pointer-events-auto"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            // Slicers use absolute positioning from their position config
            // The SlicerControl positions itself absolutely within this container
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          <div style={{ pointerEvents: 'auto' }}>
            <SlicerWrapper
              definition={definition}
              isSelected={selectedSlicerId === definition.config.id}
              onSelect={onSlicerSelect}
              onItemClick={onItemClick}
              onItemToggle={onItemToggle}
              onClearAll={onClearAll}
              onPositionChange={onPositionChange}
              onDelete={onDelete}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default SlicerLayer;
