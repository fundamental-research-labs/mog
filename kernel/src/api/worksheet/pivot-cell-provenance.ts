import type { SheetId } from '@mog-sdk/contracts/api';
import type {
  AggregateFunction,
  PivotDataHierarchyInfo,
  PivotFieldPlacementFlat,
  PivotItemLocation,
  PivotTableResult,
} from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../context';
import { pivotMemberKey } from './pivot-identifiers';
import { requirePivot, resolvePivotName } from './pivot-lookup';

type PivotFieldPlacement = PivotFieldPlacementFlat;

export async function getPivotDataHierarchyAtCell(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  row: number;
  col: number;
}): Promise<PivotDataHierarchyInfo | null> {
  const { ctx, sheetId, pivotName, row, col } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'getDataHierarchy');
  const config = await requirePivot(ctx, sheetId, pivotId, 'getDataHierarchy');
  const result: PivotTableResult | null = await ctx.pivot.compute(sheetId, pivotId);
  if (!result) return null;

  const bounds = result.renderedBounds;
  if (row < bounds.firstDataRow || col < bounds.firstDataCol) return null;
  if (row >= bounds.totalRows || col >= bounds.totalCols) return null;

  const valuePlacements = config.placements.filter(
    (placement: PivotFieldPlacement) => placement.area === 'value',
  );
  if (valuePlacements.length === 0) return null;

  const dataCol = col - bounds.firstDataCol;
  const valueIndex = dataCol % valuePlacements.length;
  const valuePlacement = valuePlacements[valueIndex];
  if (!valuePlacement) return null;

  const field = config.fields.find((candidate) => candidate.id === valuePlacement.fieldId);
  const fieldName = field?.name ?? valuePlacement.fieldId;
  const aggregate = valuePlacement.aggregateFunction ?? 'sum';
  const aggregateLabel = aggregate.charAt(0).toUpperCase() + aggregate.slice(1);
  const displayName = valuePlacement.displayName ?? `${aggregateLabel} of ${fieldName}`;

  return {
    fieldId: valuePlacement.fieldId,
    displayName,
    aggregateFunction: aggregate as AggregateFunction,
    index: valueIndex,
  };
}

export async function getPivotItemsAtCell(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  axis: 'row' | 'column';
  row: number;
  col: number;
}): Promise<PivotItemLocation[] | null> {
  const { ctx, sheetId, pivotName, axis, row, col } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'getPivotItems');
  const result: PivotTableResult | null = await ctx.pivot.compute(sheetId, pivotId);
  if (!result) return null;

  const bounds = result.renderedBounds;
  if (row < bounds.firstDataRow || col < bounds.firstDataCol) return null;
  if (row >= bounds.totalRows || col >= bounds.totalCols) return null;

  if (axis === 'row') {
    const dataRowIndex = row - bounds.firstDataRow;
    if (dataRowIndex < 0 || dataRowIndex >= result.rows.length) return null;
    const pivotRow = result.rows[dataRowIndex];
    return pivotRow.headers.map((header) => ({
      fieldId: header.fieldId,
      value: header.value,
      key: pivotMemberKey(header.key),
    }));
  }

  const dataCol = col - bounds.firstDataCol;
  const items: PivotItemLocation[] = [];
  for (const level of result.columnHeaders) {
    let colOffset = 0;
    for (const header of level.headers) {
      if (dataCol >= colOffset && dataCol < colOffset + header.span) {
        items.push({
          fieldId: header.fieldId,
          value: header.value,
          key: pivotMemberKey(header.key),
        });
        break;
      }
      colOffset += header.span;
    }
  }
  return items;
}
