import type { ImportedPivotViewRecord } from '@mog-sdk/contracts/bridges';
import type { CellValue } from '@mog-sdk/contracts/core';
import type {
  CalculatedFieldId,
  PivotField,
  PivotFieldItems,
  PivotMemberKey,
  PivotTableConfig,
  PivotTableResult,
  PivotTupleKey,
} from '@mog-sdk/contracts/pivot';
import type {
  CalculatedField as ComputeCalculatedField,
  PivotColumnHeader as ComputePivotColumnHeader,
  PivotField as ComputePivotField,
  PivotFieldItems as ComputePivotFieldItems,
  PivotFieldPlacementFlat as ComputePivotFieldPlacementFlat,
  PivotHeader as ComputePivotHeader,
  ImportedPivotViewRecord as ComputeImportedPivotViewRecord,
  PivotItemInfo as ComputePivotItemInfo,
  PivotMeasureDescriptor as ComputePivotMeasureDescriptor,
  PivotMemberKey as ComputePivotMemberKey,
  PivotRow as ComputePivotRow,
  PivotTableConfig as ComputePivotTableConfig,
  PivotTableResult as ComputePivotTableResult,
  PivotTupleKey as ComputePivotTupleKey,
  PivotValueRecord as ComputePivotValueRecord,
} from './compute/compute-types.gen';
import { cleanPivotFormula, displayPivotFormula } from '../domain/pivots/identifiers';
import {
  getBridgePlacementId,
  placementId,
  pivotTupleKey,
  type PublicPivotPlacement,
} from './pivot-bridge-placement';

type PublicPivotHeader = PivotTableResult['rows'][number]['headers'][number];
type PublicPivotItem = PivotFieldItems['items'][number];
type PublicPivotMeasureDescriptor = NonNullable<PivotTableResult['measureDescriptors']>[number];
type PublicPivotValueRecord = NonNullable<PivotTableResult['valueRecords']>[number];
type PublicPivotQueryRecord = NonNullable<PivotTableResult['records']>[number];
type PublicCalculatedField = NonNullable<PivotTableConfig['calculatedFields']>[number];

type ComputePivotPlacementWithTransportFields = ComputePivotFieldPlacementFlat & {
  placementId?: string;
  calculatedFieldId?: string;
};
type ComputeSortByValueWithPlacement = NonNullable<
  ComputePivotFieldPlacementFlat['sortByValue']
> & {
  valuePlacementId?: string;
};
type ComputePivotHeaderWithPlacement = ComputePivotHeader & { axisPlacementId?: string };
type ComputePivotItemWithPlacement = ComputePivotItemInfo & { axisPlacementId?: string };
type ComputePivotMemberKeyLike = string | ComputePivotMemberKey;
type ComputePivotTupleKeyLike =
  | string
  | (Omit<ComputePivotTupleKey, 'members'> & { members: ComputePivotMemberKeyLike[] });
type ComputePivotValueRecordLike = Omit<ComputePivotValueRecord, 'rowKey' | 'columnKey'> & {
  rowKey: ComputePivotTupleKeyLike;
  columnKey: ComputePivotTupleKeyLike;
};
type ComputePivotRowWithValueRecords = ComputePivotRow & {
  valueRecords?: ComputePivotValueRecordLike[];
};
type ComputePivotMeasureDescriptorLike = Omit<ComputePivotMeasureDescriptor, 'source'> & {
  source:
    | { type: 'field'; fieldId: string }
    | { type: 'calculatedField'; calculatedFieldId: string };
};
type ComputeCalculatedFieldLike = ComputeCalculatedField & {
  calculatedFieldId?: string;
  status?: PublicCalculatedField extends { status?: infer Status } ? Status : never;
  createdAt?: string;
  updatedAt?: string;
};

function calculatedFieldId(value: string): CalculatedFieldId {
  return value as CalculatedFieldId;
}

function pivotMemberKey(value: string): PivotMemberKey {
  return value as PivotMemberKey;
}

function toComputePivotField(field: PivotField): ComputePivotField {
  return {
    id: field.id,
    name: field.name,
    sourceColumn: field.sourceColumn,
    dataType: field.dataType,
  };
}

export function toPublicPivotField(field: ComputePivotField): PivotField {
  return {
    id: field.id,
    name: field.name,
    sourceColumn: field.sourceColumn,
    dataType: field.dataType,
  };
}

