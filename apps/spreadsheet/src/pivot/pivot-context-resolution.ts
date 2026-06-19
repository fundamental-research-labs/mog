import type { ContextMenuTarget } from '@mog-sdk/contracts/context-menu';
import type {
  PivotColumnHeader,
  PivotFieldArea,
  PivotFieldPlacementFlat,
  PivotHeader,
  PivotRow,
  PivotTableConfig,
  PivotTableResult,
} from '@mog-sdk/contracts/pivot';

import { pivotPlacementsFor } from '../systems/pivot';
import {
  pivotBoundsContain,
  pivotBoundsForView,
  pivotRenderedBoundsForView,
} from './pivot-view-geometry';

export interface PivotContextSource {
  config: PivotTableConfig;
  result?: PivotTableResult | null;
}

export interface ResolvedPivotContext {
  target: Extract<
    ContextMenuTarget,
    'pivot' | 'pivot-row-header' | 'pivot-column-header' | 'pivot-value'
  >;
  pivotId: string;
  pivotHeaderKey?: string;
  pivotFieldId?: string;
  pivotPlacementId?: PivotFieldPlacementFlat['placementId'];
  pivotFieldArea?: PivotFieldArea;
}

function placementContext(
  pivotId: string,
  target: ResolvedPivotContext['target'],
  placement: PivotFieldPlacementFlat | undefined,
  header: PivotHeader | undefined,
): ResolvedPivotContext | null {
  if (!placement) return null;
  return {
    target,
    pivotId,
    pivotHeaderKey: header?.key,
    pivotFieldId: placement.fieldId,
    pivotPlacementId: placement.placementId,
    pivotFieldArea: placement.area,
  };
}

function placementForHeader(
  header: PivotHeader | undefined,
  placements: readonly PivotFieldPlacementFlat[],
): PivotFieldPlacementFlat | undefined {
  if (!header) return undefined;
  return (
    placements.find((placement) => placement.placementId === header.axisPlacementId) ??
    placements.find((placement) => placement.fieldId === header.fieldId)
  );
}

function headerForPlacement(
  row: PivotRow,
  placement: PivotFieldPlacementFlat | undefined,
): PivotHeader | undefined {
  if (!placement) return undefined;
  return row.headers.find(
    (header) =>
      header.axisPlacementId === placement.placementId || header.fieldId === placement.fieldId,
  );
}

function deepestSortableHeader(row: PivotRow): PivotHeader | undefined {
  return [...row.headers].reverse().find((header) => !header.isGrandTotal);
}

function resolveRowBodyContext(
  pivotId: string,
  row: PivotRow | undefined,
  rowPlacements: readonly PivotFieldPlacementFlat[],
  relativeCol: number,
  firstDataCol: number,
): ResolvedPivotContext | null {
  if (!row || row.isGrandTotal || rowPlacements.length === 0) return null;

  const preferredPlacement =
    firstDataCol > 1 ? rowPlacements[Math.min(relativeCol, rowPlacements.length - 1)] : undefined;
  const header = headerForPlacement(row, preferredPlacement) ?? deepestSortableHeader(row);
  const placement = placementForHeader(header, rowPlacements) ?? preferredPlacement;
  return placementContext(pivotId, 'pivot-row-header', placement, header);
}

function columnHeaderAt(
  level: PivotColumnHeader | undefined,
  relativeDataCol: number,
): PivotHeader | undefined {
  if (!level || relativeDataCol < 0) return undefined;

  let cursor = 0;
  for (const header of level.headers) {
    if (relativeDataCol >= cursor && relativeDataCol < cursor + header.span) {
      return header.isGrandTotal ? undefined : header;
    }
    cursor += header.span;
  }
  return undefined;
}

function resolveColumnHeaderContext(
  pivotId: string,
  result: PivotTableResult | null | undefined,
  columnPlacements: readonly PivotFieldPlacementFlat[],
  relativeRow: number,
  relativeDataCol: number,
): ResolvedPivotContext | null {
  if (!result || columnPlacements.length === 0) return null;

  const level = result.columnHeaders[relativeRow];
  const header = columnHeaderAt(level, relativeDataCol);
  const placement =
    placementForHeader(header, columnPlacements) ??
    columnPlacements.find((candidate) => candidate.fieldId === level?.fieldId);
  return placementContext(pivotId, 'pivot-column-header', placement, header);
}

function valueFieldContext(
  pivotId: string,
  valuePlacements: readonly PivotFieldPlacementFlat[],
  relativeDataCol: number,
): ResolvedPivotContext {
  const placement =
    valuePlacements.length > 0
      ? valuePlacements[
          ((relativeDataCol % valuePlacements.length) + valuePlacements.length) %
            valuePlacements.length
        ]
      : undefined;
  return {
    target: 'pivot-value',
    pivotId,
    pivotFieldId: placement?.fieldId,
    pivotPlacementId: placement?.placementId,
    pivotFieldArea: placement?.area,
  };
}

export function resolvePivotContextAtCell(
  pivot: PivotContextSource,
  row: number,
  col: number,
): ResolvedPivotContext | null {
  const { config, result } = pivot;
  const bounds = pivotBoundsForView(config, result);
  if (!pivotBoundsContain(bounds, row, col)) return null;

  const renderedBounds = pivotRenderedBoundsForView(config, result);
  const relativeRow = row - bounds.startRow;
  const relativeCol = col - bounds.startCol;
  const firstDataRow = Math.max(0, renderedBounds.firstDataRow);
  const firstDataCol = Math.max(0, renderedBounds.firstDataCol);
  const rowPlacements = pivotPlacementsFor(config, 'row');
  const columnPlacements = pivotPlacementsFor(config, 'column');
  const valuePlacements = pivotPlacementsFor(config, 'value');
  const pivotId = config.id;

  const rowHeaderRow = Math.max(0, firstDataRow - 1);
  if (rowPlacements.length > 0 && relativeRow === rowHeaderRow && relativeCol < firstDataCol) {
    return placementContext(
      pivotId,
      'pivot-row-header',
      rowPlacements[Math.min(relativeCol, rowPlacements.length - 1)],
      undefined,
    );
  }

  if (columnPlacements.length > 0 && relativeRow < firstDataRow && relativeCol === firstDataCol) {
    return placementContext(
      pivotId,
      'pivot-column-header',
      columnPlacements[Math.min(relativeRow, columnPlacements.length - 1)],
      undefined,
    );
  }

  if (columnPlacements.length > 0 && relativeRow < firstDataRow && relativeCol >= firstDataCol) {
    const context = resolveColumnHeaderContext(
      pivotId,
      result,
      columnPlacements,
      relativeRow,
      relativeCol - firstDataCol,
    );
    if (context) return context;
  }

  if (rowPlacements.length > 0 && relativeRow >= firstDataRow && relativeCol < firstDataCol) {
    const rowIndex = relativeRow - firstDataRow;
    const context = resolveRowBodyContext(
      pivotId,
      result?.rows[rowIndex],
      rowPlacements,
      relativeCol,
      firstDataCol,
    );
    if (context) return context;
  }

  if (relativeRow >= firstDataRow && relativeCol >= firstDataCol) {
    return valueFieldContext(pivotId, valuePlacements, relativeCol - firstDataCol);
  }

  return {
    target: 'pivot',
    pivotId,
  };
}
