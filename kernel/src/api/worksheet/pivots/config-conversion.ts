import type { PivotTableConfig as ApiPivotTableConfig } from '@mog-sdk/contracts/api';
import { toA1 } from '../../internal/utils';
import type {
  PivotFieldArea,
  PivotTableConfig as DataPivotTableConfig,
  PlacementId,
} from '@mog-sdk/contracts/pivot';
import { makePlacementId } from './identifiers';

function formatDataSource(
  sourceSheetName: string | null,
  sourceRange: DataPivotTableConfig['sourceRange'],
): string {
  if (!sourceRange) return '';
  const start = toA1(sourceRange.startRow, sourceRange.startCol);
  const end = toA1(sourceRange.endRow, sourceRange.endCol);
  const sheetRef = sourceSheetName ?? 'Unknown';
  const needsQuotes = /[^A-Za-z0-9_]/.test(sheetRef);
  const quotedSheet = needsQuotes ? `'${sheetRef}'` : sheetRef;
  return `${quotedSheet}!${start}:${end}`;
}

export function dataConfigToApiConfig(
  dataConfig: DataPivotTableConfig,
  sourceSheetName: string | null,
): ApiPivotTableConfig {
  const rowFields: string[] = [];
  const columnFields: string[] = [];
  const valueFields: {
    placementId?: PlacementId;
    field: string;
    aggregation: 'sum' | 'count' | 'average' | 'max' | 'min';
    label?: string;
  }[] = [];
  const filterFields: string[] = [];

  for (const placement of dataConfig.placements) {
    switch (placement.area as PivotFieldArea) {
      case 'row':
        rowFields.push(placement.fieldId);
        break;
      case 'column':
        columnFields.push(placement.fieldId);
        break;
      case 'value':
        valueFields.push({
          placementId:
            placement.placementId ??
            makePlacementId('value', placement.fieldId, placement.position),
          field: placement.fieldId,
          aggregation: (placement.aggregateFunction ?? 'sum') as
            | 'sum'
            | 'count'
            | 'average'
            | 'max'
            | 'min',
          label: placement.displayName ?? undefined,
        });
        break;
      case 'filter':
        filterFields.push(placement.fieldId);
        break;
    }
  }

  return {
    name: dataConfig.name,
    dataSource: formatDataSource(sourceSheetName, dataConfig.sourceRange),
    rowFields,
    columnFields,
    valueFields,
    filterFields,
    allowMultipleFiltersPerField: dataConfig.allowMultipleFiltersPerField ?? undefined,
    autoFormat: dataConfig.autoFormat ?? undefined,
    preserveFormatting: dataConfig.preserveFormatting ?? undefined,
  };
}
