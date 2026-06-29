import { toA1 } from '@mog/spreadsheet-utils/a1';

import type {
  CellChange,
  SemanticWorkbookState,
} from '../../bridges/compute/compute-types.gen';
import type { DirectEditPosition, DirectEditRange } from '../../bridges/compute/mutation-admission';
import { semanticCellEditValue } from './semantic-mutation-capture-projection-helpers';

export const COMPACT_CELL_VALUE_REVIEW_PROJECTION_MIN_CHANGE_COUNT = 10_000;

export type CompactCellValueReviewProjection = {
  readonly schemaVersion: 1;
  readonly kind: 'rectangularCellValueProjection';
  readonly sheetId: string;
  readonly sheetName?: string;
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly columnStart: number;
  readonly columnEnd: number;
  readonly changeCount: number;
  readonly before: CompactCellValueSeries;
  readonly after: CompactCellValueSeries;
};

export type CompactCellValueSeries =
  | {
      readonly kind: 'constant';
      readonly value: unknown;
    }
  | {
      readonly kind: 'rowMajor';
      readonly values: readonly unknown[];
    };

type ParsedCellValueReviewChange = {
  readonly sheetId: string;
  readonly sheetName?: string;
  readonly row: number;
  readonly column: number;
  readonly before: unknown;
  readonly after: unknown;
};

export function compactPlainCellValueReviewChanges(
  reviewChanges: readonly unknown[],
): CompactCellValueReviewProjection | null {
  if (reviewChanges.length === 0) return null;

  const parsed: ParsedCellValueReviewChange[] = [];
  let sheetId: string | undefined;
  let sheetName: string | undefined;
  let rowStart = Number.POSITIVE_INFINITY;
  let rowEnd = Number.NEGATIVE_INFINITY;
  let columnStart = Number.POSITIVE_INFINITY;
  let columnEnd = Number.NEGATIVE_INFINITY;
  const seenPositions = new Set<string>();

  for (const change of reviewChanges) {
    const parsedChange = parsePlainCellValueReviewChange(change);
    if (!parsedChange) return null;
    sheetId ??= parsedChange.sheetId;
    if (parsedChange.sheetId !== sheetId) return null;
    if (parsedChange.sheetName) {
      sheetName ??= parsedChange.sheetName;
      if (parsedChange.sheetName !== sheetName) return null;
    }

    const positionKey = `${parsedChange.row}:${parsedChange.column}`;
    if (seenPositions.has(positionKey)) return null;
    seenPositions.add(positionKey);

    rowStart = Math.min(rowStart, parsedChange.row);
    rowEnd = Math.max(rowEnd, parsedChange.row);
    columnStart = Math.min(columnStart, parsedChange.column);
    columnEnd = Math.max(columnEnd, parsedChange.column);
    parsed.push(parsedChange);
  }

  const rowCount = rowEnd - rowStart + 1;
  const columnCount = columnEnd - columnStart + 1;
  if (
    !sheetId ||
    rowCount < 1 ||
    columnCount < 1 ||
    rowCount * columnCount !== parsed.length
  ) {
    return null;
  }

  const rowMajor = [...parsed].sort(
    (left, right) => left.row - right.row || left.column - right.column,
  );

  return {
    schemaVersion: 1,
    kind: 'rectangularCellValueProjection',
    sheetId,
    ...(sheetName ? { sheetName } : {}),
    rowStart,
    rowEnd,
    columnStart,
    columnEnd,
    changeCount: rowMajor.length,
    before: compactSeries(rowMajor.map((change) => change.before)),
    after: compactSeries(rowMajor.map((change) => change.after)),
  };
}

