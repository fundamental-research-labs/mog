import type { PivotTableConfig as ApiPivotTableConfig } from '@mog-sdk/contracts/api';
import { toA1 } from '../../internal/utils';
import type {
  PivotFieldArea,
  PivotTableConfig as DataPivotTableConfig,
  PlacementId,
} from '@mog-sdk/contracts/pivot';
import { makePlacementId } from '../../../domain/pivots/identifiers';

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
  const fieldNameById = new Map(dataConfig.fields.map((field) => [field.id, field.name]));
  const fieldName = (fieldId: string): string => fieldNameById.get(fieldId) ?? fieldId;
  const rowFields: string[] = [];
  const columnFields: string[] = [];
  const valueFields: {
    placementId?: PlacementId;
    field: string;
    aggregation: 'sum' | 'count' | 'average' | 'max' | 'min';
    label?: string;
    showValuesAs?: DataPivotTableConfig['placements'][number]['showValuesAs'];
  }[] = [];
  const filterFields = new Set<string>();

  for (const placement of dataConfig.placements) {
    switch (placement.area as PivotFieldArea) {
      case 'row':
        rowFields.push(fieldName(placement.fieldId));
        break;
      case 'column':
        columnFields.push(fieldName(placement.fieldId));
        break;
      case 'value': {
        const valueField: (typeof valueFields)[number] = {
          placementId:
            placement.placementId ??
            makePlacementId('value', placement.fieldId, placement.position),
          field: fieldName(placement.fieldId),
          aggregation: (placement.aggregateFunction ?? 'sum') as
            | 'sum'
            | 'count'
            | 'average'
            | 'max'
            | 'min',
          label: placement.displayName ?? undefined,
        };
        if (placement.showValuesAs) {
          valueField.showValuesAs = placement.showValuesAs;
        }
        valueFields.push(valueField);
        break;
      }
      case 'filter':
        filterFields.add(fieldName(placement.fieldId));
        break;
    }
  }

  for (const filter of dataConfig.filters) {
    filterFields.add(fieldName(filter.fieldId));
  }

  return {
    name: dataConfig.name,
    dataSource: formatDataSource(sourceSheetName, dataConfig.sourceRange),
    rowFields,
    columnFields,
    valueFields,
    filterFields: [...filterFields],
    allowMultipleFiltersPerField: dataConfig.allowMultipleFiltersPerField ?? undefined,
    autoFormat: dataConfig.autoFormat ?? undefined,
    preserveFormatting: dataConfig.preserveFormatting ?? undefined,
  };
}
