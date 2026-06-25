import type { VersionSemanticValue } from '@mog-sdk/contracts/api';

import type {
  CellChange,
  FilterChange,
  FloatingObjectAnchor,
  FloatingObjectBounds,
  FloatingObjectChange,
  RangeChange,
} from '../../bridges/compute/compute-types.gen';
import type { DirectEditPosition, DirectEditRange } from '../../bridges/compute/mutation-admission';
import { decodeRangeMetaJson, type RangeMeta } from '../../bridges/wire/range-metadata-cache';
import type { VersionSemanticChangeRecord } from './semantic-mutation-capture-projection';

type SemanticField = { key: string; value: VersionSemanticValue };
type SemanticDisplay = VersionSemanticChangeRecord['display'];

const rangeMetaDecoder = new TextDecoder();
const FLOATING_OBJECT_ANCHOR_FIELDS = [
  'anchorRow',
  'anchorCol',
  'anchorRowOffsetEmu',
  'anchorColOffsetEmu',
  'anchorMode',
  'absoluteXEmu',
  'absoluteYEmu',
  'endRow',
  'endCol',
  'endRowOffsetEmu',
  'endColOffsetEmu',
  'extentCxEmu',
  'extentCyEmu',
] as const;
const FLOATING_OBJECT_BOUNDS_FIELDS = ['x', 'y', 'width', 'height', 'rotation'] as const;
const FLOATING_OBJECT_ANCHOR_CHANGE_FIELDS = new Set<string>([
  'anchor',
  'width',
  'height',
  'bounds',
  ...FLOATING_OBJECT_ANCHOR_FIELDS,
]);
const RANGE_KIND_DOMAINS: Partial<Record<RangeMeta['kind'], string>> = {
  NamedRange: 'named-ranges',
  Table: 'tables',
  CondFormat: 'conditional-formatting',
  Validation: 'data-validation',
  PrintArea: 'print-areas',
  Protection: 'protected-ranges',
};

export function semanticSheetValue(input: {
  readonly name: string;
  readonly index?: number;
  readonly sourceSheetId?: string;
}): VersionSemanticValue {
  const fields: SemanticField[] = [{ key: 'name', value: input.name }];
  if (input.index !== undefined) {
    fields.push({ key: 'index', value: input.index });
  }
  if (input.sourceSheetId !== undefined) {
    fields.push({ key: 'sourceSheetId', value: input.sourceSheetId });
  }
  return semanticObjectValue(fields);
}

export function semanticFilterValue(change: FilterChange): VersionSemanticValue {
  const fields: SemanticField[] = [{ key: 'kind', value: change.kind }];
  pushOptionalSemanticField(fields, 'filterId', change.filterId);
  pushOptionalSemanticField(fields, 'filterKind', change.filterKind);
  pushOptionalSemanticField(fields, 'tableId', change.tableId);
  pushOptionalSemanticField(fields, 'capability', change.capability);
  pushOptionalSemanticField(fields, 'hasActiveFilter', change.hasActiveFilter);
  pushOptionalSemanticField(fields, 'clearable', change.clearable);
  pushOptionalSemanticField(fields, 'action', change.action);
  pushOptionalSemanticField(fields, 'hiddenRowCount', change.hiddenRowCount);
  pushOptionalSemanticField(fields, 'visibleRowCount', change.visibleRowCount);
  if (change.unsupportedReasons?.length) {
    fields.push({
      key: 'unsupportedReasons',
      value: { kind: 'array', values: change.unsupportedReasons },
    });
  }
  return semanticObjectValue(fields);
}

export function semanticChartSourceValue(
  change: FloatingObjectChange,
): VersionSemanticValue | null {
  const objectType = floatingObjectType(change);
  if (objectType !== 'chart') return null;

  const changedFields = floatingObjectChangedFields(change);
  const data = change.data?.type === 'chart' ? change.data : undefined;
  const hasSourceEvidence =
    isStableString(data?.dataRange) ||
    isStableString(data?.seriesRange) ||
    isStableString(data?.categoryRange) ||
    isStableString(data?.sourceTableId) ||
    changedFields.some(isChartSourceField);
  if (!hasSourceEvidence) return null;

  const fields: SemanticField[] = [
    { key: 'kind', value: change.kind.type },
    { key: 'objectId', value: change.objectId },
    { key: 'objectType', value: objectType },
  ];
  pushStringArraySemanticField(fields, 'changedFields', changedFields);
  pushOptionalSemanticField(fields, 'chartType', data?.chartType);
  pushOptionalSemanticField(fields, 'dataRange', data?.dataRange);
  pushOptionalSemanticField(fields, 'seriesRange', data?.seriesRange);
  pushOptionalSemanticField(fields, 'categoryRange', data?.categoryRange);
  pushOptionalSemanticField(fields, 'sourceTableId', data?.sourceTableId);
  pushOptionalSemanticField(fields, 'tableCategoryColumn', data?.tableCategoryColumn);
  pushStringArraySemanticField(fields, 'tableDataColumns', data?.tableDataColumns ?? []);
  pushStringArraySemanticField(fields, 'tableColumnNames', data?.tableColumnNames ?? []);
  return semanticObjectValue(fields);
}