export function compactPlainCellValueReviewProjectionFromCellChanges(input: {
  readonly changedCells: readonly CellChange[];
  readonly directEdits?: readonly DirectEditPosition[];
  readonly directEditRanges?: readonly DirectEditRange[];
  readonly minimumChangeCount?: number;
}): CompactCellValueReviewProjection | null {
  const target = directCellProjectionTarget(input);
  if (!target) return null;

  const columnCount = target.columnEnd - target.columnStart + 1;
  const changeCount = (target.rowEnd - target.rowStart + 1) * columnCount;
  const minimumChangeCount =
    input.minimumChangeCount ?? COMPACT_CELL_VALUE_REVIEW_PROJECTION_MIN_CHANGE_COUNT;
  if (changeCount < minimumChangeCount) return null;

  const beforeValues = new Array<unknown>(changeCount);
  const afterValues = new Array<unknown>(changeCount);
  const seen = new Uint8Array(changeCount);
  let seenCount = 0;

  for (const cell of input.changedCells) {
    if (!cell.position || cell.sheetId !== target.sheetId) continue;
    const { row, col } = cell.position;
    if (
      row < target.rowStart ||
      row > target.rowEnd ||
      col < target.columnStart ||
      col > target.columnEnd
    ) {
      continue;
    }

    const before = semanticCellEditValue(cell.oldFormula, cell.oldValue);
    const after = semanticCellEditValue(cell.newFormula, cell.value);
    if (!isPlainCellReviewValue(before) || !isPlainCellReviewValue(after)) return null;

    const index = (row - target.rowStart) * columnCount + (col - target.columnStart);
    if (seen[index] === 1) return null;
    seen[index] = 1;
    beforeValues[index] = before;
    afterValues[index] = after;
    seenCount++;
  }

  if (seenCount !== changeCount) return null;

  return {
    schemaVersion: 1,
    kind: 'rectangularCellValueProjection',
    sheetId: target.sheetId,
    rowStart: target.rowStart,
    rowEnd: target.rowEnd,
    columnStart: target.columnStart,
    columnEnd: target.columnEnd,
    changeCount,
    before: compactSeries(beforeValues),
    after: compactSeries(afterValues),
  };
}

export function reviewChangesWithSheetDisplayNames(input: {
  readonly reviewChanges: readonly unknown[];
  readonly beforeState: SemanticWorkbookState;
  readonly afterState: SemanticWorkbookState;
}): readonly unknown[] {
  let changed = false;
  const reviewChanges = input.reviewChanges.map((change) => {
    const enriched = reviewChangeWithSheetDisplayName(change, input.beforeState, input.afterState);
    if (enriched !== change) changed = true;
    return enriched;
  });
  return changed ? reviewChanges : input.reviewChanges;
}

export function semanticReviewChangesFromPayload(payload: unknown): readonly unknown[] | null {
  if (!isRecord(payload) || payload.schemaVersion !== 1) return null;
  if (Array.isArray(payload.reviewChanges) && payload.reviewChanges.length > 0) {
    return payload.reviewChanges;
  }
  const compactProjection = parseCompactCellValueReviewProjection(payload.compactReviewProjection);
  if (compactProjection) return materializeCompactReviewChanges(compactProjection);
  return Array.isArray(payload.changes) ? payload.changes : null;
}

export function materializeCompactReviewChanges(
  projection: CompactCellValueReviewProjection,
): readonly unknown[] {
  return Array.from({ length: projection.changeCount }, (_, index) =>
    materializeCompactReviewChange(projection, index),
  );
}

function materializeCompactReviewChange(
  projection: CompactCellValueReviewProjection,
  index: number,
): unknown {
  const columnCount = projection.columnEnd - projection.columnStart + 1;
  const row = projection.rowStart + Math.floor(index / columnCount);
  const column = projection.columnStart + (index % columnCount);
  const address = toA1(row, column);
  return {
    structural: {
      kind: 'metadata',
      changeId: `projection:${projection.sheetId}:${row}:${column}`,
      domain: 'cell',
      entityId: `${projection.sheetId}!${address}`,
      propertyPath: ['value'],
    },
    before: {
      kind: 'value',
      value: seriesValueAt(projection.before, index),
    },
    after: {
      kind: 'value',
      value: seriesValueAt(projection.after, index),
    },
    display: {
      ...(projection.sheetName
        ? { sheetName: { kind: 'value' as const, value: projection.sheetName } }
        : {}),
      address: { kind: 'value', value: address },
    },
    historical: {
      cell: {
        sheetId: projection.sheetId,
        row,
        column,
      },
    },
  };
}