function toComputeCalculatedField(field: PublicCalculatedField): ComputeCalculatedField {
  const fieldId =
    'fieldId' in field && typeof field.fieldId === 'string'
      ? field.fieldId
      : field.calculatedFieldId;
  if (!fieldId) {
    throw new Error(`Calculated pivot field "${field.name}" is missing a stable field id`);
  }
  return {
    fieldId,
    name: field.name,
    formula: cleanPivotFormula(field.formula),
  };
}

function toPublicCalculatedField(field: ComputeCalculatedField): PublicCalculatedField {
  const source = field as ComputeCalculatedFieldLike;
  const converted: PublicCalculatedField = {
    fieldId: source.fieldId,
    name: source.name,
    formula: displayPivotFormula(source.formula),
  };
  if (source.calculatedFieldId) {
    converted.calculatedFieldId = calculatedFieldId(source.calculatedFieldId);
  }
  if (source.status) {
    converted.status = source.status;
  }
  if (source.createdAt) {
    converted.createdAt = source.createdAt;
  }
  if (source.updatedAt) {
    converted.updatedAt = source.updatedAt;
  }
  return converted;
}

function toComputePivotPlacement(placement: PublicPivotPlacement): ComputePivotFieldPlacementFlat {
  const computePlacement: ComputePivotFieldPlacementFlat = {
    placementId: getBridgePlacementId(placement),
    fieldId: placement.fieldId,
    area: placement.area,
    position: placement.position,
  };
  if (placement.calculatedFieldId) {
    computePlacement.calculatedFieldId = placement.calculatedFieldId;
  }
  if (placement.aggregateFunction) {
    computePlacement.aggregateFunction = placement.aggregateFunction;
  }
  if (placement.sortOrder) {
    computePlacement.sortOrder = placement.sortOrder;
  }
  if (placement.customSortList) {
    computePlacement.customSortList = placement.customSortList;
  }
  if (placement.sortByValue) {
    const sortByValue: ComputeSortByValueWithPlacement = {
      valueFieldId: placement.sortByValue.valueFieldId,
      order: placement.sortByValue.order,
      columnKey: placement.sortByValue.columnKey ?? placement.sortByValue.columnTupleKey,
    };
    if (placement.sortByValue.valuePlacementId) {
      sortByValue.valuePlacementId = placement.sortByValue.valuePlacementId;
    }
    computePlacement.sortByValue = sortByValue;
  }
  if (placement.dateGrouping) {
    computePlacement.dateGrouping = placement.dateGrouping;
  }
  if (placement.numberGrouping) {
    computePlacement.numberGrouping = placement.numberGrouping;
  }
  if (placement.showSubtotals !== undefined) {
    computePlacement.showSubtotals = placement.showSubtotals;
  }
  if (placement.displayName) {
    computePlacement.displayName = placement.displayName;
  }
  if (placement.numberFormat) {
    computePlacement.numberFormat = placement.numberFormat;
  }
  if (placement.showValuesAs) {
    computePlacement.showValuesAs = placement.showValuesAs;
  }
  return computePlacement;
}

function toPublicPivotPlacement(placement: ComputePivotFieldPlacementFlat): PublicPivotPlacement {
  const source = placement as ComputePivotPlacementWithTransportFields;
  const converted: PublicPivotPlacement = {
    placementId: placementId(
      source.placementId ?? `${source.area}:${source.fieldId}:${source.position}`,
    ),
    fieldId: source.fieldId,
    area: source.area,
    position: source.position,
  };
  if (source.calculatedFieldId) {
    converted.calculatedFieldId = calculatedFieldId(source.calculatedFieldId);
  }
  if (source.aggregateFunction) {
    converted.aggregateFunction = source.aggregateFunction;
  }
  if (source.sortOrder) {
    converted.sortOrder = source.sortOrder;
  }
  if (source.customSortList) {
    converted.customSortList = source.customSortList;
  }
  if (source.sortByValue) {
    const sortByValue = source.sortByValue as ComputeSortByValueWithPlacement;
    converted.sortByValue = {
      valueFieldId: sortByValue.valueFieldId,
      valuePlacementId: placementId(sortByValue.valuePlacementId ?? sortByValue.valueFieldId),
      order: sortByValue.order,
      columnKey: sortByValue.columnKey,
      columnTupleKey: sortByValue.columnKey ? pivotTupleKey(sortByValue.columnKey) : undefined,
    };
  }
  if (source.dateGrouping) {
    converted.dateGrouping = source.dateGrouping;
  }
  if (source.numberGrouping) {
    converted.numberGrouping = source.numberGrouping;
  }
  if (source.showSubtotals !== undefined) {
    converted.showSubtotals = source.showSubtotals;
  }
  if (source.displayName) {
    converted.displayName = source.displayName;
  }
  if (source.numberFormat) {
    converted.numberFormat = source.numberFormat;
  }
  if (source.showValuesAs) {
    converted.showValuesAs = source.showValuesAs;
  }
  return converted;
}

