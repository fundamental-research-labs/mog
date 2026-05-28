/**
 * SplitDividersLayer Component
 *
 * Renders draggable split dividers when split view is active.
 * Dividers are positioned based on the ViewportLayout.dividers array.
 *
 * Architecture:
 * - Uses sheet split state as the active/inactive guard
 * - Reads divider positions from SheetView's computed ViewportLayout
 * - Dispatches SET_SPLIT_POSITION on drag end
 *
 */

import type { ViewportDivider } from '@mog-sdk/contracts/viewport';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dispatch } from '../../../actions';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';
import { useRendererStatus } from '../../../hooks/view/use-renderer-status';
import { useSplitConfig } from '../../../hooks/view/use-split-config';
import { useCoordinator } from '../../../hooks/shared/use-coordinator';
import { useActiveSheetId, useWorkbook } from '../../../infra/context';
import { SplitDivider } from './SplitDivider';
// =============================================================================
// Types
// =============================================================================

export interface SplitDividersLayerProps {
  /** Optional container dimensions override (for testing) */
  containerWidth?: number;
  containerHeight?: number;
}

interface PositionDimensionsLike {
  readonly totalRows: number;
  readonly totalCols: number;
  getRowTop(row: number): number;
  getColLeft(col: number): number;
}

function nearestBoundaryIndex(
  total: number,
  getPosition: (index: number) => number,
  position: number,
): number {
  const maxIndex = Math.max(1, total - 1);
  let low = 1;
  let high = maxIndex;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (getPosition(mid) < position) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const upper = low;
  const lower = Math.max(1, upper - 1);
  return Math.abs(getPosition(lower) - position) <= Math.abs(getPosition(upper) - position)
    ? lower
    : upper;
}

function dividerPositionToSplitIndex(
  orientation: 'horizontal' | 'vertical',
  position: number,
  dims: PositionDimensionsLike,
  cellAreaOffset: { x: number; y: number },
  zoom: number,
): number {
  const scale = zoom > 0 ? zoom : 1;

  if (orientation === 'horizontal') {
    const documentY = (position - cellAreaOffset.y) / scale;
    return nearestBoundaryIndex(dims.totalRows, (row) => dims.getRowTop(row), documentY);
  }

  const documentX = (position - cellAreaOffset.x) / scale;
  return nearestBoundaryIndex(dims.totalCols, (col) => dims.getColLeft(col), documentX);
}

// =============================================================================
// Component
// =============================================================================

/**
 * SplitDividersLayer - Renders draggable dividers for split view
 *
 * When split view is active, this component renders divider lines that
 * users can drag to adjust the split position.
 *
 * The dividers are positioned:
 * - Horizontal divider: At the row split boundary (divides top/bottom)
 * - Vertical divider: At the column split boundary (divides left/right)
 */
export const SplitDividersLayer = memo(function SplitDividersLayer({
  containerWidth,
  containerHeight,
}: SplitDividersLayerProps) {
  const activeSheetId = useActiveSheetId();
  const workbook = useWorkbook();
  const coordinator = useCoordinator();
  const deps = useActionDependencies();
  const { dimensions, isReady } = useRendererStatus();
  const { splitConfig } = useSplitConfig(activeSheetId);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const rafRef = useRef<number | null>(null);

  // Use renderer dimensions or provided container dimensions
  const width = containerWidth ?? dimensions.width;
  const height = containerHeight ?? dimensions.height;

  useEffect(() => {
    const scheduleLayoutRead = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setLayoutVersion((version) => version + 1);
      });
    };

    const sheetView = coordinator.renderer.getSheetView();
    const sheetViewEvents = sheetView?.events.subscribe((event) => {
      if (
        event.type === 'visible-range-change' ||
        event.type === 'geometry-change' ||
        event.type === 'scroll-change' ||
        event.type === 'scroll-position-reset' ||
        event.type === 'zoom-change'
      ) {
        scheduleLayoutRead();
      }
    });

    const syncForSheet = (sheetId: string) => {
      if (sheetId === activeSheetId) {
        scheduleLayoutRead();
      }
    };

    const cleanups = [
      workbook.on('split:created', (event) => syncForSheet(event.sheetId)),
      workbook.on('split:position-changed', (event) => syncForSheet(event.sheetId)),
      workbook.on('split:removed', (event) => syncForSheet(event.sheetId)),
      workbook.on('rows:hidden', (event) => syncForSheet(event.sheetId)),
      workbook.on('rows:unhidden', (event) => syncForSheet(event.sheetId)),
      workbook.on('columns:hidden', (event) => syncForSheet(event.sheetId)),
      workbook.on('columns:unhidden', (event) => syncForSheet(event.sheetId)),
      workbook.on('row:height-changed', (event) => syncForSheet(event.sheetId)),
      workbook.on('column:width-changed', (event) => syncForSheet(event.sheetId)),
      workbook.on('view:options-changed', (event) => syncForSheet(event.sheetId)),
    ];

    scheduleLayoutRead();

    return () => {
      sheetViewEvents?.dispose();
      for (const cleanup of cleanups) cleanup();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [activeSheetId, coordinator, workbook, isReady]);

  // Read divider geometry from the same computed layout pushed to the canvas renderer.
  const dividers = useMemo((): ViewportDivider[] => {
    if (!splitConfig) return [];
    return [...(coordinator.renderer.getViewportLayout()?.dividers ?? [])].filter(
      (divider): divider is ViewportDivider => divider.type === 'split',
    );
  }, [coordinator, splitConfig, layoutVersion, width, height]);

  // Handle divider drag end
  const handleDragEnd = useCallback(
    (orientation: 'horizontal' | 'vertical', position: number) => {
      const geometry = coordinator.renderer.getGeometry();
      const dims = geometry?.getPositionDimensions();
      if (!geometry || !dims) return;

      const splitIndex = dividerPositionToSplitIndex(
        orientation,
        position,
        dims,
        geometry.getCellAreaOffset(),
        coordinator.renderer.getZoom(),
      );

      dispatch(
        'SET_SPLIT_POSITION',
        deps,
        orientation === 'horizontal'
          ? { horizontalPosition: splitIndex }
          : { verticalPosition: splitIndex },
      );
    },
    [coordinator, deps],
  );

  // Handle double-click to remove split
  const handleDoubleClick = useCallback(() => {
    dispatch('REMOVE_SPLIT', deps);
  }, [deps]);

  // Don't render anything if no split config
  if (!splitConfig || dividers.length === 0) {
    return null;
  }

  // Container bounds for clamping drag positions
  const horizontalBounds = { min: 100, max: width - 100 };
  const verticalBounds = { min: 100, max: height - 100 };

  return (
    <div
      className="split-dividers-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 4,
      }}
      data-testid="split-dividers-layer"
    >
      {dividers.map((divider, index) => (
        <SplitDivider
          key={`${divider.orientation}-${index}`}
          divider={divider}
          onDragEnd={(pos) => handleDragEnd(divider.orientation, pos)}
          onDoubleClick={handleDoubleClick}
          containerBounds={divider.orientation === 'horizontal' ? verticalBounds : horizontalBounds}
        />
      ))}
    </div>
  );
});