function parsePlainCellValueReviewChange(value: unknown): ParsedCellValueReviewChange | null {
  if (!isRecord(value)) return null;
  const structural = value.structural;
  if (!isRecord(structural)) return null;
  if (structural.kind !== 'metadata' || structural.domain !== 'cell') return null;
  if (!Array.isArray(structural.propertyPath)) return null;
  if (structural.propertyPath.length !== 1 || structural.propertyPath[0] !== 'value') return null;

  const historical = isRecord(value.historical) ? value.historical : null;
  const cell = isRecord(historical?.cell) ? historical.cell : null;
  const sheetId = typeof cell?.sheetId === 'string' ? cell.sheetId : null;
  const row = safeCoordinate(cell?.row);
  const column = safeCoordinate(cell?.column);
  if (!sheetId || row === null || column === null) return null;

  const before = cellValueEndpoint(value.before);
  const after = cellValueEndpoint(value.after);
  if (!before.ok || !after.ok) return null;

  const sheetName = displaySheetName(value.display);
  return {
    sheetId,
    ...(sheetName ? { sheetName } : {}),
    row,
    column,
    before: before.value,
    after: after.value,
  };
}

function cellValueEndpoint(
  value: unknown,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  if (!isRecord(value) || value.kind !== 'value') return { ok: false };
  return isPlainCellReviewValue(value.value)
    ? { ok: true, value: value.value }
    : { ok: false };
}

function isPlainCellReviewValue(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return isRecord(value) && value.kind === 'blank' && Object.keys(value).length === 1;
}

function parseCompactCellValueReviewProjection(
  value: unknown,
): CompactCellValueReviewProjection | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== 1 || value.kind !== 'rectangularCellValueProjection') return null;
  const sheetId = typeof value.sheetId === 'string' ? value.sheetId : null;
  const sheetName = typeof value.sheetName === 'string' && value.sheetName ? value.sheetName : null;
  const rowStart = safeCoordinate(value.rowStart);
  const rowEnd = safeCoordinate(value.rowEnd);
  const columnStart = safeCoordinate(value.columnStart);
  const columnEnd = safeCoordinate(value.columnEnd);
  const changeCount = safePositiveCount(value.changeCount);
  const before = parseSeries(value.before, changeCount);
  const after = parseSeries(value.after, changeCount);
  if (
    !sheetId ||
    rowStart === null ||
    rowEnd === null ||
    columnStart === null ||
    columnEnd === null ||
    changeCount === null ||
    !before ||
    !after ||
    rowStart > rowEnd ||
    columnStart > columnEnd ||
    (rowEnd - rowStart + 1) * (columnEnd - columnStart + 1) !== changeCount
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    kind: 'rectangularCellValueProjection',
    sheetId,
    ...(sheetName ? { sheetName } : {}),
    rowStart,
    rowEnd,
    columnStart,
    columnEnd,
    changeCount,
    before,
    after,
  };
}

function compactSeries(values: readonly unknown[]): CompactCellValueSeries {
  const first = values[0];
  return values.every((value) => valuesEqual(value, first))
    ? { kind: 'constant', value: first }
    : { kind: 'rowMajor', values };
}

function parseSeries(value: unknown, expectedLength: number | null): CompactCellValueSeries | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'constant' && isPlainCellReviewValue(value.value)) {
    return { kind: 'constant', value: value.value };
  }
  if (value.kind === 'rowMajor' && Array.isArray(value.values)) {
    if (expectedLength !== null && value.values.length !== expectedLength) return null;
    if (!value.values.every(isPlainCellReviewValue)) return null;
    return { kind: 'rowMajor', values: value.values };
  }
  return null;
}

function seriesValueAt(series: CompactCellValueSeries, index: number): unknown {
  return series.kind === 'constant' ? series.value : series.values[index];
}

