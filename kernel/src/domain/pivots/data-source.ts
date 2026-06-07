import type { PivotTableConfig as ApiPivotTableConfig } from '@mog-sdk/contracts/api';
import { type CellValue, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  AggregateFunction,
  CalculatedField,
  DetectedDataType,
  PivotField,
  PivotFieldArea,
  PivotFieldPlacementFlat,
  PivotFilter,
  PivotTableConfig as DataPivotTableConfig,
  PlacementId,
} from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../context';
import {
  KernelError,
  createPivotInvalidDataSourceError,
  createPivotUnresolvedFieldReferencesError,
  type PivotInvalidReference,
} from '../../errors';
import { parseCellRange } from '@mog/spreadsheet-utils/a1';
import { pivotValueFieldDisplayName } from './value-labels';

type PivotFieldPlacement = PivotFieldPlacementFlat;

export type PivotCreateDataConfig = Omit<
  DataPivotTableConfig,
  'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'
>;

type MakePlacementId = (area: PivotFieldArea, fieldId: string, position: number) => PlacementId;

export function isSimplePivotConfig(config: Record<string, unknown>): boolean {
  return typeof config.dataSource === 'string' && !('sourceSheetName' in config);
}

function parseDataSource(dataSource: string): {
  sheetName: string;
  range: { startRow: number; startCol: number; endRow: number; endCol: number };
} {
  const parsed = parseCellRange(dataSource);
  if (!parsed) {
    throw new KernelError(
      'API_INVALID_ADDRESS',
      `Invalid dataSource: "${dataSource}". Expected format: "SheetName!A1:D100"`,
    );
  }
  const sheetName = parsed.sheetName;
  if (!sheetName) {
    throw new KernelError(
      'API_INVALID_ADDRESS',
      `dataSource must include a sheet reference: "${dataSource}". Expected format: "SheetName!A1:D100"`,
    );
  }
  return {
    sheetName,
    range: {
      startRow: parsed.startRow,
      startCol: parsed.startCol,
      endRow: parsed.endRow,
      endCol: parsed.endCol,
    },
  };
}

async function resolveSourceSheetId(
  ctx: DocumentContext,
  pivotName: string,
  dataSource: string,
  sheetName: string,
): Promise<SheetId> {
  const sheetIds = await ctx.computeBridge.getAllSheetIds();
  for (const id of sheetIds) {
    const sid = toSheetId(id as string);
    const name = await ctx.computeBridge.getSheetName(sid);
    if (name === sheetName) {
      return sid;
    }
  }
  throw createPivotInvalidDataSourceError({
    pivotName,
    dataSource,
    reason: 'sourceSheetNotFound',
    sheetName,
  });
}

