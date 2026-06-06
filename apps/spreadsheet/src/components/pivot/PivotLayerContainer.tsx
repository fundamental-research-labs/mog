/**
 * Pivot Layer Container
 *
 * Pivot table output is materialized into sheet cells by the compute engine.
 * Imported workbooks and ribbon-created pivots must therefore share the same
 * visible surface: the grid cells themselves. Contextual tools are driven by
 * cell selection over the registered pivot range, not by a floating DOM table.
 */

import { useEffect, useMemo, useState } from 'react';

import type { PivotViewModel } from '../../pivot/pivot-capabilities';
import { pivotBoundsForConfig, type PivotBounds } from '../../pivot/pivot-view-geometry';
import { useActiveSheetId } from '../../internal-api';
import { useRendererActions, useRendererStatus, useCoordinator } from '../../hooks';
import { usePivotTables } from '../../hooks/data/use-pivot-tables';

// =============================================================================
// DOM marker helpers
// =============================================================================

interface PivotMarker {
  id: string;
  name: string;
  bounds: PivotBounds;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

function renderedBoundsForPivot(pivot: PivotViewModel): PivotBounds {
  const renderedBounds = pivot.result?.renderedBounds;
  if (renderedBounds && renderedBounds.totalRows > 0 && renderedBounds.totalCols > 0) {
    const { row, col } = pivot.config.outputLocation;
    return {
      startRow: row,
      startCol: col,
      endRow: row + renderedBounds.totalRows - 1,
      endCol: col + renderedBounds.totalCols - 1,
    };
  }
  return pivotBoundsForConfig(pivot.config);
}

// =============================================================================
// Component
// =============================================================================

/**
 * The component remains mounted from the grid overlay composition point, but it
 * intentionally renders no pivot output. Pivot ranges are registered in the
 * workbook and rendered through the viewport cell buffer.
 *
 * It does render hidden DOM markers for tooling that needs a stable, observable
 * anchor for cell-backed pivots. The markers are non-interactive and invisible,
 * so they do not resurrect the old floating PivotTable surface.
 */
export function PivotLayerContainer() {
  const activeSheetId = useActiveSheetId();
  const { pivotTables } = usePivotTables({ sheetId: activeSheetId });
  const { isReady } = useRendererStatus();
  const { getGeometry, getViewport } = useRendererActions();
  const coordinator = useCoordinator();
  const [scrollTick, setScrollTick] = useState(0);

  useEffect(() => {
    const inputCoordinator = coordinator.input.inputCoordinator;
    return inputCoordinator.onScrollChange(() => {
      setScrollTick((value) => value + 1);
    });
  }, [coordinator]);

  useEffect(() => {
    if (!isReady) return;

    const sheetViewEvents = coordinator.renderer.getSheetView()?.events.subscribe((event) => {
      if (
        event.type === 'geometry-change' ||
        event.type === 'visible-range-change' ||
        event.type === 'scroll-position-reset' ||
        event.type === 'zoom-change'
      ) {
        setScrollTick((value) => value + 1);
      }
    });

    return () => {
      sheetViewEvents?.dispose();
    };
  }, [coordinator, isReady]);

  useEffect(() => {
    if (!isReady || pivotTables.length === 0) return;
    const intervalId = window.setInterval(() => {
      setScrollTick((value) => value + 1);
    }, 100);
    return () => window.clearInterval(intervalId);
  }, [isReady, pivotTables.length]);

  const geometry = getGeometry();
  const markers = useMemo<PivotMarker[]>(() => {
    void scrollTick;
    if (!isReady || !geometry || pivotTables.length === 0) return [];

    const positionDimensions = geometry.getPositionDimensions();
    const viewport = getViewport();
    const scrollPosition = viewport?.getScrollPosition() ?? { x: 0, y: 0 };
    const containerRect = geometry.getContainerRect();
    const cellAreaOffset = geometry.getCellAreaOffset();

    return pivotTables
      .map((pivot): PivotMarker | null => {
        const bounds = renderedBoundsForPivot(pivot);
        const visibleAnchorRect = geometry.getCellPageRect({
          row: bounds.startRow,
          col: bounds.startCol,
        });
        const anchorRect = visibleAnchorRect ?? {
          x:
            containerRect.x +
            cellAreaOffset.x +
            positionDimensions.getColLeft(bounds.startCol) -
            scrollPosition.x,
          y:
            containerRect.y +
            cellAreaOffset.y +
            positionDimensions.getRowTop(bounds.startRow) -
            scrollPosition.y,
        };

        let width = 0;
        for (let col = bounds.startCol; col <= bounds.endCol; col += 1) {
          width += positionDimensions.getColWidth(col);
        }

        let height = 0;
        for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
          height += positionDimensions.getRowHeight(row);
        }

        if (width <= 0 || height <= 0) return null;

        return {
          id: pivot.config.id,
          name: pivot.config.name,
          bounds,
          rect: {
            x: anchorRect.x,
            y: anchorRect.y,
            width,
            height,
          },
        };
      })
      .filter((marker): marker is PivotMarker => marker != null);
  }, [geometry, getViewport, isReady, pivotTables, scrollTick]);

  if (markers.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="pivot-layer-markers"
      aria-hidden="true"
      style={{
        position: 'fixed',
        width: 0,
        height: 0,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {markers.map((marker) => (
        <div
          key={marker.id}
          data-pivot-target="wrapper"
          data-pivot-marker="cell-backed"
          data-pivot-id={marker.id}
          data-pivot-name={marker.name}
          data-testid={`pivot-marker-${marker.id}`}
          data-pivot-anchor-row={marker.bounds.startRow}
          data-pivot-anchor-col={marker.bounds.startCol}
          data-pivot-end-row={marker.bounds.endRow}
          data-pivot-end-col={marker.bounds.endCol}
          style={{
            position: 'fixed',
            left: marker.rect.x,
            top: marker.rect.y,
            width: marker.rect.width,
            height: marker.rect.height,
            visibility: 'hidden',
            pointerEvents: 'none',
          }}
        />
      ))}
    </div>
  );
}
