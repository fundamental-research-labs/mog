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
import { pivotFieldLabel, pivotPlacementsFor, pivotReadbackAttributes } from '../../systems/pivot';

// =============================================================================
// DOM marker helpers
// =============================================================================

interface PivotMarker {
  id: string;
  name: string;
  pivot: PivotViewModel;
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

function hasOutputPlacements(config: PivotViewModel['config']): boolean {
  return config.placements.some(
    (placement) =>
      placement.area === 'row' || placement.area === 'column' || placement.area === 'value',
  );
}

function hasFilterPlacements(config: PivotViewModel['config']): boolean {
  return config.placements.some((placement) => placement.area === 'filter');
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
  const { pivotTables, startEditingPivot } = usePivotTables({ sheetId: activeSheetId });
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
          pivot,
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
      style={{
        position: 'fixed',
        width: 0,
        height: 0,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      <div aria-hidden="true">
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
      {markers.map((marker) => {
        const config = marker.pivot.config;
        const showEmptyState = !hasOutputPlacements(config);
        const showFilterControls = hasFilterPlacements(config);
        if (!showEmptyState && !showFilterControls) return null;

        const overlayWidth = showEmptyState
          ? Math.max(marker.rect.width, 280)
          : Math.max(marker.rect.width, 220);
        const overlayHeight = showEmptyState
          ? Math.max(marker.rect.height, 132)
          : Math.max(marker.rect.height, 36);
        const filterPlacements = pivotPlacementsFor(config, 'filter');

        return (
          <div
            key={`${marker.id}-visible-overlay`}
            data-pivot-target="table-view"
            data-pivot-layer-overlay="true"
            data-pivot-id={marker.id}
            data-pivot-name={marker.name}
            {...pivotReadbackAttributes(config)}
            style={{
              position: 'fixed',
              left: marker.rect.x,
              top: marker.rect.y,
              width: overlayWidth,
              minHeight: overlayHeight,
              pointerEvents: 'auto',
              zIndex: 6,
            }}
          >
            {showFilterControls && (
              <div className="flex flex-wrap items-center gap-2 rounded border border-ss-border bg-ss-surface/95 px-2 py-1 shadow-sm">
                {filterPlacements.map((placement) => {
                  const label = pivotFieldLabel(config, placement.fieldId);
                  return (
                    <button
                      key={placement.placementId}
                      type="button"
                      className="inline-flex max-w-full min-w-0 items-center gap-1 rounded border border-ss-border bg-ss-surface px-2 py-1 text-caption text-ss-text-primary shadow-sm hover:bg-ss-surface-hover"
                      data-pivot-target="report-filter-control"
                      data-pivot-field-id={placement.fieldId}
                      data-pivot-placement-id={placement.placementId}
                      title={`Filter ${label}: All`}
                      aria-label={`Filter ${label}: All`}
                      onClick={() => startEditingPivot(marker.id)}
                    >
                      <span className="min-w-0 truncate">{label}</span>
                      <span className="shrink-0 text-ss-text-secondary">All</span>
                      <span className="shrink-0 text-ss-text-secondary" aria-hidden="true">
                        v
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {showEmptyState && (
              <button
                type="button"
                className="mt-2 flex h-full min-h-[120px] w-full flex-col items-start justify-center rounded border border-dashed border-ss-border bg-ss-surface/95 px-4 py-3 text-left shadow-sm hover:bg-ss-surface-hover"
                data-pivot-target="empty-state"
                data-pivot-id={marker.id}
                title={`Configure ${marker.name}`}
                aria-label={`Configure empty pivot table ${marker.name}`}
                onClick={() => startEditingPivot(marker.id)}
              >
                <span
                  className="text-subtitle font-semibold text-ss-text-primary"
                  data-pivot-target="empty-state-name"
                >
                  {marker.name}
                </span>
                <span className="mt-1 text-body-sm text-ss-text-secondary">
                  Add row, column, or value fields to build this pivot table.
                </span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