function reviewChangeWithSheetDisplayName(
  change: unknown,
  beforeState: SemanticWorkbookState,
  afterState: SemanticWorkbookState,
): unknown {
  if (!isRecord(change)) return change;
  const sheetId = sheetIdFromCellReviewChange(change);
  if (!sheetId) return change;
  const display = isRecord(change.display) ? change.display : {};
  if (displaySheetName(display)) return change;
  const sheetName = sheetNameForSheetId(afterState, sheetId) ?? sheetNameForSheetId(beforeState, sheetId);
  if (!sheetName) return change;
  return {
    ...change,
    display: {
      ...display,
      sheetName: { kind: 'value', value: sheetName },
    },
  };
}

function sheetIdFromCellReviewChange(
  value: Readonly<Record<string, unknown>>,
): string | undefined {
  const structural = isRecord(value.structural) ? value.structural : undefined;
  if (!isCellDomain(structural?.domain)) return undefined;

  const historical = isRecord(value.historical) ? value.historical : undefined;
  const cell = isRecord(historical?.cell) ? historical.cell : undefined;
  if (typeof cell?.sheetId === 'string' && cell.sheetId.length > 0) return cell.sheetId;

  if (typeof structural?.entityId !== 'string') return undefined;
  const separator = structural.entityId.lastIndexOf('!');
  return separator > 0 ? structural.entityId.slice(0, separator) : undefined;
}

function isCellDomain(value: unknown): boolean {
  return value === 'cell' || value === 'cells' || value === 'cells.values';
}

function sheetNameForSheetId(
  state: SemanticWorkbookState,
  sheetId: string,
): string | undefined {
  for (const sheet of Object.values(state.sheets)) {
    if (sheet.sheetId === sheetId && typeof sheet.name === 'string' && sheet.name.length > 0) {
      return sheet.name;
    }
  }
  return undefined;
}

function displaySheetName(
  value: unknown,
): string | undefined {
  if (!isRecord(value)) return undefined;
  const sheetName = value.sheetName;
  return isRecord(sheetName) && sheetName.kind === 'value' && typeof sheetName.value === 'string'
    ? sheetName.value
    : undefined;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  return isBlankCellValue(left) && isBlankCellValue(right);
}

function directCellProjectionTarget(input: {
  readonly directEdits?: readonly DirectEditPosition[];
  readonly directEditRanges?: readonly DirectEditRange[];
}):
  | {
      readonly sheetId: string;
      readonly rowStart: number;
      readonly rowEnd: number;
      readonly columnStart: number;
      readonly columnEnd: number;
    }
  | null {
  if (input.directEditRanges?.length === 1) {
    const range = input.directEditRanges[0];
    return {
      sheetId: range.sheetId,
      rowStart: range.startRow,
      rowEnd: range.endRow,
      columnStart: range.startCol,
      columnEnd: range.endCol,
    };
  }

  if (!input.directEdits || input.directEdits.length === 0) return null;
  let sheetId: string | undefined;
  let rowStart = Number.POSITIVE_INFINITY;
  let rowEnd = Number.NEGATIVE_INFINITY;
  let columnStart = Number.POSITIVE_INFINITY;
  let columnEnd = Number.NEGATIVE_INFINITY;
  const seen = new Set<string>();

  for (const edit of input.directEdits) {
    sheetId ??= edit.sheetId;
    if (edit.sheetId !== sheetId) return null;
    const key = `${edit.row}:${edit.col}`;
    if (seen.has(key)) return null;
    seen.add(key);
    rowStart = Math.min(rowStart, edit.row);
    rowEnd = Math.max(rowEnd, edit.row);
    columnStart = Math.min(columnStart, edit.col);
    columnEnd = Math.max(columnEnd, edit.col);
  }

  if (!sheetId) return null;
  const rowCount = rowEnd - rowStart + 1;
  const columnCount = columnEnd - columnStart + 1;
  if (rowCount < 1 || columnCount < 1 || rowCount * columnCount !== input.directEdits.length) {
    return null;
  }

  return { sheetId, rowStart, rowEnd, columnStart, columnEnd };
}

function isBlankCellValue(value: unknown): boolean {
  return isRecord(value) && value.kind === 'blank' && Object.keys(value).length === 1;
}

function safeCoordinate(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

function safePositiveCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
