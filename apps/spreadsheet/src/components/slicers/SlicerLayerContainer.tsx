/**
 * Slicer Layer Container
 *
 * Container component that handles scroll synchronization for the SlicerLayer.
 * Uses imperative CSS transform updates for 60fps GPU-accelerated scrolling.
 *
 * Architecture:
 * - Container handles scroll via CSS transform (no React re-render)
 * - SlicerLayer positions slicers in document space
 * - Scroll transform applied imperatively via useEffect subscription
 *
 * This follows the same pattern as PivotLayerContainer - position in document
 * space and apply a single transform for scroll, rather than recalculating
 * positions on every scroll frame.
 *
 * @module components/SlicerLayerContainer
 */

import { useCallback, useEffect, useRef } from 'react';

import type { CellValue } from '@mog-sdk/contracts/core';

import { useActiveSheetId } from '../../internal-api';
import { useCoordinator, useRendererActions, useRendererStatus } from '../../hooks';
import { type SlicerPositionRect, useSlicers } from '../../hooks/data/use-slicers';

import { SlicerLayer } from './SlicerLayer';

// =============================================================================
// Component
// =============================================================================

/**
 * Container for SlicerLayer that handles scroll synchronization.
 *
 * SCROLL ARCHITECTURE:
 * - Slicers are positioned in DOCUMENT SPACE (absolute positions, no scroll offset)
 * - This container applies a CSS transform to shift all slicers by the scroll offset
 * - Transform is updated imperatively via InputCoordinator.onScrollChange()
 * - NO React re-render on scroll = 60fps GPU-accelerated performance
 */
export function SlicerLayerContainer() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { isReady } = useRendererStatus();
  const { getViewport } = useRendererActions();
  const coordinator = useCoordinator();
  const activeSheetId = useActiveSheetId();

  // Get slicer data and actions
  const {
    slicers,
    selectedSlicerId,
    selectSlicer,
    handleItemClick,
    handleItemToggle,
    clearSelection,
    updateSlicerPosition,
    deleteSlicer,
  } = useSlicers({ sheetId: activeSheetId });

  // Get coordinate system from renderer actions
  const viewport = getViewport();

  // ═══════════════════════════════════════════════════════════════════════════
  // CALLBACK HANDLERS - Must be defined before any early returns (Rules of Hooks)
  // ═══════════════════════════════════════════════════════════════════════════

  // Handle slicer selection
  const handleSlicerSelect = useCallback(
    (slicerId: string | null) => {
      selectSlicer(slicerId);
    },
    [selectSlicer],
  );

  // Handle item click (exclusive selection)
  const handleOnItemClick = useCallback(
    (slicerId: string, value: CellValue) => {
      handleItemClick(slicerId, value);
    },
    [handleItemClick],
  );

  // Handle item toggle (multi-select)
  const handleOnItemToggle = useCallback(
    (slicerId: string, value: CellValue) => {
      handleItemToggle(slicerId, value);
    },
    [handleItemToggle],
  );

  // Handle clear all selection
  const handleClearAll = useCallback(
    (slicerId: string) => {
      clearSelection(slicerId);
    },
    [clearSelection],
  );

  // Handle position change (drag/resize)
  const handlePositionChange = useCallback(
    (slicerId: string, position: Partial<SlicerPositionRect>) => {
      updateSlicerPosition(slicerId, position);
    },
    [updateSlicerPosition],
  );

  // Handle delete
  const handleDelete = useCallback(
    (slicerId: string) => {
      deleteSlicer(slicerId);
    },
    [deleteSlicer],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // SCROLL TRANSFORM - The key pattern for 60fps DOM overlay scrolling
  //
  // This effect subscribes to scroll changes and updates the container's
  // CSS transform imperatively. This avoids React re-renders on scroll,
  // which would cause jank and break 60fps performance.
  //
  // The pattern matches how the canvas renderer handles scroll - position
  // content in document space and apply a transform for the scroll offset.
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!viewport || !isReady) return;

    const syncScroll = () => {
      const pos = viewport.getScrollPosition();
      if (overlayRef.current) {
        // GPU-accelerated transform - same as canvas scroll pattern
        overlayRef.current.style.transform = `translate3d(${-pos.x}px, ${-pos.y}px, 0)`;
      }
    };

    // Initial position sync
    syncScroll();

    // Subscribe to scroll changes from InputCoordinator
    const inputCoordinator = coordinator.input.inputCoordinator;
    const unsubscribe = inputCoordinator.onScrollChange(syncScroll);

    return unsubscribe;
  }, [viewport, coordinator, isReady]);

  // ═══════════════════════════════════════════════════════════════════════════
  // EARLY RETURNS - After all hooks have been called
  // ═══════════════════════════════════════════════════════════════════════════

  // Don't render until renderer is ready with coordinate system
  if (!isReady || !viewport) {
    return null;
  }

  // Don't render if no slicers (optimization)
  if (slicers.length === 0) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 overflow-hidden pointer-events-none"
      style={{ willChange: 'transform' }}
      data-testid="slicer-layer-scroll-container"
    >
      <SlicerLayer
        slicers={slicers}
        selectedSlicerId={selectedSlicerId}
        onSlicerSelect={handleSlicerSelect}
        onItemClick={handleOnItemClick}
        onItemToggle={handleOnItemToggle}
        onClearAll={handleClearAll}
        onPositionChange={handlePositionChange}
        onDelete={handleDelete}
      />
    </div>
  );
}