export function toComputePivotConfig(config: PivotTableConfig): ComputePivotTableConfig {
  const fields = Array.isArray(config.fields)
    ? config.fields.map(toComputePivotField)
    : config.fields;
  const placements = Array.isArray(config.placements)
    ? config.placements.map(toComputePivotPlacement)
    : config.placements;
  const calculatedFields = Array.isArray(config.calculatedFields)
    ? config.calculatedFields.map(toComputeCalculatedField)
    : config.calculatedFields;

  return {
    schemaVersion: config.schemaVersion,
    id: config.id,
    name: config.name,
    sourceSheetId: config.sourceSheetId,
    sourceSheetName: config.sourceSheetName,
    sourceRange: config.sourceRange,
    outputSheetId: config.outputSheetId,
    outputSheetName: config.outputSheetName,
    outputLocation: config.outputLocation,
    fields,
    placements,
    filters: config.filters,
    layout: config.layout,
    style: config.style,
    dataOptions: config.dataOptions,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    calculatedFields,
    allowMultipleFiltersPerField: config.allowMultipleFiltersPerField,
    autoFormat: config.autoFormat,
    preserveFormatting: config.preserveFormatting,
    cacheId: config.cacheId,
    dataOnRows: config.dataOnRows,
    refRange: config.refRange,
    firstDataRow: config.firstDataRow,
    firstHeaderRow: config.firstHeaderRow,
    firstDataCol: config.firstDataCol,
    rowsPerPage: config.rowsPerPage,
    colsPerPage: config.colsPerPage,
    rowItems: config.rowItems ?? [],
    colItems: config.colItems ?? [],
  };
}

export function toPublicPivotConfig(config: ComputePivotTableConfig): PivotTableConfig {
  return {
    schemaVersion: config.schemaVersion,
    id: config.id,
    name: config.name,
    sourceSheetId: config.sourceSheetId,
    sourceSheetName: config.sourceSheetName,
    sourceRange: config.sourceRange,
    outputSheetId: config.outputSheetId,
    outputSheetName: config.outputSheetName,
    outputLocation: config.outputLocation,
    fields: config.fields.map(toPublicPivotField),
    placements: config.placements.map(toPublicPivotPlacement),
    filters: config.filters,
    layout: config.layout,
    style: config.style,
    dataOptions: config.dataOptions,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    calculatedFields: config.calculatedFields?.map(toPublicCalculatedField),
    allowMultipleFiltersPerField: config.allowMultipleFiltersPerField,
    autoFormat: config.autoFormat,
    preserveFormatting: config.preserveFormatting,
    cacheId: config.cacheId,
    dataOnRows: config.dataOnRows,
    refRange: config.refRange,
    firstDataRow: config.firstDataRow,
    firstHeaderRow: config.firstHeaderRow,
    firstDataCol: config.firstDataCol,
    rowsPerPage: config.rowsPerPage,
    colsPerPage: config.colsPerPage,
    rowItems: config.rowItems,
    colItems: config.colItems,
  };
}

function stringifyCellValue(value: CellValue): string {
  if (value === null) return '';
  if (typeof value === 'object') {
    return 'message' in value && typeof value.message === 'string' ? value.message : value.type;
  }
  return String(value);
}

function computeMemberKeyToString(member: ComputePivotMemberKeyLike): string {
  if (typeof member === 'string') {
    return member;
  }
  return JSON.stringify([member.placementId, member.fieldId ?? null, member.value]);
}

function computeTupleKeyToString(key: ComputePivotTupleKeyLike): string {
  if (typeof key === 'string') {
    return key;
  }
  if (key.isGrandTotal) {
    return key.members.length > 0
      ? `${key.members.map(computeMemberKeyToString).join('\0')}\0__GRAND_TOTAL__`
      : '__GRAND_TOTAL__';
  }
  if (key.isSubtotal) {
    return `${key.members.map(computeMemberKeyToString).join('\0')}\0__SUBTOTAL__`;
  }
  return key.members.map(computeMemberKeyToString).join('\0');
}