export function semanticFloatingObjectAnchorValue(
  change: FloatingObjectChange,
): VersionSemanticValue | null {
  const changedFields = floatingObjectChangedFields(change);
  const hasAnchorEvidence =
    change.data?.anchor !== undefined ||
    change.bounds !== undefined ||
    changedFields.some(isFloatingObjectAnchorField) ||
    change.kind.type !== 'updated';
  if (!hasAnchorEvidence) return null;

  const fields: SemanticField[] = [
    { key: 'kind', value: change.kind.type },
    { key: 'objectId', value: change.objectId },
  ];
  pushOptionalSemanticField(fields, 'objectType', floatingObjectType(change));
  pushStringArraySemanticField(fields, 'changedFields', changedFields);
  if (change.data?.anchor) {
    fields.push({ key: 'anchor', value: semanticFloatingObjectAnchor(change.data.anchor) });
    pushOptionalSemanticField(fields, 'width', change.data.width);
    pushOptionalSemanticField(fields, 'height', change.data.height);
    pushOptionalSemanticField(fields, 'zIndex', change.data.zIndex);
    pushOptionalSemanticField(fields, 'rotation', change.data.rotation);
  }
  if (change.bounds) {
    fields.push({ key: 'bounds', value: semanticFloatingObjectBounds(change.bounds) });
  }
  return semanticObjectValue(fields);
}

function semanticFloatingObjectAnchor(anchor: FloatingObjectAnchor): VersionSemanticValue {
  const fields: SemanticField[] = [];
  for (const key of FLOATING_OBJECT_ANCHOR_FIELDS)
    pushOptionalSemanticField(fields, key, anchor[key]);
  return semanticObjectValue(fields);
}

function semanticFloatingObjectBounds(bounds: FloatingObjectBounds): VersionSemanticValue {
  const fields: SemanticField[] = [];
  for (const key of FLOATING_OBJECT_BOUNDS_FIELDS)
    pushOptionalSemanticField(fields, key, bounds[key]);
  return semanticObjectValue(fields);
}

export function semanticRangeValue(change: RangeChange, meta: RangeMeta): VersionSemanticValue {
  const fields: SemanticField[] = [
    { key: 'kind', value: change.kind },
    { key: 'rangeKind', value: meta.kind },
    { key: 'rangeId', value: change.rangeId },
    { key: 'encoding', value: meta.encoding },
    { key: 'rowCount', value: meta.rowIds.length },
    { key: 'colCount', value: meta.colIds.length },
    { key: 'anchor', value: semanticRangeAnchor(meta.anchor) },
  ];
  return semanticObjectValue(fields);
}

function semanticRangeAnchor(anchor: RangeMeta['anchor']): VersionSemanticValue {
  if ('Elastic' in anchor) {
    const elastic = anchor.Elastic;
    return semanticObjectValue([
      { key: 'kind', value: 'Elastic' },
      { key: 'startRow', value: elastic.startRow },
      { key: 'endRow', value: elastic.endRow },
      { key: 'startCol', value: elastic.startCol },
      { key: 'endCol', value: elastic.endCol },
    ]);
  }
  const strict = anchor.Strict;
  const fields: SemanticField[] = [
    { key: 'kind', value: 'Strict' },
    { key: 'rowCount', value: strict.rowIds.length },
    { key: 'colCount', value: strict.colIds.length },
  ];
  pushOptionalSemanticField(fields, 'firstRowId', strict.rowIds[0]);
  pushOptionalSemanticField(fields, 'lastRowId', strict.rowIds.at(-1));
  pushOptionalSemanticField(fields, 'firstColId', strict.colIds[0]);
  pushOptionalSemanticField(fields, 'lastColId', strict.colIds.at(-1));
  return semanticObjectValue(fields);
}

export function semanticRangeDomain(kind: RangeMeta['kind']): string | null {
  return RANGE_KIND_DOMAINS[kind] ?? null;
}

export function filterEntityId(change: FilterChange): string {
  if (typeof change.filterId === 'string' && change.filterId.length > 0) {
    return `${change.sheetId}!filter:${change.filterId}`;
  }
  if (typeof change.tableId === 'string' && change.tableId.length > 0) {
    return `${change.sheetId}!table:${change.tableId}:filter`;
  }
  return `${change.sheetId}!autoFilter`;
}

function pushOptionalSemanticField(
  fields: SemanticField[],
  key: string,
  value: string | number | boolean | undefined,
): void {
  if (typeof value === 'number' && !Number.isFinite(value)) return;
  if (value !== undefined) {
    fields.push({ key, value });
  }
}