function detectCellDataType(value: CellValue): DetectedDataType {
  if (value == null || value === '') return 'empty';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

async function detectPivotFieldsForRange(
  ctx: DocumentContext,
  sourceSheetId: SheetId,
  sourceRange: DataPivotTableConfig['sourceRange'],
): Promise<PivotField[]> {
  const headerRange = await ctx.computeBridge.queryRange(
    sourceSheetId,
    sourceRange.startRow,
    sourceRange.startCol,
    sourceRange.startRow,
    sourceRange.endCol,
  );

  const dataRowRange =
    sourceRange.endRow > sourceRange.startRow
      ? await ctx.computeBridge.queryRange(
          sourceSheetId,
          sourceRange.startRow + 1,
          sourceRange.startCol,
          sourceRange.startRow + 1,
          sourceRange.endCol,
        )
      : { cells: [] };

  const headerCells = new Map<number, string>();
  for (const cell of headerRange.cells) {
    const name = cell.value != null ? String(cell.value) : `Column${cell.col + 1}`;
    headerCells.set(cell.col, name);
  }

  const dataTypes = new Map<number, DetectedDataType>();
  for (const cell of dataRowRange.cells) {
    dataTypes.set(cell.col, detectCellDataType(cell.value));
  }

  const fields: PivotField[] = [];
  for (let col = sourceRange.startCol; col <= sourceRange.endCol; col++) {
    fields.push({
      id: `col${col}`,
      name: headerCells.get(col) ?? `Column${col + 1}`,
      sourceColumn: col - sourceRange.startCol,
      dataType: dataTypes.get(col) ?? 'string',
    });
  }
  return fields;
}

function fieldsByName(fields: PivotField[]): Map<string, PivotField[]> {
  const byName = new Map<string, PivotField[]>();
  for (const field of fields) {
    const existing = byName.get(field.name);
    if (existing) {
      existing.push(field);
    } else {
      byName.set(field.name, [field]);
    }
  }
  return byName;
}

async function resolveExistingPivotSourceSheetId(
  ctx: DocumentContext,
  config: DataPivotTableConfig,
): Promise<SheetId | null> {
  if (config.sourceSheetId) {
    return toSheetId(config.sourceSheetId);
  }

  if (!config.sourceSheetName) {
    return null;
  }

  const sheetIds = await ctx.computeBridge.getAllSheetIds();
  for (const id of sheetIds) {
    const sid = toSheetId(id as string);
    const name = await ctx.computeBridge.getSheetName(sid);
    if (name === config.sourceSheetName) {
      return sid;
    }
  }
  return null;
}

async function effectivePivotFieldsForConfig(
  ctx: DocumentContext,
  config: DataPivotTableConfig,
): Promise<PivotField[]> {
  if (config.fields.length > 0) {
    return config.fields;
  }

  const sourceSheetId = await resolveExistingPivotSourceSheetId(ctx, config);
  if (!sourceSheetId) {
    return [];
  }

  return detectPivotFieldsForRange(ctx, sourceSheetId, config.sourceRange);
}

export async function convertSimpleToDataConfig(
  ctx: DocumentContext,
  simpleConfig: ApiPivotTableConfig,
  outputSheetName: string,
  makePlacementId: MakePlacementId,
): Promise<PivotCreateDataConfig> {
  const { sheetName: sourceSheetName, range: sourceRange } = parseDataSource(
    simpleConfig.dataSource,
  );

  const sourceSheetId = await resolveSourceSheetId(
    ctx,
    simpleConfig.name,
    simpleConfig.dataSource,
    sourceSheetName,
  );
  const fields = await detectPivotFieldsForRange(ctx, sourceSheetId, sourceRange);
  const fieldByName = new Map(fields.map((field) => [field.name, field]));

  const placements: PivotFieldPlacement[] = [];

  const resolveFieldId = (fieldName: string): string => {
    const field = fieldByName.get(fieldName);
    if (!field) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Field "${fieldName}" not found in source data headers. Available: ${[...fieldByName.keys()].join(', ')}`,
      );
    }
    return field.id;
  };

  if (simpleConfig.rowFields) {
    for (let i = 0; i < simpleConfig.rowFields.length; i++) {
      const fieldId = resolveFieldId(simpleConfig.rowFields[i]);
      placements.push({
        placementId: makePlacementId('row', fieldId, i),
        fieldId,
        area: 'row',
        position: i,
      });
    }
  }

  if (simpleConfig.columnFields) {
    for (let i = 0; i < simpleConfig.columnFields.length; i++) {
      const fieldId = resolveFieldId(simpleConfig.columnFields[i]);
      placements.push({
        placementId: makePlacementId('column', fieldId, i),
        fieldId,
        area: 'column',
        position: i,
      });
    }
  }

  if (simpleConfig.valueFields) {
    for (let i = 0; i < simpleConfig.valueFields.length; i++) {
      const vf = simpleConfig.valueFields[i];
      const fieldId = resolveFieldId(vf.field);
      const sourceFieldName = fields.find((field) => field.id === fieldId)?.name ?? fieldId;
      placements.push({
        placementId: makePlacementId('value', fieldId, i),
        fieldId,
        area: 'value',
        position: i,
        aggregateFunction: vf.aggregation as AggregateFunction,
        displayName: pivotValueFieldDisplayName({
          displayName: vf.label,
          sourceFieldName,
          fieldId,
          aggregateFunction: vf.aggregation as AggregateFunction,
        }),
      });
    }
  }

  if (simpleConfig.filterFields) {
    for (let i = 0; i < simpleConfig.filterFields.length; i++) {
      const fieldId = resolveFieldId(simpleConfig.filterFields[i]);
      placements.push({
        placementId: makePlacementId('filter', fieldId, i),
        fieldId,
        area: 'filter',
        position: i,
      });
    }
  }

  let outputLocation = { row: 0, col: 0 };
  if (simpleConfig.targetAddress) {
    const addr = parseCellRange(simpleConfig.targetAddress);
    if (addr) {
      outputLocation = { row: addr.startRow, col: addr.startCol };
    }
  }

  return {
    name: simpleConfig.name,
    sourceSheetName,
    sourceRange,
    outputSheetName: simpleConfig.targetSheet ?? outputSheetName,
    outputLocation,
    fields,
    placements,
    filters: [],
    ...(simpleConfig.allowMultipleFiltersPerField != null && {
      allowMultipleFiltersPerField: simpleConfig.allowMultipleFiltersPerField,
    }),
    ...(simpleConfig.autoFormat != null && { autoFormat: simpleConfig.autoFormat }),
    ...(simpleConfig.preserveFormatting != null && {
      preserveFormatting: simpleConfig.preserveFormatting,
    }),
  };
}

export async function updatePivotDataSource(params: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotId: string;
  config: DataPivotTableConfig;
  dataSource: string;
  pivotName: string;
}): Promise<void> {
  const { ctx, sheetId, pivotId, config, dataSource, pivotName } = params;
  const { sheetName: sourceSheetName, range: sourceRange } = parseDataSource(dataSource);
  const sourceSheetId = await resolveSourceSheetId(ctx, pivotName, dataSource, sourceSheetName);
  const fields = await detectPivotFieldsForRange(ctx, sourceSheetId, sourceRange);
  const newFieldsByName = fieldsByName(fields);
  const oldFields = await effectivePivotFieldsForConfig(ctx, config);
  const oldFieldsById = new Map(oldFields.map((field) => [field.id, field]));
  const calculatedFields = config.calculatedFields ?? [];
  const calculatedFieldKeys = (field: CalculatedField): string[] =>
    [field.fieldId, field.calculatedFieldId].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
  const calculatedFieldById = new Map<string, CalculatedField>();
  for (const field of calculatedFields) {
    for (const id of calculatedFieldKeys(field)) {
      calculatedFieldById.set(id, field);
    }
  }
  const calculatedFieldIds = new Set(calculatedFieldById.keys());
  const invalidReferences: PivotInvalidReference[] = [];

  const describeCandidates = (candidates: PivotField[]): string[] =>
    candidates.map((field) => `${field.id}:${field.name}@${field.sourceColumn ?? 0}`);

  const oldFieldName = (fieldId: string): string =>
    oldFieldsById.get(fieldId)?.name ?? calculatedFieldById.get(fieldId)?.name ?? fieldId;

  const resolveFieldId = (
    fieldId: string,
    kind: Exclude<
      PivotInvalidReference['kind'],
      'ambiguousDuplicateHeader' | 'calculatedFieldFormula'
    >,
    path: string,
    source: string,
    area?: string,
    identifier = oldFieldName(fieldId),
  ): string | null => {
    if (calculatedFieldIds.has(fieldId)) {
      return fieldId;
    }
    const fieldName = oldFieldName(fieldId);
    const candidates = newFieldsByName.get(fieldName) ?? [];
    if (candidates.length === 1) {
      return candidates[0].id;
    }
    if (candidates.length > 1) {
      invalidReferences.push({
        kind: 'ambiguousDuplicateHeader',
        path,
        source,
        identifier,
        fieldName,
        area,
        oldResolution: oldFieldsById.get(fieldId),
        newResolution: candidates,
        candidates: describeCandidates(candidates),
      });
    } else {
      invalidReferences.push({
        kind,
        path,
        source,
        fieldId,
        fieldName,
        area,
        identifier,
        oldResolution: oldFieldsById.get(fieldId),
      });
    }
    return null;
  };

  const invalidCalculatedFieldIds = new Set<string>();
  for (const calculatedField of calculatedFields) {
    for (const oldField of oldFields) {
      const escaped = oldField.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`\\b${escaped}\\b`).test(calculatedField.formula)) continue;
      const candidates = newFieldsByName.get(oldField.name) ?? [];
      if (candidates.length !== 1) {
        for (const id of calculatedFieldKeys(calculatedField)) {
          invalidCalculatedFieldIds.add(id);
        }
        invalidReferences.push({
          kind: 'calculatedFieldFormula',
          path: `calculatedFields.${calculatedField.calculatedFieldId ?? calculatedField.fieldId}`,
          source: 'calculatedFieldFormula',
          identifier: calculatedField.formula,
          fieldName: oldField.name,
          candidates: describeCandidates(candidates),
        });
      }
    }
  }

  const placements: PivotFieldPlacement[] = [];
  for (let index = 0; index < config.placements.length; index++) {
    const placement = config.placements[index];
    const path = `placements[${index}]`;
    const sortByValue = placement.sortByValue;
    const placementFieldId = placement.fieldId;
    const placementCalculatedFieldId = placement.calculatedFieldId;
    if (sortByValue?.valueFieldId) {
      resolveFieldId(
        sortByValue.valueFieldId,
        'sortByValueField',
        `${path}.sortByValue.valueFieldId`,
        'sortByValue',
        placement.area,
      );
    }
    const baseField = placement.showValuesAs?.baseField;
    if (baseField) {
      resolveFieldId(
        baseField,
        'showValuesAsBaseField',
        `${path}.showValuesAs.baseField`,
        'showValuesAs',
        placement.area,
      );
    }
    const invalidCalculatedFieldId =
      [placementFieldId, placementCalculatedFieldId].find(
        (id) => typeof id === 'string' && invalidCalculatedFieldIds.has(id),
      ) ?? null;
    if (invalidCalculatedFieldId) {
      invalidReferences.push({
        kind: 'calculatedField',
        path,
        source: 'placement',
        fieldId: invalidCalculatedFieldId,
        fieldName: oldFieldName(invalidCalculatedFieldId),
        area: placement.area,
        identifier:
          calculatedFieldById.get(invalidCalculatedFieldId)?.formula ??
          oldFieldName(invalidCalculatedFieldId),
      });
      continue;
    }

    const validCalculatedFieldId = [placementFieldId, placementCalculatedFieldId].find(
      (id) => typeof id === 'string' && calculatedFieldIds.has(id),
    );
    if (validCalculatedFieldId) {
      placements.push(placement);
      continue;
    }

    const mappedFieldId = resolveFieldId(
      placementFieldId,
      'placement',
      path,
      'placement',
      placement.area,
    );
    if (!mappedFieldId) continue;
    const mappedPlacement: PivotFieldPlacement = {
      ...placement,
      fieldId: mappedFieldId,
    };
    if (sortByValue?.valueFieldId) {
      const mappedValueFieldId = resolveFieldId(
        sortByValue.valueFieldId,
        'sortByValueField',
        `${path}.sortByValue.valueFieldId`,
        'sortByValue',
        placement.area,
      );
      if (mappedValueFieldId) {
        mappedPlacement.sortByValue = { ...sortByValue, valueFieldId: mappedValueFieldId };
      }
    }
    if (baseField && placement.showValuesAs) {
      const mappedBaseField = resolveFieldId(
        baseField,
        'showValuesAsBaseField',
        `${path}.showValuesAs.baseField`,
        'showValuesAs',
        placement.area,
      );
      if (mappedBaseField) {
        mappedPlacement.showValuesAs = { ...placement.showValuesAs, baseField: mappedBaseField };
      }
    }
    placements.push(mappedPlacement);
  }

  const filters: PivotFilter[] = [];
  for (let index = 0; index < config.filters.length; index++) {
    const filter = config.filters[index];
    const path = `filters[${index}]`;
    const topBottom = filter.topBottom;
    if (topBottom?.valueFieldId) {
      resolveFieldId(
        topBottom.valueFieldId,
        'topBottomValueField',
        `${path}.topBottom.valueFieldId`,
        'filter',
      );
    }
    const mappedFieldId = resolveFieldId(filter.fieldId, 'filterField', path, 'filter');
    if (!mappedFieldId) continue;
    const mappedFilter: PivotFilter = { ...filter, fieldId: mappedFieldId };
    if (topBottom?.valueFieldId) {
      const mappedValueFieldId = resolveFieldId(
        topBottom.valueFieldId,
        'topBottomValueField',
        `${path}.topBottom.valueFieldId`,
        'filter',
      );
      if (mappedValueFieldId) {
        mappedFilter.topBottom = { ...topBottom, valueFieldId: mappedValueFieldId };
      }
    }
    filters.push(mappedFilter);
  }

  if (invalidReferences.length > 0) {
    throw createPivotUnresolvedFieldReferencesError({
      pivotName,
      dataSource,
      invalidReferences,
    });
  }

  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { sourceSheetName, sourceRange, fields, placements, filters },
    { reason: 'sourceRangeChanged', refreshPolicy: 'dirtyOnly' },
  );
}