function computeMemberToPublicRef(
  member: ComputePivotMemberKeyLike,
): PublicPivotQueryRecord['values'][number]['rowMemberPath'][number] {
  if (typeof member === 'string') {
    return {
      key: pivotMemberKey(member),
      value: member,
      displayText: member,
    };
  }
  return {
    key: pivotMemberKey(computeMemberKeyToString(member)),
    value: member.value,
    displayText: stringifyCellValue(member.value),
    fieldId: member.fieldId,
  };
}

function computeTupleToMemberRefs(
  key: ComputePivotTupleKeyLike,
): PublicPivotQueryRecord['values'][number]['rowMemberPath'] {
  return typeof key === 'string' ? [] : key.members.map(computeMemberToPublicRef);
}

function computeTupleToDimensions(key: ComputePivotTupleKeyLike): Record<string, CellValue> {
  const dimensions: Record<string, CellValue> = {};
  if (typeof key === 'string') {
    return dimensions;
  }
  for (const member of key.members) {
    if (typeof member !== 'string' && member.fieldId) {
      dimensions[member.fieldId] = member.value;
    }
  }
  return dimensions;
}

function inferTotalScope(
  rowKey: ComputePivotTupleKeyLike,
  columnKey: ComputePivotTupleKeyLike,
): PublicPivotQueryRecord['values'][number]['totalScope'] {
  const rowGrandTotal = typeof rowKey !== 'string' && rowKey.isGrandTotal;
  const columnGrandTotal = typeof columnKey !== 'string' && columnKey.isGrandTotal;
  if (rowGrandTotal && columnGrandTotal) return 'cornerGrandTotal';
  if (rowGrandTotal) return 'rowGrandTotal';
  if (columnGrandTotal) return 'columnGrandTotal';
  if (typeof rowKey !== 'string' && rowKey.isSubtotal) return 'rowSubtotal';
  if (typeof columnKey !== 'string' && columnKey.isSubtotal) return 'columnSubtotal';
  return 'none';
}

function toPublicPivotHeader(header: ComputePivotHeader): PublicPivotHeader {
  const source = header as ComputePivotHeaderWithPlacement;
  const converted: PublicPivotHeader = {
    key: pivotMemberKey(source.key),
    value: source.value,
    fieldId: source.fieldId,
    depth: source.depth,
    span: source.span,
    isExpandable: source.isExpandable,
    isExpanded: source.isExpanded,
    isSubtotal: source.isSubtotal,
    isGrandTotal: source.isGrandTotal,
  };
  if (source.axisPlacementId) {
    converted.axisPlacementId = placementId(source.axisPlacementId);
  }
  if (source.parentKey) {
    converted.parentKey = pivotMemberKey(source.parentKey);
  }
  if (source.childKeys) {
    converted.childKeys = source.childKeys.map(pivotMemberKey);
  }
  return converted;
}

function toPublicPivotColumnHeader(
  header: ComputePivotColumnHeader,
): PivotTableResult['columnHeaders'][number] {
  return {
    fieldId: header.fieldId,
    headers: header.headers.map(toPublicPivotHeader),
  };
}

function toPublicPivotValueRecord(record: ComputePivotValueRecord): PublicPivotValueRecord {
  const source = record as ComputePivotValueRecordLike;
  return {
    rowKey: pivotTupleKey(computeTupleKeyToString(source.rowKey)),
    columnKey: pivotTupleKey(computeTupleKeyToString(source.columnKey)),
    measureIndex: source.measureIndex,
    value: source.value,
    sourceRowIndices: source.sourceRowIndices,
  };
}

function toPublicPivotRow(row: ComputePivotRow): PivotTableResult['rows'][number] {
  const source = row as ComputePivotRowWithValueRecords;
  return {
    key: pivotTupleKey(source.key),
    headers: source.headers.map(toPublicPivotHeader),
    values: source.values,
    valueRecords: source.valueRecords?.map((record) =>
      toPublicPivotValueRecord(record as ComputePivotValueRecord),
    ),
    depth: source.depth,
    isSubtotal: source.isSubtotal,
    isGrandTotal: source.isGrandTotal,
    sourceRowIndices: source.sourceRowIndices,
  };
}

function toPublicPivotMeasureDescriptor(
  descriptor: ComputePivotMeasureDescriptor,
): PublicPivotMeasureDescriptor {
  const source = descriptor as ComputePivotMeasureDescriptorLike;
  return {
    placementId: placementId(source.placementId),
    source:
      source.source.type === 'calculatedField'
        ? {
            type: 'calculatedField',
            calculatedFieldId: calculatedFieldId(source.source.calculatedFieldId),
          }
        : { type: 'field', fieldId: source.source.fieldId },
    aggregateFunction: source.aggregateFunction,
    name: source.name,
    numberFormat: source.numberFormat,
  };
}