function pushStringArraySemanticField(
  fields: SemanticField[],
  key: string,
  values: readonly string[],
): void {
  if (values.length === 0) return;
  fields.push({ key, value: { kind: 'array', values } });
}

export function semanticObjectValue(fields: readonly SemanticField[]): VersionSemanticValue {
  return { kind: 'object', fields };
}

export function metadataChange(input: {
  readonly sequence: number;
  readonly prefix: string;
  readonly index: number;
  readonly domain: string;
  readonly entityId: string;
  readonly propertyPath: readonly string[];
  readonly value: VersionSemanticValue;
  readonly removed: boolean;
  readonly display?: SemanticDisplay;
}): VersionSemanticChangeRecord {
  return {
    structural: {
      kind: 'metadata',
      changeId: `mutation-${input.sequence}:${input.prefix}:${input.index}`,
      domain: input.domain,
      entityId: input.entityId,
      propertyPath: input.propertyPath,
    },
    before: { kind: 'value', value: input.removed ? input.value : null },
    after: { kind: 'value', value: input.removed ? null : input.value },
    ...(input.display ? { display: input.display } : {}),
  };
}

function floatingObjectType(change: FloatingObjectChange): string | undefined {
  return isStableString(change.objectType) ? change.objectType : change.data?.type;
}

function floatingObjectChangedFields(change: FloatingObjectChange): readonly string[] {
  return change.kind.type === 'updated' ? change.kind.changedFields.filter(isStableString) : [];
}

function isChartSourceField(field: string): boolean {
  return (
    field === 'chartConfig' ||
    field === 'dataRange' ||
    field === 'seriesRange' ||
    field === 'categoryRange' ||
    field === 'sourceTableId' ||
    field === 'tableDataColumns' ||
    field === 'tableCategoryColumn'
  );
}

function isFloatingObjectAnchorField(field: string): boolean {
  return FLOATING_OBJECT_ANCHOR_CHANGE_FIELDS.has(field);
}

export function decodeRangeChangeMeta(data: RangeChange['data']): RangeMeta | null {
  try {
    const bytes = bytesFromBridge(data as ByteLike);
    return decodeRangeMetaJson(JSON.parse(rangeMetaDecoder.decode(bytes)));
  } catch {
    return null;
  }
}

type ByteLike = Uint8Array | ArrayBuffer | number[] | { type?: string; data?: number[] };

function bytesFromBridge(value: ByteLike): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (isRecord(value) && value.type === 'Buffer' && Array.isArray(value.data)) {
    return Uint8Array.from(value.data);
  }
  throw new TypeError(`Unsupported byte payload shape: ${Object.prototype.toString.call(value)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStableSheetId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isStableString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isSheetIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isLikelyDefinedName(value: unknown): value is string {
  if (!isStableString(value)) return false;
  if (value.length > 255) return false;
  if (!/^[A-Za-z_\\][A-Za-z0-9_.]*$/.test(value)) return false;
  if (/^[A-Za-z]{1,3}[0-9]+$/.test(value)) return false;
  if (/^[Rr][0-9]+[Cc][0-9]+$/.test(value)) return false;
  const upper = value.toUpperCase();
  if (upper.startsWith('_XLNM.')) return false;
  return !RESERVED_DEFINED_NAMES.has(upper);
}

const RESERVED_DEFINED_NAMES = new Set<string>([
  'TRUE',
  'FALSE',
  'NULL',
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  'PRINT_AREA',
  'PRINT_TITLES',
  '_FILTERDATABASE',
]);

export function semanticCellEditValue(
  formula: string | undefined,
  value: CellChange['value'] | CellChange['oldValue'] | undefined,
): VersionSemanticValue {
  const result = semanticCellValue(value);
  return formula ? { kind: 'formula', formula, result } : result;
}

function semanticCellValue(
  value: CellChange['value'] | CellChange['oldValue'] | undefined,
): VersionSemanticValue {
  if (value === undefined) return { kind: 'blank' };
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : { kind: 'blank' };
  if (isCellError(value)) {
    return {
      kind: 'error',
      code: value.value,
      ...(typeof value.message === 'string' ? { message: value.message } : {}),
    };
  }
  return { kind: 'blank' };
}

function isCellError(
  value: unknown,
): value is { readonly value: string; readonly message?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'error' &&
    'value' in value &&
    typeof value.value === 'string'
  );
}

export function directEditKey(edit: DirectEditPosition): string {
  return `${edit.sheetId}\u0000${edit.row}\u0000${edit.col}`;
}

export function isInDirectEditRange(cell: CellChange, ranges: readonly DirectEditRange[]): boolean {
  if (!cell.position) return false;
  return ranges.some(
    (range) =>
      range.sheetId === cell.sheetId &&
      cell.position !== undefined &&
      cell.position.row >= range.startRow &&
      cell.position.row <= range.endRow &&
      cell.position.col >= range.startCol &&
      cell.position.col <= range.endCol,
  );
}
