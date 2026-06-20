import type { PivotQueryRecord, PivotQueryResult } from '@mog-sdk/contracts/api';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import type { PivotTableResult } from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import { findPivotByName } from './lookup';
import { automaticPivotValuePlacementDisplayName } from './value-labels';

export async function queryPivotByName(params: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  filters?: Record<string, CellValue | CellValue[]>;
}): Promise<PivotQueryResult | null> {
  const { ctx, sheetId, pivotName, filters } = params;
  const pivot = await findPivotByName(ctx, sheetId, pivotName);
  if (!pivot) {
    throw new KernelError(
      'COMPUTE_ERROR',
      `queryPivot: Pivot table "${pivotName}" not found on this sheet`,
    );
  }

  const pivotId = pivot.id ?? pivot.name;
  const result: PivotTableResult | null = await ctx.pivot.compute(sheetId, pivotId);
  if (!result) return null;

  const fieldNameById = new Map<string, string>();
  for (const field of pivot.fields) {
    fieldNameById.set(field.id, field.name);
  }

  const rowPlacements = pivot.placements
    .filter((placement) => placement.area === 'row')
    .sort((a, b) => a.position - b.position);
  const colPlacements = pivot.placements
    .filter((placement) => placement.area === 'column')
    .sort((a, b) => a.position - b.position);
  const valuePlacements = pivot.placements
    .filter((placement) => placement.area === 'value')
    .sort((a, b) => a.position - b.position);

  const rowFieldNames = rowPlacements.map(
    (placement) => fieldNameById.get(placement.fieldId) ?? placement.fieldId,
  );
  const colFieldNames = colPlacements.map(
    (placement) => fieldNameById.get(placement.fieldId) ?? placement.fieldId,
  );
  const valueFieldLabels = valuePlacements.map((placement) =>
    automaticPivotValuePlacementDisplayName({
      config: pivot,
      placement,
      displayName: placement.displayName,
    }),
  );

  const colDimensionTuples = buildColumnDimensionTuples(
    result,
    colPlacements.map((placement) => placement.fieldId),
    fieldNameById,
  );
  const records = buildQueryRecords({
    result,
    fieldNameById,
    rowFieldCount: rowPlacements.length,
    valuePlacementsLength: valuePlacements.length,
    valueFieldLabels,
    colDimensionTuples,
  });

  return {
    pivotName,
    rowFields: rowFieldNames,
    columnFields: colFieldNames,
    valueFields: valueFieldLabels,
    records: applyDimensionFilters(records, filters),
    sourceRowCount: result.sourceRowCount,
  };
}

function buildColumnDimensionTuples(
  result: PivotTableResult,
  colFieldIds: string[],
  fieldNameById: Map<string, string>,
): Record<string, CellValue>[] {
  if (colFieldIds.length === 0 || result.columnHeaders.length === 0) return [];

  const tuples: Record<string, CellValue>[] = [];
  for (let index = 0; index < result.renderedBounds.numDataCols; index++) {
    tuples.push({});
  }

  for (const level of result.columnHeaders) {
    const fieldName = fieldNameById.get(level.fieldId) ?? level.fieldId;
    let colIndex = 0;
    for (const header of level.headers) {
      if (!header.isSubtotal && !header.isGrandTotal) {
        for (let offset = 0; offset < header.span; offset++) {
          if (colIndex + offset < result.renderedBounds.numDataCols) {
            tuples[colIndex + offset][fieldName] = header.value;
          }
        }
      }
      colIndex += header.span;
    }
  }

  return tuples;
}

function buildQueryRecords(params: {
  result: PivotTableResult;
  fieldNameById: Map<string, string>;
  rowFieldCount: number;
  valuePlacementsLength: number;
  valueFieldLabels: string[];
  colDimensionTuples: Record<string, CellValue>[];
}): PivotQueryRecord[] {
  const {
    result,
    fieldNameById,
    rowFieldCount,
    valuePlacementsLength,
    valueFieldLabels,
    colDimensionTuples,
  } = params;
  const records: PivotQueryRecord[] = [];

  for (const row of result.rows) {
    if (row.isSubtotal || row.isGrandTotal) continue;

    const rowHeaders = row.headers.filter((header) => !header.isSubtotal && !header.isGrandTotal);
    if (rowFieldCount > 0 && rowHeaders.length !== rowFieldCount) continue;

    const rowDimensions: Record<string, CellValue> = {};
    for (const header of rowHeaders) {
      const fieldName = fieldNameById.get(header.fieldId) ?? header.fieldId;
      rowDimensions[fieldName] = header.value;
    }

    if (colDimensionTuples.length > 0) {
      for (let colIndex = 0; colIndex < colDimensionTuples.length; colIndex++) {
        const colDims = colDimensionTuples[colIndex];
        if (!colDims || Object.keys(colDims).length === 0) continue;

        const values: Record<string, CellValue> = {};
        if (valuePlacementsLength <= 1) {
          values[valueFieldLabels[0] ?? 'Value'] = row.values[colIndex] ?? null;
        } else {
          const valueIndex = colIndex % valuePlacementsLength;
          values[valueFieldLabels[valueIndex] ?? 'Value'] = row.values[colIndex] ?? null;
        }
        records.push({ dimensions: { ...rowDimensions, ...colDims }, values });
      }
      continue;
    }

    const values: Record<string, CellValue> = {};
    for (let index = 0; index < valuePlacementsLength; index++) {
      values[valueFieldLabels[index] ?? `Value${index}`] = row.values[index] ?? null;
    }
    records.push({ dimensions: rowDimensions, values });
  }

  return records;
}

function applyDimensionFilters(
  records: PivotQueryRecord[],
  filters?: Record<string, CellValue | CellValue[]>,
): PivotQueryRecord[] {
  if (!filters) return records;
  return records.filter((record) => {
    for (const [field, filterValue] of Object.entries(filters)) {
      const dimensionValue = record.dimensions[field];
      if (Array.isArray(filterValue)) {
        if (!filterValue.some((value) => String(value) === String(dimensionValue))) return false;
      } else if (String(filterValue) !== String(dimensionValue)) {
        return false;
      }
    }
    return true;
  });
}
