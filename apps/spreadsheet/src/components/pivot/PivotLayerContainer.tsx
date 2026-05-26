/**
 * Pivot Layer Container
 *
 * Container component that handles scroll synchronization for the PivotLayer.
 * Uses imperative CSS transform updates for 60fps GPU-accelerated scrolling.
 *
 * Architecture:
 * - Container handles scroll via CSS transform (no React re-render)
 * - PivotLayer positions pivots in document space
 * - Scroll transform applied imperatively via useEffect subscription
 *
 * This follows the same pattern as the canvas renderer - position in document
 * space and apply a single transform for scroll, rather than recalculating
 * positions on every scroll frame.
 *
 * @see PIVOT-CHART-LAYER-NOT-RENDERED.md for architecture decisions
 * @module components/PivotLayerContainer
 */

import { useCallback, useEffect, useRef } from 'react';

import { useActiveSheetId, useUIStore } from '../../internal-api';
import { useCoordinator, useRendererActions, useRendererStatus } from '../../hooks';
import { usePivotTables } from '../../hooks/data/use-pivot-tables';
import { ContextMenu, ContextMenuTrigger } from '@mog/shell/components/ui';

import { PivotContextMenu } from './PivotContextMenu';
import type { PivotContextMenuEvent } from './PivotLayer';
import { PivotLayer } from './PivotLayer';

// =============================================================================
// Component
// =============================================================================

/**
 * Container for PivotLayer that handles scroll synchronization.
 *
 * SCROLL ARCHITECTURE:
 * - Pivots are positioned in DOCUMENT SPACE (absolute positions, no scroll offset)
 * - This container applies a CSS transform to shift all pivots by the scroll offset
 * - Transform is updated imperatively via InputCoordinator.onScrollChange()
 * - NO React re-render on scroll = 60fps GPU-accelerated performance
 */
export function PivotLayerContainer() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { isReady } = useRendererStatus();
  const { getGeometry, getViewport } = useRendererActions();
  const coordinator = useCoordinator();
  const activeSheetId = useActiveSheetId();

  // Get pivot data and actions
  const {
    pivotTables,
    selectedPivotId,
    selectPivot,
    toggleRowExpanded,
    toggleColumnExpanded,
    getDrillDownData,
    startEditingPivot,
  } = usePivotTables({ sheetId: activeSheetId });

  // Context menu state from UIStore
  const contextMenu = useUIStore((s) => s.contextMenu);
  const openContextMenu = useUIStore((s) => s.openContextMenu);
  const closeContextMenu = useUIStore((s) => s.closeContextMenu);

  // Get coordinate system from renderer actions
  const geometry = getGeometry();
  const viewport = getViewport();

  // ═══════════════════════════════════════════════════════════════════════════
  // CALLBACK HANDLERS - Must be defined before any early returns (Rules of Hooks)
  // ═══════════════════════════════════════════════════════════════════════════

  // Handle pivot context menu (right-click)
  const handlePivotContextMenu = useCallback(
    (event: PivotContextMenuEvent) => {
      openContextMenu({
        x: event.x,
        y: event.y,
        target: 'pivot',
        pivotId: event.pivotId,
        pivotHeaderKey: event.headerKey,
        pivotFieldId: event.fieldId,
      });
    },
    [openContextMenu],
  );

  // Handle pivot selection - delegate to hook actions
  const handlePivotSelect = useCallback(
    (pivotId: string | null) => {
      selectPivot(pivotId);
    },
    [selectPivot],
  );

  // Handle expand/collapse toggle
  const handleToggleExpand = useCallback(
    (pivotId: string, headerKey: string, isRow: boolean) => {
      if (isRow) {
        toggleRowExpanded(pivotId, headerKey);
      } else {
        toggleColumnExpanded(pivotId, headerKey);
      }
    },
    [toggleRowExpanded, toggleColumnExpanded],
  );

  // Handle drill-down (log for now, can be extended)
  const handleDrillDown = useCallback(
    (pivotId: string, rowKey: string, columnKey: string) => {
      // Get drill-down data - in future this can open a detail view
      getDrillDownData(pivotId, rowKey, columnKey);
    },
    [getDrillDownData],
  );

  // Handle pivot edit (opens field panel)
  const handlePivotEdit = useCallback(
    (pivotId: string) => {
      startEditingPivot(pivotId);
    },
    [startEditingPivot],
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
  if (!isReady || !geometry) {
    return null;
  }

  // Don't render if no pivot tables (optimization)
  if (pivotTables.length === 0) {
    return null;
  }

  // Check if this is a pivot context menu
  const isPivotContextMenu =
    contextMenu.isOpen &&
    (contextMenu.target === 'pivot' ||
      contextMenu.target === 'pivot-row-header' ||
      contextMenu.target === 'pivot-column-header' ||
      contextMenu.target === 'pivot-value');

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) closeContextMenu();
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          ref={overlayRef}
          className="absolute inset-0 overflow-hidden pointer-events-none"
          style={{ willChange: 'transform' }}
          data-testid="pivot-layer-scroll-container"
          // Stop propagation so the grid's parent ContextMenu doesn't also open
          onContextMenu={(e) => e.stopPropagation()}
        >
          <PivotLayer
            geometry={geometry}
            pivotTables={pivotTables}
            selectedPivotId={selectedPivotId}
            onPivotSelect={handlePivotSelect}
            onToggleExpand={handleToggleExpand}
            onDrillDown={handleDrillDown}
            onPivotEdit={handlePivotEdit}
            onPivotContextMenu={handlePivotContextMenu}
          />
        </div>
      </ContextMenuTrigger>

      {/* Pivot Context Menu — Radix ContextMenu positions from native right-click */}
      {isPivotContextMenu && contextMenu.pivotId && (
        <PivotContextMenu
          target={contextMenu.target}
          pivotId={contextMenu.pivotId}
          headerKey={contextMenu.pivotHeaderKey}
          fieldId={contextMenu.pivotFieldId}
          onClose={closeContextMenu}
        />
      )}
    </ContextMenu>
  );
}
