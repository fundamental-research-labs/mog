/**
 * Pivot Bridge
 *
 * Connects the UI layer to the Rust pivot engine,
 * delegating transport to ComputeBridge.
 *
 * Handles:
 * - CRUD operations via ComputeBridge (Rust-backed)
 * - Computing pivot table results from source data via ComputeBridge
 * - Caching computed results
 * - Automatic recomputation on source data or config changes
 * - Providing source data via DocumentContext to the Rust engine
 *
 * All config state lives in Rust — the former PivotStore has been deleted.
 */

import type {
  ImportedPivotViewRecord,
  IPivotBridge,
  PivotCacheStats,
} from '@mog-sdk/contracts/bridges';
import { type CellValue, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  CellChangedEvent,
  CellsBatchChangedEvent,
  PivotEvent,
  PivotUpdateOptions,
} from '@mog-sdk/contracts/events';
import type {
  AggregateFunction as ApiAggregateFunction,
  CalculatedFieldId,
  PivotFieldArea as ApiPivotFieldArea,
  PivotExpansionState,
  PivotField,
  PivotFieldItems,
  PivotKernelMutationReceipt,
  PivotMemberKey,
  PivotPlacementMutationReceipt,
  PivotTableConfig,
  PivotTableResult,
  PivotTupleKey,
  PlacementId,
  ShowValuesAsConfig as ApiShowValuesAsConfig,
  SortOrder,
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
import type { DocumentContext } from '../context/types';
import { normalizeCellValue } from '../api/internal/value-conversions';
import { getOrder as getSheetOrder } from '../domain/sheets/sheet-meta';
import { cleanPivotFormula, displayPivotFormula } from '../domain/pivots/identifiers';
import {
  automaticPivotValuePlacementDisplayName,
  valuePlacementWithAggregate,
} from '../domain/pivots/value-labels';
import { extractMutationData } from './compute/compute-core';

type PublicPivotPlacement = PivotTableConfig['placements'][number];
type PublicPivotHeader = PivotTableResult['rows'][number]['headers'][number];
type PublicPivotItem = PivotFieldItems['items'][number];
type PublicPivotMeasureDescriptor = NonNullable<PivotTableResult['measureDescriptors']>[number];
type PublicPivotValueRecord = NonNullable<PivotTableResult['valueRecords']>[number];
type PublicPivotQueryRecord = NonNullable<PivotTableResult['records']>[number];
type PublicCalculatedField = NonNullable<PivotTableConfig['calculatedFields']>[number];
type PivotBridgePlacementSpec = {
  placementId?: PlacementId;
  fieldId?: string;
  area: ApiPivotFieldArea;
  position?: number;
  source?:
    | { type: 'field'; fieldId: string }
    | { type: 'calculatedField'; calculatedFieldId: CalculatedFieldId };
  aggregateFunction?: ApiAggregateFunction;
  sortOrder?: SortOrder;
  displayName?: string;
  showValuesAs?: ApiShowValuesAsConfig;
  numberFormat?: string;
};
type PivotBridgePlacementPatch = Partial<
  Omit<PivotBridgePlacementSpec, 'placementId' | 'area' | 'source'>
>;
type PivotBridgeInternalPlacementPatch = PivotBridgePlacementPatch &
  Partial<Pick<PublicPivotPlacement, 'sortByValue'>>;

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

function pivotUsesSourceSheet(
  pivot: PivotTableConfig,
  sourceSheetId: SheetId,
  sourceName: string | null,
): boolean {
  if (pivot.sourceSheetId) {
    return pivot.sourceSheetId === sourceSheetId;
  }
  return sourceName !== null && pivot.sourceSheetName === sourceName;
}

function sourceChangesAffectPivot(
  changes: readonly { row: number; col: number }[] | undefined,
  pivot: PivotTableConfig,
): boolean {
  if (!changes) {
    return true;
  }
  const range = pivot.sourceRange;
  return changes.some(
    ({ row, col }) =>
      row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol,
  );
}

function placementId(value: string): PlacementId {
  return value as PlacementId;
}

function calculatedFieldId(value: string): CalculatedFieldId {
  return value as CalculatedFieldId;
}

function pivotMemberKey(value: string): PivotMemberKey {
  return value as PivotMemberKey;
}

function pivotTupleKey(value: string): PivotTupleKey {
  return value as PivotTupleKey;
}

function getBridgePlacementId(placement: PublicPivotPlacement): PlacementId {
  return (
    placement.placementId ??
    placementId(`${placement.area}:${placement.fieldId}:${placement.position}`)
  );
}

function createStablePlacementId(
  pivotId: string,
  area: ApiPivotFieldArea,
  fieldId: string,
  position: number,
  existingPlacements: readonly PublicPivotPlacement[],
): PlacementId {
  const existing = new Set(existingPlacements.map((placement) => getBridgePlacementId(placement)));
  const base = `${pivotId}:${area}:${fieldId}:${position}`;
  if (!existing.has(placementId(base))) {
    return placementId(base);
  }
  let suffix = 1;
  while (existing.has(placementId(`${base}:${suffix}`))) {
    suffix += 1;
  }
  return placementId(`${base}:${suffix}`);
}

function getPlacementCalculatedFieldId(
  placement: PublicPivotPlacement | PivotBridgePlacementSpec,
): CalculatedFieldId | undefined {
  if ('calculatedFieldId' in placement && typeof placement.calculatedFieldId === 'string') {
    return placement.calculatedFieldId;
  }
  if ('source' in placement && placement.source?.type === 'calculatedField') {
    return placement.source.calculatedFieldId;
  }
  return undefined;
}

function toPublicSortOrder(sortOrder: SortOrder | undefined): PublicPivotPlacement['sortOrder'] {
  return sortOrder === 'none' ? undefined : sortOrder;
}

function normalizePlacementPatch(
  patch: PivotBridgeInternalPlacementPatch,
): Partial<PublicPivotPlacement> {
  const { sortOrder, ...rest } = patch;
  const normalized: Partial<PublicPivotPlacement> = { ...rest };
  if ('sortOrder' in patch) {
    normalized.sortOrder = toPublicSortOrder(sortOrder);
  }
  return normalized;
}

function placementsInArea(
  placements: readonly PublicPivotPlacement[],
  area: ApiPivotFieldArea,
): PublicPivotPlacement[] {
  return placements
    .map((placement, originalIndex) => ({ placement, originalIndex }))
    .filter(({ placement }) => placement.area === area)
    .sort(
      (left, right) =>
        left.placement.position - right.placement.position ||
        left.originalIndex - right.originalIndex,
    )
    .map(({ placement }) => ({ ...placement }));
}

function renumberPlacements(placements: PublicPivotPlacement[]): PublicPivotPlacement[] {
  return placements.map((placement, position) => ({ ...placement, position }));
}

function clampPlacementPosition(position: number, length: number): number {
  if (!Number.isFinite(position)) return length;
  return Math.max(0, Math.min(Math.trunc(position), length));
}

function toComputePivotField(field: PivotField): ComputePivotField {
  return {
    id: field.id,
    name: field.name,
    sourceColumn: field.sourceColumn,
    dataType: field.dataType,
  };
}

function toPublicPivotField(field: ComputePivotField): PivotField {
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

function toComputePivotConfig(config: PivotTableConfig): ComputePivotTableConfig {
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

function toPublicPivotConfig(config: ComputePivotTableConfig): PivotTableConfig {
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

function toPublicPivotTableResult(result: ComputePivotTableResult): PivotTableResult {
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

function toPublicImportedPivotViewRecord(
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

function toPublicPivotFieldItems(fieldItems: ComputePivotFieldItems): PivotFieldItems | null {
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

function buildPivotBridgeReceipt(
  pivotId: string,
  action: string,
  placementId?: PlacementId,
): PivotKernelMutationReceipt {
  return {
    kernelReceiptId: `${pivotId}:${action}:${Date.now()}`,
    pivotId,
    effects: placementId
      ? [{ type: action === 'addPlacement' ? 'placementAdded' : 'placementUpdated', placementId }]
      : [],
    mutationResult: { action },
    updateReason: action,
    refreshPolicy: 'refreshAndMaterialize',
    materialized: true,
    configRevision: Date.now(),
    status: 'applied',
  };
}

// =============================================================================
// Types
// =============================================================================

/**
 * Cached pivot table result with metadata.
 */
interface CachedPivotResult {
  result: PivotTableResult;
  configVersion: number;
  dataVersion: number;
  computedAt: number;
}

/**
 * Callback for pivot result updates.
 */
export type PivotResultCallback = (
  pivotId: string,
  result: PivotTableResult | null,
  error?: string,
) => void;

// =============================================================================
// Pivot Bridge Class
// =============================================================================

/**
 * Bridge between the Rust pivot engine and the UI layer.
 * Manages computation, caching, and reactive updates.
 *
 * All CRUD operations and computation delegate to Rust via ComputeBridge.
 *
 * The former PivotStore has been deleted — all config
 * state now lives in Rust.
 */
export class PivotBridge implements IPivotBridge {
  private ctx: DocumentContext;

  // Cache: pivotId -> cached result
  private cache: Map<string, CachedPivotResult> = new Map();

  // Version tracking for invalidation
  private configVersions: Map<string, number> = new Map();
  private dataVersions: Map<string, number> = new Map();

  // Subscribers for result updates
  private subscribers: Map<string, Set<PivotResultCallback>> = new Map();

  // Unsubscribe functions for event observation
  private eventUnsubscribes: (() => void)[] = [];

  constructor(ctx: DocumentContext) {
    this.ctx = ctx;

    this.setupObservers();
  }

  // ===========================================================================
  // CRUD — Delegated to Rust via ComputeBridge
  // ===========================================================================

  /**
   * Create a new pivot table on a sheet.
   * Delegates to Rust compute engine which generates the ID and timestamps.
   */
  async createPivot(config: PivotTableConfig): Promise<PivotTableConfig> {
    const computeConfig = toComputePivotConfig(config);
    const mutationHandler = this.ctx.computeBridge.getMutationHandler();
    const mutationResult = mutationHandler
      ? await mutationHandler.withPivotUpdateOptions(
          { reason: 'uiConfigChanged', refreshPolicy: 'dirtyOnly' },
          () => this.ctx.computeBridge.pivotCreate(computeConfig),
        )
      : await this.ctx.computeBridge.pivotCreate(computeConfig);
    const result = extractMutationData<ComputePivotTableConfig>(mutationResult);
    if (!result) {
      throw new Error('pivotCreate: no config returned in MutationResult.data');
    }
    const publicResult = toPublicPivotConfig(result);
    // Bump config version for cache invalidation
    const currentVersion = this.configVersions.get(publicResult.id) ?? 0;
    this.configVersions.set(publicResult.id, currentVersion + 1);
    return publicResult;
  }

  /**
   * Get a single pivot table by ID.
   */
  async getPivot(sheetId: SheetId, pivotId: string): Promise<PivotTableConfig | null> {
    const config = await this.ctx.computeBridge.pivotGet(sheetId, pivotId);
    return config ? toPublicPivotConfig(config) : null;
  }

  /**
   * Get all pivot tables displayed on a sheet.
   */
  async getAllPivots(sheetId: SheetId): Promise<PivotTableConfig[]> {
    const configs = await this.ctx.computeBridge.pivotGetAll(sheetId);
    return configs.map(toPublicPivotConfig);
  }

  async getImportedPivotViewRecords(sheetId: SheetId): Promise<ImportedPivotViewRecord[]> {
    const records = await this.ctx.computeBridge.pivotGetImportedViewRecords(sheetId);
    return records.map(toPublicImportedPivotViewRecord);
  }

  /**
   * Update a pivot table configuration by merging partial updates.
   *
   * The Rust bridge expects a full PivotTableConfig (whole-config replace),
   * so we fetch the existing config, merge the caller's partial updates,
   * and send the merged result.
   */
  async updatePivot(
    sheetId: SheetId,
    pivotId: string,
    updates: Partial<PivotTableConfig>,
    options: PivotUpdateOptions,
  ): Promise<PivotTableConfig | null> {
    // Fetch existing config so we can merge partial updates into a full config
    const existingCompute = await this.ctx.computeBridge.pivotGet(sheetId, pivotId);
    if (!existingCompute) {
      return null;
    }

    const existing = toPublicPivotConfig(existingCompute);
    const mergedConfig: PivotTableConfig = { ...existing, ...updates };
    const computeConfig = toComputePivotConfig(mergedConfig);

    const mutationHandler = this.ctx.computeBridge.getMutationHandler();
    const mutationResult = mutationHandler
      ? await mutationHandler.withPivotUpdateOptions(options, () =>
          this.ctx.computeBridge.pivotUpdate(sheetId, pivotId, computeConfig),
        )
      : await this.ctx.computeBridge.pivotUpdate(sheetId, pivotId, computeConfig);
    const result = extractMutationData<ComputePivotTableConfig | null>(mutationResult) ?? null;
    if (result) {
      // Bump config version for cache invalidation
      const currentVersion = this.configVersions.get(pivotId) ?? 0;
      this.configVersions.set(pivotId, currentVersion + 1);
    }
    return result ? toPublicPivotConfig(result) : null;
  }

  private async findPivotLocation(
    pivotId: string,
  ): Promise<{ sheetId: SheetId; config: PivotTableConfig }> {
    const sheetIds = await this.ctx.computeBridge.getAllSheetIds();
    for (const id of sheetIds) {
      const sheetId = toSheetId(id as string);
      const config = await this.ctx.computeBridge.pivotGet(sheetId, pivotId);
      if (config) return { sheetId, config: toPublicPivotConfig(config) };
    }
    throw new Error(`Pivot table "${pivotId}" not found`);
  }

  async addPlacement(
    pivotId: string,
    spec: PivotBridgePlacementSpec,
  ): Promise<PivotPlacementMutationReceipt> {
    const { sheetId, config } = await this.findPivotLocation(pivotId);
    const fieldId =
      spec.fieldId ??
      (spec.source?.type === 'field' ? spec.source.fieldId : undefined) ??
      getPlacementCalculatedFieldId(spec);
    if (!fieldId) throw new Error('addPlacement: fieldId is required');
    const areaPlacements = placementsInArea(config.placements, spec.area);
    const position = clampPlacementPosition(
      spec.position ?? areaPlacements.length,
      areaPlacements.length,
    );
    const placement: PublicPivotPlacement = {
      placementId:
        spec.placementId ??
        createStablePlacementId(pivotId, spec.area, fieldId, position, config.placements),
      fieldId,
      area: spec.area,
      position,
    };
    const calculatedField = getPlacementCalculatedFieldId(spec);
    if (calculatedField) {
      placement.calculatedFieldId = calculatedField;
    }
    const aggregateFunction = spec.aggregateFunction ?? (spec.area === 'value' ? 'sum' : undefined);
    if (aggregateFunction) {
      placement.aggregateFunction = aggregateFunction;
    }
    const sortOrder = toPublicSortOrder(spec.sortOrder);
    if (sortOrder) {
      placement.sortOrder = sortOrder;
    }
    if (spec.displayName) {
      placement.displayName = spec.displayName;
    }
    if (spec.area === 'value') {
      placement.displayName = automaticPivotValuePlacementDisplayName({
        config,
        placement,
        aggregateFunction,
        displayName: spec.displayName,
      });
    }
    if (spec.showValuesAs) {
      placement.showValuesAs = spec.showValuesAs;
    }
    if (spec.numberFormat) {
      placement.numberFormat = spec.numberFormat;
    }
    areaPlacements.splice(position, 0, placement);
    const placements = [
      ...config.placements.filter((p) => p.area !== spec.area).map((p) => ({ ...p })),
      ...renumberPlacements(areaPlacements),
    ];
    await this.updatePivot(
      sheetId,
      pivotId,
      { placements },
      { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
    const placementId = getBridgePlacementId(placement);
    return {
      ...buildPivotBridgeReceipt(pivotId, 'addPlacement', placementId),
      status: 'applied',
      placementId,
    };
  }

  async updatePlacement(
    pivotId: string,
    placementId: PlacementId,
    patch: PivotBridgeInternalPlacementPatch,
  ): Promise<PivotKernelMutationReceipt> {
    const { sheetId, config } = await this.findPivotLocation(pivotId);
    const normalizedPatch = normalizePlacementPatch(patch);
    const placements = config.placements.map((p) => {
      if (getBridgePlacementId(p) !== placementId) return p;
      if (normalizedPatch.aggregateFunction && p.area === 'value') {
        return {
          ...valuePlacementWithAggregate({
            config,
            placement: p,
            aggregateFunction: normalizedPatch.aggregateFunction,
          }),
          ...normalizedPatch,
        };
      }
      return { ...p, ...normalizedPatch };
    });
    await this.updatePivot(
      sheetId,
      pivotId,
      { placements },
      { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
    return buildPivotBridgeReceipt(pivotId, 'updatePlacement', placementId);
  }

  async removePlacement(
    pivotId: string,
    placementId: PlacementId,
  ): Promise<PivotKernelMutationReceipt> {
    const { sheetId, config } = await this.findPivotLocation(pivotId);
    const removed = config.placements.find((p) => getBridgePlacementId(p) === placementId);
    const placements = config.placements.filter((p) => getBridgePlacementId(p) !== placementId);
    if (removed) {
      let nextPosition = 0;
      for (const p of placements) {
        if (p.area === removed.area) p.position = nextPosition++;
      }
    }
    await this.updatePivot(
      sheetId,
      pivotId,
      { placements },
      { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
    return {
      ...buildPivotBridgeReceipt(pivotId, 'removePlacement'),
      effects: [{ type: 'placementRemoved', placementId }],
    };
  }

  async movePlacement(
    pivotId: string,
    placementId: PlacementId,
    toArea: ApiPivotFieldArea,
    toPosition: number,
  ): Promise<PivotKernelMutationReceipt> {
    const { sheetId, config } = await this.findPivotLocation(pivotId);
    const moving = config.placements.find((p) => getBridgePlacementId(p) === placementId);
    if (!moving) throw new Error(`Pivot placement "${placementId}" not found`);
    const remaining = config.placements.filter((p) => getBridgePlacementId(p) !== placementId);
    const targetPlacements = placementsInArea(remaining, toArea);
    const targetPosition = clampPlacementPosition(toPosition, targetPlacements.length);
    targetPlacements.splice(targetPosition, 0, {
      ...moving,
      placementId: moving.placementId ?? placementId,
      area: toArea,
      position: targetPosition,
    });

    const affectedAreas = new Set<ApiPivotFieldArea>([moving.area, toArea]);
    const placements = [
      ...remaining.filter((p) => !affectedAreas.has(p.area)).map((p) => ({ ...p })),
      ...(moving.area === toArea
        ? []
        : renumberPlacements(placementsInArea(remaining, moving.area))),
      ...renumberPlacements(targetPlacements),
    ];
    await this.updatePivot(
      sheetId,
      pivotId,
      { placements },
      { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
    return buildPivotBridgeReceipt(pivotId, 'movePlacement', placementId);
  }

  async setAggregateFunction(
    pivotId: string,
    placementId: PlacementId,
    aggregateFunction: ApiAggregateFunction,
  ): Promise<PivotKernelMutationReceipt> {
    return this.updatePlacement(pivotId, placementId, { aggregateFunction });
  }

  async setShowValuesAs(
    pivotId: string,
    placementId: PlacementId,
    showValuesAs: ApiShowValuesAsConfig | null,
  ): Promise<PivotKernelMutationReceipt> {
    return this.updatePlacement(pivotId, placementId, { showValuesAs: showValuesAs ?? undefined });
  }

  async renameValuePlacement(
    pivotId: string,
    placementId: PlacementId,
    displayName: string | null,
  ): Promise<PivotKernelMutationReceipt> {
    return this.updatePlacement(pivotId, placementId, { displayName: displayName ?? undefined });
  }

  async setSortOrder(
    pivotId: string,
    placementId: PlacementId,
    sortOrder: SortOrder | null,
  ): Promise<PivotKernelMutationReceipt> {
    return this.updatePlacement(pivotId, placementId, {
      sortOrder: !sortOrder || sortOrder === 'none' ? undefined : sortOrder,
    });
  }

  async setSortByValue(
    pivotId: string,
    axisPlacementId: PlacementId,
    valuePlacementId: PlacementId,
    config: { order: SortOrder; columnKey?: string } | null,
  ): Promise<PivotKernelMutationReceipt> {
    const { config: pivotConfig } = await this.findPivotLocation(pivotId);
    const axisPlacement = pivotConfig.placements.find(
      (placement) => getBridgePlacementId(placement) === axisPlacementId,
    );
    if (!axisPlacement) throw new Error(`Pivot placement "${axisPlacementId}" not found`);
    if (axisPlacement.area !== 'row' && axisPlacement.area !== 'column') {
      throw new Error('setSortByValue: Axis placement must be in the row or column area');
    }

    let sortByValue: PublicPivotPlacement['sortByValue'];
    if (config) {
      const valuePlacement = pivotConfig.placements.find(
        (placement) => getBridgePlacementId(placement) === valuePlacementId,
      );
      if (!valuePlacement) throw new Error(`Pivot placement "${valuePlacementId}" not found`);
      if (valuePlacement.area !== 'value') {
        throw new Error('setSortByValue: Value placement must be in the value area');
      }
      sortByValue = {
        valueFieldId: valuePlacement.fieldId,
        valuePlacementId,
        order: config.order === 'none' ? 'asc' : config.order,
        columnKey: config.columnKey,
        columnTupleKey: config.columnKey ? pivotTupleKey(config.columnKey) : undefined,
      };
    }

    return this.updatePlacement(pivotId, axisPlacementId, {
      sortByValue,
    });
  }

  async resetPlacement(
    pivotId: string,
    placementId: PlacementId,
  ): Promise<PivotKernelMutationReceipt> {
    const { sheetId, config } = await this.findPivotLocation(pivotId);
    const placements = config.placements.map((p) =>
      getBridgePlacementId(p) === placementId
        ? {
            placementId: p.placementId,
            fieldId: p.fieldId,
            calculatedFieldId: p.calculatedFieldId,
            area: p.area,
            position: p.position,
          }
        : p,
    );
    await this.updatePivot(
      sheetId,
      pivotId,
      { placements },
      { reason: 'fieldReset', refreshPolicy: 'refreshAndMaterialize' },
    );
    return buildPivotBridgeReceipt(pivotId, 'resetPlacement', placementId);
  }

  async setExpansion(
    pivotId: string,
    axisPlacementId: PlacementId,
    _memberPath: PivotMemberKey[],
    expanded: boolean,
  ): Promise<PivotKernelMutationReceipt> {
    return {
      ...buildPivotBridgeReceipt(pivotId, 'setExpansion', axisPlacementId),
      mutationResult: { action: 'setExpansion', expanded },
    };
  }

  async toggleExpanded(
    sheetId: SheetId,
    pivotId: string,
    headerKey: string,
    isRow: boolean,
  ): Promise<boolean> {
    const provider = this.ctx.pivotExpansionProvider;
    if (!provider) return true;
    return provider.toggleExpanded(pivotId, headerKey, isRow, sheetId);
  }

  async setAllExpanded(pivotId: string, expanded: boolean): Promise<void> {
    this.ctx.pivotExpansionProvider?.setAllExpanded(pivotId, expanded);
  }

  async getExpansionState(pivotId: string): Promise<PivotExpansionState> {
    return (
      this.ctx.pivotExpansionProvider?.getExpansionState(pivotId) ?? {
        expandedRows: {},
        expandedColumns: {},
      }
    );
  }

  /**
   * Delete a pivot table.
   */
  async deletePivot(sheetId: SheetId, pivotId: string): Promise<boolean> {
    const mutationResult = await this.ctx.computeBridge.pivotDelete(sheetId, pivotId);
    const deleted = extractMutationData<boolean>(mutationResult) ?? false;
    if (deleted) {
      // Bump config version and clear cache for the deleted pivot
      const currentVersion = this.configVersions.get(pivotId) ?? 0;
      this.configVersions.set(pivotId, currentVersion + 1);
      this.cache.delete(pivotId);
    }
    return deleted;
  }

  /**
   * Atomically create a new sheet AND a pivot table on it.
   * Both operations happen in a single transaction for undo atomicity.
   */
  async createPivotWithSheet(
    sheetName: string,
    config: PivotTableConfig,
  ): Promise<{ sheetId: SheetId; config: PivotTableConfig }> {
    const computeConfig = toComputePivotConfig(config);
    const mutationHandler = this.ctx.computeBridge.getMutationHandler();
    const result = mutationHandler
      ? await mutationHandler.withPivotUpdateOptions(
          { reason: 'uiConfigChanged', refreshPolicy: 'dirtyOnly' },
          () => this.ctx.computeBridge.pivotCreateWithSheet(sheetName, computeConfig),
        )
      : await this.ctx.computeBridge.pivotCreateWithSheet(sheetName, computeConfig);
    const publicConfig = toPublicPivotConfig(result.config);
    // Bump config version for cache invalidation
    const currentVersion = this.configVersions.get(publicConfig.id) ?? 0;
    this.configVersions.set(publicConfig.id, currentVersion + 1);
    return { sheetId: result.sheetId, config: publicConfig };
  }

  // ===========================================================================
  // Computation
  // ===========================================================================

  /**
   * Compute a pivot table result without materializing sheet/overlay output.
   * Uses cached pure-read results if available and valid.
   */
  async compute(
    sheetId: SheetId,
    pivotId: string,
    forceRefresh: boolean = false,
  ): Promise<PivotTableResult | null> {
    const configVersion = this.getConfigVersion(pivotId);
    const dataVersion = this.getDataVersion(sheetId);

    // Check cache validity
    if (!forceRefresh) {
      const cached = this.cache.get(pivotId);
      if (cached && cached.configVersion === configVersion && cached.dataVersion === dataVersion) {
        return cached.result;
      }
    }

    // Get expansion state from the provider (fallback: all expanded)
    const expansionState = this.ctx.pivotExpansionProvider?.getExpansionState(pivotId) ?? {
      expandedRows: {},
      expandedColumns: {},
    };

    // Pure compute via Rust engine. This is a read path: it must not materialize
    // output cells, clear dirty state, or notify subscribers with refreshed UI state.
    try {
      const result = toPublicPivotTableResult(
        await this.ctx.computeBridge.pivotComputeFromSource(
          sheetId,
          pivotId,
          expansionState ?? null,
        ),
      );

      // Cache result
      this.cache.set(pivotId, {
        result,
        configVersion,
        dataVersion,
        computedAt: Date.now(),
      });

      return result;
    } catch (error) {
      return null;
    }
  }

  /**
   * Compute all pivot tables in a sheet.
   */
  async computeAll(sheetId: SheetId): Promise<Map<string, PivotTableResult>> {
    const results = new Map<string, PivotTableResult>();
    const pivots = await this.ctx.computeBridge.pivotGetAll(sheetId);

    for (const config of pivots) {
      const result = await this.compute(sheetId, config.id);
      if (result) {
        results.set(config.id, result);
      }
    }

    return results;
  }

  /**
   * Refresh a pivot table by materializing fresh output through the production
   * write path.
   */
  async refresh(sheetId: SheetId, pivotId: string): Promise<PivotTableResult | null> {
    this.invalidateCache(pivotId);

    const expansionState = this.ctx.pivotExpansionProvider?.getExpansionState(pivotId) ?? {
      expandedRows: {},
      expandedColumns: {},
    };
    const configVersion = this.getConfigVersion(pivotId);
    const dataVersion = this.getDataVersion(sheetId);

    try {
      const mutationHandler = this.ctx.computeBridge.getMutationHandler();
      const materialize = () =>
        this.ctx.computeBridge.pivotMaterialize(sheetId, pivotId, expansionState ?? null);
      const result = toPublicPivotTableResult(
        mutationHandler
          ? await mutationHandler.withPivotUpdateOptions(
              { reason: 'sourceRangeChanged', refreshPolicy: 'refreshAndMaterialize' },
              materialize,
            )
          : await materialize(),
      );
      await this.ctx.computeBridge.forceRefreshAllViewports();

      this.cache.set(pivotId, {
        result,
        configVersion,
        dataVersion,
        computedAt: Date.now(),
      });
      this.notifySubscribers(pivotId, result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.notifySubscribers(pivotId, null, errorMessage);
      return null;
    }
  }

  /**
   * Refresh all pivot tables that depend on a sheet's data.
   */
  async refreshDependentPivots(
    sourceSheetId: SheetId,
    changes?: readonly { row: number; col: number }[],
  ): Promise<void> {
    // Increment data version for this sheet
    const currentVersion = this.dataVersions.get(sourceSheetId) ?? 0;
    this.dataVersions.set(sourceSheetId, currentVersion + 1);

    // Resolve name only for legacy configs that predate sourceSheetId.
    const sourceName = await this.ctx.computeBridge.getSheetName(sourceSheetId);

    // Find all pivot tables that use this sheet as source
    const sheetIds = await getSheetOrder(this.ctx);
    for (const sheetId of sheetIds) {
      const pivots = await this.ctx.computeBridge.pivotGetAll(sheetId);
      for (const pivot of pivots) {
        const publicPivot = toPublicPivotConfig(pivot);
        if (
          pivotUsesSourceSheet(publicPivot, sourceSheetId, sourceName) &&
          sourceChangesAffectPivot(changes, publicPivot)
        ) {
          await this.refresh(sheetId, pivot.id);
        }
      }
    }
  }

  async refreshAllPivots(): Promise<void> {
    const sheetIds = await this.ctx.computeBridge.getAllSheetIds();
    for (const sheetIdValue of sheetIds) {
      const sheetId = toSheetId(sheetIdValue as string);
      const pivots = await this.ctx.computeBridge.pivotGetAll(sheetId);
      for (const pivot of pivots) {
        await this.refresh(sheetId, pivot.id);
      }
    }
  }

  // ===========================================================================
  // Field Detection
  // ===========================================================================

  /**
   * Detect fields from source data range.
   */
  async detectFields(
    sourceSheetId: SheetId,
    range: { startRow: number; startCol: number; endRow: number; endCol: number },
  ): Promise<PivotField[]> {
    const data = await this.getDataFromRange(sourceSheetId, range);
    if (!data || data.length === 0) {
      return [];
    }

    const fields = await this.ctx.computeBridge.pivotDetectFields(data);
    return fields.map(toPublicPivotField);
  }

  // ===========================================================================
  // Drill-Down
  // ===========================================================================

  /**
   * Get source row indices for a pivot cell (drill-down).
   */
  async drillDown(
    sheetId: SheetId,
    pivotId: string,
    rowKey: string,
    columnKey: string,
  ): Promise<number[]> {
    const config = await this.ctx.computeBridge.pivotGet(sheetId, pivotId);
    if (!config) {
      return [];
    }

    const data = await this.getSourceData(toPublicPivotConfig(config));
    if (!data) {
      return [];
    }

    return this.ctx.computeBridge.pivotDrillDown(config, data, rowKey, columnKey);
  }

  /**
   * Get actual source rows for a pivot cell.
   */
  async getDrillDownData(
    sheetId: SheetId,
    pivotId: string,
    rowKey: string,
    columnKey: string,
  ): Promise<CellValue[][]> {
    const config = await this.ctx.computeBridge.pivotGet(sheetId, pivotId);
    if (!config) {
      return [];
    }

    const data = await this.getSourceData(toPublicPivotConfig(config));
    if (!data) {
      return [];
    }

    const indices = await this.drillDown(sheetId, pivotId, rowKey, columnKey);
    // indices are into data rows (excluding header), so offset by 1
    return indices.map((i) => data[i + 1]);
  }

  // ===========================================================================
  // Pivot Items
  // ===========================================================================

  /**
   * Get pivot items for all placed non-value fields.
   * Delegates to Rust so item extraction uses the same source-data read and
   * field auto-detection path as pivot materialization.
   */
  async getAllPivotItems(sheetId: SheetId, pivotId: string): Promise<PivotFieldItems[]> {
    const expansionState = this.ctx.pivotExpansionProvider?.getExpansionState(pivotId) ?? {
      expandedRows: {},
      expandedColumns: {},
    };
    const items = await this.ctx.computeBridge.pivotGetAllItems(
      sheetId,
      pivotId,
      expansionState ?? null,
    );
    return items.flatMap((fieldItems) => {
      const converted = toPublicPivotFieldItems(fieldItems);
      return converted ? [converted] : [];
    });
  }

  // ===========================================================================
  // Subscription
  // ===========================================================================

  /**
   * Subscribe to updates for a specific pivot table.
   */
  subscribe(pivotId: string, callback: PivotResultCallback): () => void {
    if (!this.subscribers.has(pivotId)) {
      this.subscribers.set(pivotId, new Set());
    }
    this.subscribers.get(pivotId)!.add(callback);

    return () => {
      const subs = this.subscribers.get(pivotId);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscribers.delete(pivotId);
        }
      }
    };
  }

  /**
   * Get current cached result for a pivot table.
   */
  getCachedResult(pivotId: string): PivotTableResult | null {
    const cached = this.cache.get(pivotId);
    return cached?.result ?? null;
  }

  // ===========================================================================
  // Cache Management
  // ===========================================================================

  /**
   * Invalidate cache for a specific pivot table.
   */
  invalidateCache(pivotId: string): void {
    this.cache.delete(pivotId);
    const currentVersion = this.configVersions.get(pivotId) ?? 0;
    this.configVersions.set(pivotId, currentVersion + 1);
  }

  /**
   * Invalidate all cached results.
   */
  invalidateAllCache(): void {
    this.cache.clear();
    this.configVersions.clear();
    this.dataVersions.clear();
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): PivotCacheStats {
    const now = Date.now();
    const entries: Array<{ pivotId: string; computedAt: number; ageMs: number }> = [];

    this.cache.forEach((cached, pivotId) => {
      entries.push({
        pivotId,
        computedAt: cached.computedAt,
        ageMs: now - cached.computedAt,
      });
    });

    return { size: this.cache.size, entries };
  }

  // ===========================================================================
  // Private: Data Access
  // ===========================================================================

  /**
   * Get source data for a pivot table config.
   */
  private async getSourceData(config: PivotTableConfig): Promise<CellValue[][] | null> {
    if (config.sourceSheetId) {
      return this.getDataFromRange(toSheetId(config.sourceSheetId), config.sourceRange);
    }

    // Legacy fallback: resolve source sheet name to ID for queryRange.
    const sheetIds = await getSheetOrder(this.ctx);
    let sourceId: SheetId | undefined;
    for (const id of sheetIds) {
      const name = await this.ctx.computeBridge.getSheetName(id);
      if (name === config.sourceSheetName) {
        sourceId = id;
        break;
      }
    }
    if (!sourceId) return null;
    return this.getDataFromRange(sourceId, config.sourceRange);
  }

  /**
   * Get data from a cell range.
   * Uses queryRange for bulk cell reading (works in all modes including headless/NAPI).
   */
  private async getDataFromRange(
    sheetId: SheetId,
    range: { startRow: number; startCol: number; endRow: number; endCol: number },
  ): Promise<CellValue[][] | null> {
    const rangeResult = await this.ctx.computeBridge.queryRange(
      sheetId,
      range.startRow,
      range.startCol,
      range.endRow,
      range.endCol,
    );

    const cellMap = new Map<string, (typeof rangeResult.cells)[number]>();
    for (const cell of rangeResult.cells) {
      cellMap.set(`${cell.row},${cell.col}`, cell);
    }

    const data: CellValue[][] = [];
    for (let row = range.startRow; row <= range.endRow; row++) {
      const rowData: CellValue[] = [];
      for (let col = range.startCol; col <= range.endCol; col++) {
        const cell = cellMap.get(`${row},${col}`);
        rowData.push(cell ? (normalizeCellValue(cell.value) ?? null) : null);
      }
      data.push(rowData);
    }

    return data.length > 0 ? data : null;
  }

  // ===========================================================================
  // Private: Version Tracking
  // ===========================================================================

  private getConfigVersion(pivotId: string): number {
    return this.configVersions.get(pivotId) ?? 0;
  }

  private getDataVersion(sheetId: SheetId): number {
    return this.dataVersions.get(sheetId) ?? 0;
  }

  // ===========================================================================
  // Private: Observers
  // ===========================================================================

  private setupObservers(): void {
    // Observe pivot config changes via EventBus (replaces former PivotStore.subscribe)
    const handlePivotChange = (event: PivotEvent) => {
      if (!('pivotId' in event) || !event.pivotId) return;

      this.invalidateCache(event.pivotId);

      if (event.type === 'pivot:deleted') return;

      const shouldMaterialize =
        event.type !== 'pivot:updated' || event.update.refreshPolicy === 'refreshAndMaterialize';
      if (!shouldMaterialize || !('outputSheetId' in event) || !event.outputSheetId) {
        return;
      }

      void this.refresh(toSheetId(event.outputSheetId as string), event.pivotId);
    };

    this.eventUnsubscribes.push(
      this.ctx.eventBus.on('pivot:created', handlePivotChange),
      this.ctx.eventBus.on('pivot:updated', handlePivotChange),
      this.ctx.eventBus.on('pivot:deleted', handlePivotChange),
      this.ctx.eventBus.on('cell:changed', (event: CellChangedEvent) => {
        void this.refreshDependentPivots(toSheetId(event.sheetId), [
          { row: event.row, col: event.col },
        ]);
      }),
      this.ctx.eventBus.on('cells:batch-changed', (event: CellsBatchChangedEvent) => {
        void this.refreshDependentPivots(toSheetId(event.sheetId), event.changes);
      }),
    );
  }

  private notifySubscribers(
    pivotId: string,
    result: PivotTableResult | null,
    error?: string,
  ): void {
    const subs = this.subscribers.get(pivotId);
    if (subs) {
      subs.forEach((callback) => callback(pivotId, result, error));
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.eventUnsubscribes.forEach((unsub) => unsub());
    this.eventUnsubscribes = [];
    this.cache.clear();
    this.subscribers.clear();
  }
}

// PivotBridge instances are managed by React context for proper lifecycle management.
