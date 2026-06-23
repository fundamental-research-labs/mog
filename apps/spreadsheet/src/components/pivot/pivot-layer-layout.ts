import type { PivotFieldArea, PivotRenderedBounds, PlacementId } from '@mog-sdk/contracts/pivot';

import type { PivotViewModel } from '../../pivot/pivot-capabilities';
import {
  pivotBoundsForView,
  pivotRenderedBoundsForView,
  type PivotBounds,
} from '../../pivot/pivot-view-geometry';
import { pivotFieldLabel, pivotPlacementsFor } from '../../systems/pivot';

export interface PivotLayerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PivotMarker {
  id: string;
  name: string;
  pivot: PivotViewModel;
  bounds: PivotBounds;
  rect: PivotLayerRect;
  reportFilterControls: PivotReportFilterControlLayout[];
  fieldHeaderControls: PivotFieldHeaderControlLayout[];
}

export interface PivotReportFilterControlLayout {
  placementId: PlacementId;
  fieldId: string;
  label: string;
  row: number;
  rect: PivotLayerRect;
}

export interface PivotFieldHeaderControlLayout {
  placementId: PlacementId;
  fieldId: string;
  area: Extract<PivotFieldArea, 'row' | 'column'>;
  label: string;
  row: number;
  col: number;
  rect: PivotLayerRect;
}

interface PositionDimensionsLike {
  getColLeft(col: number): number;
  getColWidth(col: number): number;
  getRowTop(row: number): number;
  getRowHeight(row: number): number;
}

interface PivotLayerGeometryLike {
  getPositionDimensions(): PositionDimensionsLike;
  getCellPageRect(cell: { row: number; col: number }): PivotLayerRect | null;
  getContainerRect(): PivotLayerRect;
  getCellAreaOffset(): Pick<PivotLayerRect, 'x' | 'y'>;
}

interface PivotLayerViewportLike {
  getScrollPosition(): { x: number; y: number };
}

type ReadCellPageRect = (cell: { row: number; col: number }) => PivotLayerRect | null;

function rectsIntersect(a: PivotLayerRect, b: PivotLayerRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function fallbackCellPageRect(
  cell: { row: number; col: number },
  positionDimensions: PositionDimensionsLike,
  containerRect: PivotLayerRect,
  cellAreaOffset: Pick<PivotLayerRect, 'x' | 'y'>,
  scrollPosition: { x: number; y: number },
): PivotLayerRect {
  return {
    x:
      containerRect.x +
      cellAreaOffset.x +
      positionDimensions.getColLeft(cell.col) -
      scrollPosition.x,
    y:
      containerRect.y +
      cellAreaOffset.y +
      positionDimensions.getRowTop(cell.row) -
      scrollPosition.y,
    width: positionDimensions.getColWidth(cell.col),
    height: positionDimensions.getRowHeight(cell.row),
  };
}

function visibleCellPageRect(
  cell: { row: number; col: number },
  geometry: PivotLayerGeometryLike,
  positionDimensions: PositionDimensionsLike,
  containerRect: PivotLayerRect,
  cellAreaOffset: Pick<PivotLayerRect, 'x' | 'y'>,
  scrollPosition: { x: number; y: number },
): PivotLayerRect | null {
  const visibleRect = geometry.getCellPageRect(cell);
  if (visibleRect) return visibleRect;
  const fallbackRect = fallbackCellPageRect(
    cell,
    positionDimensions,
    containerRect,
    cellAreaOffset,
    scrollPosition,
  );
  const cellAreaRect = {
    x: containerRect.x + cellAreaOffset.x,
    y: containerRect.y + cellAreaOffset.y,
    width: Math.max(0, containerRect.width - cellAreaOffset.x),
    height: Math.max(0, containerRect.height - cellAreaOffset.y),
  };
  return rectsIntersect(fallbackRect, cellAreaRect) ? fallbackRect : null;
}

export function hasPivotOutputPlacements(config: PivotViewModel['config']): boolean {
  return config.placements.some(
    (placement) =>
      placement.area === 'row' || placement.area === 'column' || placement.area === 'value',
  );
}

export function hasPivotFilterPlacements(config: PivotViewModel['config']): boolean {
  return config.placements.some((placement) => placement.area === 'filter');
}

export function getVisiblePivotReportFilterControls(
  config: PivotViewModel['config'],
  bounds: PivotBounds,
  markerRect: PivotLayerRect,
  getCellPageRect: ReadCellPageRect,
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
  markerRect: PivotLayerRect,
  getCellPageRect: ReadCellPageRect,
  renderedBounds: PivotRenderedBounds = pivotRenderedBoundsForView(config, null),
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

export function getPivotMarker(
  pivot: PivotViewModel,
  geometry: PivotLayerGeometryLike,
  viewport: PivotLayerViewportLike | null | undefined,
): PivotMarker | null {
  const positionDimensions = geometry.getPositionDimensions();
  const scrollPosition = viewport?.getScrollPosition() ?? { x: 0, y: 0 };
  const containerRect = geometry.getContainerRect();
  const cellAreaOffset = geometry.getCellAreaOffset();
  const bounds = pivotBoundsForView(pivot.config, pivot.result);
  const anchorCell = {
    row: bounds.startRow,
    col: bounds.startCol,
  };
  const anchorRect =
    geometry.getCellPageRect(anchorCell) ??
    fallbackCellPageRect(
      anchorCell,
      positionDimensions,
      containerRect,
      cellAreaOffset,
      scrollPosition,
    );
  const getVisibleCellPageRect = (cell: { row: number; col: number }) =>
    visibleCellPageRect(
      cell,
      geometry,
      positionDimensions,
      containerRect,
      cellAreaOffset,
      scrollPosition,
    );

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
    reportFilterControls: getVisiblePivotReportFilterControls(pivot.config, bounds, rect, (cell) =>
      getVisibleCellPageRect(cell),
    ),
    fieldHeaderControls: getVisiblePivotFieldHeaderControls(
      pivot.config,
      bounds,
      rect,
      (cell) => getVisibleCellPageRect(cell),
      pivotRenderedBoundsForView(pivot.config, pivot.result),
    ),
  };
}
