/**
 * Pivot Layer Container
 *
 * Pivot table output is materialized into sheet cells by the compute engine.
 * Imported workbooks and ribbon-created pivots must therefore share the same
 * visible surface: the grid cells themselves. Contextual tools are driven by
 * cell selection over the registered pivot range, not by a floating DOM table.
 */

import { useEffect, useMemo, useState } from 'react';

import { ChevronDownSvg } from '@mog/icons';
import type {
  PivotFieldArea,
  PivotRenderedBounds,
  PlacementId,
  SortOrder,
} from '@mog-sdk/contracts/pivot';
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
  reportFilterControls: PivotReportFilterControlLayout[];
  fieldHeaderControls: PivotFieldHeaderControlLayout[];
}

export interface PivotReportFilterControlLayout {
  placementId: string;
  fieldId: string;
  label: string;
  row: number;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface PivotFieldHeaderControlLayout {
  placementId: PlacementId;
  fieldId: string;
  area: Extract<PivotFieldArea, 'row' | 'column'>;
  label: string;
  row: number;
  col: number;
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

function fallbackRenderedBounds(config: PivotViewModel['config']): PivotRenderedBounds {
  const rowFieldCount = pivotPlacementsFor(config, 'row').length;
  const columnFieldCount = pivotPlacementsFor(config, 'column').length;
  const valueFieldCount = pivotPlacementsFor(config, 'value').length;
  return {
    totalRows: 1,
    totalCols: 1,
    firstDataRow: Math.max(columnFieldCount, 1) + (valueFieldCount > 1 ? 1 : 0),
    firstDataCol: Math.max(rowFieldCount, 1),
    numDataCols: Math.max(valueFieldCount, 0),
  };
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

export function getVisiblePivotReportFilterControls(
  config: PivotViewModel['config'],
  bounds: PivotBounds,
  markerRect: PivotMarker['rect'],
  getCellPageRect: (cell: { row: number; col: number }) => {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null,
): PivotReportFilterControlLayout[] {
  return pivotPlacementsFor(config, 'filter')
    .map((placement, index): PivotReportFilterControlLayout | null => {
      const row = bounds.startRow + index;
      const pageRect = getCellPageRect({ row, col: bounds.startCol });
      if (!pageRect) return null;
      return {
        placementId: placement.placementId,
        fieldId: placement.fieldId,
        label: pivotFieldLabel(config, placement.fieldId),
        row,
        rect: {
          x: pageRect.x - markerRect.x,
          y: pageRect.y - markerRect.y,
          width: pageRect.width,
          height: pageRect.height,
        },
      };
    })
    .filter((control): control is PivotReportFilterControlLayout => control != null);
}

export function getVisiblePivotFieldHeaderControls(
  config: PivotViewModel['config'],
  bounds: PivotBounds,
  markerRect: PivotMarker['rect'],
  getCellPageRect: (cell: { row: number; col: number }) => {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null,
  renderedBounds: PivotRenderedBounds = fallbackRenderedBounds(config),
): PivotFieldHeaderControlLayout[] {
  const controls: PivotFieldHeaderControlLayout[] = [];
  const widthCols = bounds.endCol - bounds.startCol + 1;
  if (widthCols <= 0) return controls;

  const firstDataRow = Math.max(0, renderedBounds.firstDataRow);
  const firstDataCol = Math.max(0, Math.min(renderedBounds.firstDataCol, widthCols - 1));
  const rowHeaderRow = Math.min(bounds.endRow, bounds.startRow + Math.max(0, firstDataRow - 1));

  for (const [index, placement] of pivotPlacementsFor(config, 'row').entries()) {
    const col = bounds.startCol + index;
    if (col > bounds.endCol) continue;
    const pageRect = getCellPageRect({ row: rowHeaderRow, col });
    if (!pageRect) continue;
    controls.push({
      placementId: placement.placementId,
      fieldId: placement.fieldId,
      area: 'row',
      label: pivotFieldLabel(config, placement.fieldId),
      row: rowHeaderRow,
      col,
      rect: {
        x: pageRect.x - markerRect.x,
        y: pageRect.y - markerRect.y,
        width: pageRect.width,
        height: pageRect.height,
      },
    });
  }

  for (const [index, placement] of pivotPlacementsFor(config, 'column').entries()) {
    const row = bounds.startRow + index;
    if (row > bounds.endRow) continue;
    const col = bounds.startCol + firstDataCol;
    const pageRect = getCellPageRect({ row, col });
    if (!pageRect) continue;
    controls.push({
      placementId: placement.placementId,
      fieldId: placement.fieldId,
      area: 'column',
      label: pivotFieldLabel(config, placement.fieldId),
      row,
      col,
      rect: {
        x: pageRect.x - markerRect.x,
        y: pageRect.y - markerRect.y,
        width: pageRect.width,
        height: pageRect.height,
      },
    });
  }

  return controls;
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
  const { pivotTables, startEditingPivot, setPlacementSortOrder } = usePivotTables({
    sheetId: activeSheetId,
  });
  const { isReady } = useRendererStatus();
  const { getGeometry, getViewport } = useRendererActions();
  const coordinator = useCoordinator();
  const [scrollTick, setScrollTick] = useState(0);
  const [openHeaderMenu, setOpenHeaderMenu] = useState<{
    pivotId: string;
    placementId: string;
  } | null>(null);

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

        const rect = {
          x: anchorRect.x,
          y: anchorRect.y,
          width,
          height,
        };

        return {
          id: pivot.config.id,
          name: pivot.config.name,
          pivot,
          bounds,
          rect,
          reportFilterControls: getVisiblePivotReportFilterControls(
            pivot.config,
            bounds,
            rect,
            (cell) => geometry.getCellPageRect(cell),
          ),
          fieldHeaderControls: getVisiblePivotFieldHeaderControls(
            pivot.config,
            bounds,
            rect,
            (cell) => geometry.getCellPageRect(cell),
            pivot.result?.renderedBounds,
          ),
        };
      })
      .filter((marker): marker is PivotMarker => marker != null);
  }, [geometry, getViewport, isReady, pivotTables, scrollTick]);

  const applyHeaderSort = (
    marker: PivotMarker,
    control: PivotFieldHeaderControlLayout,
    sortOrder: SortOrder | null,
  ) => {
    setPlacementSortOrder(marker.id, control.placementId, sortOrder);
    setOpenHeaderMenu(null);
  };

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
        const showHeaderControls = marker.fieldHeaderControls.length > 0;
        if (!showEmptyState && !showFilterControls && !showHeaderControls) return null;

        const overlayWidth = showEmptyState
          ? Math.max(marker.rect.width, 280)
          : Math.max(marker.rect.width, 220);
        const overlayHeight = showEmptyState
          ? Math.max(marker.rect.height, 132)
          : Math.max(marker.rect.height, 36);

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
              pointerEvents:
                showEmptyState ||
                marker.reportFilterControls.length > 0 ||
                marker.fieldHeaderControls.length > 0
                  ? 'auto'
                  : 'none',
              zIndex: 6,
            }}
          >
            {showHeaderControls && (
              <div className="absolute inset-0 pointer-events-none">
                {marker.fieldHeaderControls.map((control) => {
                  const isOpen =
                    openHeaderMenu?.pivotId === marker.id &&
                    openHeaderMenu?.placementId === control.placementId;
                  const canSort = marker.pivot.capabilities.canSortLabels;
                  return (
                    <div
                      key={control.placementId}
                      className="absolute pointer-events-none"
                      style={{
                        left: control.rect.x,
                        top: control.rect.y,
                        width: control.rect.width,
                        height: control.rect.height,
                      }}
                    >
                      <button
                        type="button"
                        className="pointer-events-auto absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded border border-ss-border bg-ss-surface/95 text-ss-text-secondary shadow-sm hover:bg-ss-surface-hover disabled:opacity-50"
                        data-pivot-target="pivot-field-header-control"
                        data-pivot-area={control.area}
                        data-pivot-field-id={control.fieldId}
                        data-pivot-placement-id={control.placementId}
                        data-pivot-row={control.row}
                        data-pivot-col={control.col}
                        aria-haspopup="menu"
                        aria-expanded={isOpen ? 'true' : 'false'}
                        title={`${control.label} field menu`}
                        aria-label={`${control.label} field menu`}
                        disabled={!marker.pivot.capabilities.canEditFields}
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenHeaderMenu(
                            isOpen
                              ? null
                              : { pivotId: marker.id, placementId: control.placementId },
                          );
                        }}
                      >
                        <ChevronDownSvg className="h-3 w-3" aria-hidden="true" />
                      </button>
                      {isOpen && (
                        <div
                          role="menu"
                          className="pointer-events-auto absolute right-0 top-6 z-10 flex min-w-36 flex-col rounded border border-ss-border bg-ss-surface p-1 text-caption text-ss-text-primary shadow-lg"
                          data-pivot-target="pivot-field-header-menu"
                          data-pivot-area={control.area}
                          data-pivot-field-id={control.fieldId}
                          data-pivot-placement-id={control.placementId}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            className="rounded px-2 py-1 text-left hover:bg-ss-surface-hover disabled:opacity-50"
                            disabled={!canSort}
                            onClick={() => applyHeaderSort(marker, control, 'asc')}
                          >
                            Sort Ascending
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="rounded px-2 py-1 text-left hover:bg-ss-surface-hover disabled:opacity-50"
                            disabled={!canSort}
                            onClick={() => applyHeaderSort(marker, control, 'desc')}
                          >
                            Sort Descending
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="rounded px-2 py-1 text-left hover:bg-ss-surface-hover disabled:opacity-50"
                            disabled={!canSort}
                            onClick={() => applyHeaderSort(marker, control, null)}
                          >
                            Clear Sort
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="rounded px-2 py-1 text-left hover:bg-ss-surface-hover"
                            onClick={() => {
                              startEditingPivot(marker.id);
                              setOpenHeaderMenu(null);
                            }}
                          >
                            Field Settings
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {showFilterControls && (
              <div className="absolute inset-0 pointer-events-none">
                {marker.reportFilterControls.map((control) => (
                  <div
                    key={control.placementId}
                    className="absolute flex items-center pointer-events-none"
                    style={{
                      left: control.rect.x,
                      top: control.rect.y,
                      height: control.rect.height,
                    }}
                  >
                    <button
                      type="button"
                      className="pointer-events-auto inline-flex max-w-full min-w-0 items-center gap-1 rounded border border-ss-border bg-ss-surface/95 px-2 py-1 text-caption text-ss-text-primary shadow-sm hover:bg-ss-surface-hover"
                      data-pivot-target="report-filter-control"
                      data-pivot-field-id={control.fieldId}
                      data-pivot-placement-id={control.placementId}
                      data-pivot-row={control.row}
                      title={`Filter ${control.label}: All`}
                      aria-label={`Filter ${control.label}: All`}
                      onClick={() => startEditingPivot(marker.id)}
                    >
                      <span className="min-w-0 truncate">{control.label}</span>
                      <span className="shrink-0 text-ss-text-secondary">All</span>
                      <span className="shrink-0 text-ss-text-secondary" aria-hidden="true">
                        v
                      </span>
                    </button>
                  </div>
                ))}
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