function buildPublicQueryRecords(
  sourceRecords: readonly ComputePivotValueRecord[],
  measureDescriptors: readonly PublicPivotMeasureDescriptor[],
): PublicPivotQueryRecord[] | undefined {
  if (sourceRecords.length === 0) {
    return undefined;
  }

  const grouped = new Map<string, PublicPivotQueryRecord>();
  for (const record of sourceRecords) {
    const source = record as ComputePivotValueRecordLike;
    const rowKey = pivotTupleKey(computeTupleKeyToString(source.rowKey));
    const columnKey = pivotTupleKey(computeTupleKeyToString(source.columnKey));
    const groupKey = `${rowKey}\u0001${columnKey}`;
    const existing = grouped.get(groupKey);
    const queryRecord = existing ?? {
      dimensions: {
        ...computeTupleToDimensions(source.rowKey),
        ...computeTupleToDimensions(source.columnKey),
      },
      rowKey,
      columnKey,
      values: [],
    };
    const descriptor = measureDescriptors[source.measureIndex];
    queryRecord.values.push({
      measurePlacementId: descriptor?.placementId ?? placementId(`measure:${source.measureIndex}`),
      rowMemberPath: computeTupleToMemberRefs(source.rowKey),
      columnMemberPath: computeTupleToMemberRefs(source.columnKey),
      totalScope: inferTotalScope(source.rowKey, source.columnKey),
      rawValue: source.value,
    });
    if (!existing) {
      grouped.set(groupKey, queryRecord);
    }
  }
  return [...grouped.values()];
}

export function toPublicPivotTableResult(result: ComputePivotTableResult): PivotTableResult {
  const measureDescriptors = result.measureDescriptors?.map(toPublicPivotMeasureDescriptor) ?? [];
  const sourceValueRecords = result.valueRecords ?? [];
  const valueRecords = sourceValueRecords.map(toPublicPivotValueRecord);
  return {
    columnHeaders: result.columnHeaders.map(toPublicPivotColumnHeader),
    rows: result.rows.map(toPublicPivotRow),
    records: buildPublicQueryRecords(sourceValueRecords, measureDescriptors),
    grandTotals: result.grandTotals,
    sourceRowCount: result.sourceRowCount,
    renderedBounds: result.renderedBounds,
    measureDescriptors,
    valueRecords,
    errors: result.errors,
  };
}

export function toPublicImportedPivotViewRecord(
  record: ComputeImportedPivotViewRecord,
): ImportedPivotViewRecord {
  const sourceKind =
    record.sourceKind === 'promotedImport' ? 'promotedImport' : 'unsupportedImport';
  return {
    sourceKind,
    status: record.status,
    importIdentity: record.importIdentity,
    outputSheetId: record.outputSheetId,
    sourceSheetId: record.sourceSheetId,
    config: toPublicPivotConfig(record.config),
    result: record.result ? toPublicPivotTableResult(record.result) : undefined,
    capabilities: record.capabilities,
    unsupportedReason: record.unsupportedReason,
    renderedRange: record.renderedRange,
  };
}

function toPublicPivotItem(item: ComputePivotItemInfo): PublicPivotItem | null {
  if (item.area === 'value') {
    return null;
  }
  const source = item as ComputePivotItemWithPlacement;
  const converted: PublicPivotItem = {
    key: pivotMemberKey(source.key),
    value: source.value,
    fieldId: source.fieldId,
    area: source.area,
    depth: source.depth,
    isExpandable: source.isExpandable,
    isExpanded: source.isExpanded,
    isVisible: source.isVisible,
    isSubtotal: source.isSubtotal,
    isGrandTotal: source.isGrandTotal,
  };
  if (source.axisPlacementId) {
    converted.axisPlacementId = placementId(source.axisPlacementId);
  }
  if (source.childKeys) {
    converted.childKeys = source.childKeys.map(pivotMemberKey);
  }
  if (source.parentKey) {
    converted.parentKey = pivotMemberKey(source.parentKey);
  }
  return converted;
}

export function toPublicPivotFieldItems(
  fieldItems: ComputePivotFieldItems,
): PivotFieldItems | null {
  if (fieldItems.area === 'value') {
    return null;
  }
  return {
    fieldId: fieldItems.fieldId,
    fieldName: fieldItems.fieldName,
    area: fieldItems.area,
    items: fieldItems.items.flatMap((item) => {
      const converted = toPublicPivotItem(item);
      return converted ? [converted] : [];
    }),
  };
}
