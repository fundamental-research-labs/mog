import type {
  VersionDiffDisplay,
  VersionDiffDisplayValue,
  VersionDiffEntry,
  VersionDiffHistoricalMetadata,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionRedactedValue,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';
import { toA1 } from '@mog/spreadsheet-utils/a1';

import { diagnostic, type DiffServiceDiagnostic } from './diff-service-diagnostics';
import { mapEntriesWithOrderKeys, type MappedSemanticDiffEntry } from './diff-service-order-key';
import {
  mergeSemanticDiffDisplayContexts,
  semanticDiffDisplayContextFromPayload,
  sheetNameForCellSemanticChange,
  type SemanticDiffDisplayContext,
} from './diff-service-display-context';
import { projectReviewAccessDiffValue } from './review-access-projection';
import { semanticReviewChangesFromPayload } from './semantic-review-projection';

const REDACTED_VALUE_REASONS = new Set([
  'permission-denied',
  'redaction-policy',
  'historical-acl-unavailable',
]);

type ProjectableSemanticChange = {
  readonly value: unknown;
  readonly sourceIndex: number;
};

type SemanticChangeMappingOptions = {
  readonly displayContext?: SemanticDiffDisplayContext;
};

export function mapSemanticChangeSet(
  payload: unknown,
  options: SemanticChangeMappingOptions = {},
):
  | { readonly ok: true; readonly items: readonly MappedSemanticDiffEntry[] }
  | { readonly ok: false; readonly diagnostics: readonly DiffServiceDiagnostic[] } {
  if (!isRecord(payload) || payload.schemaVersion !== 1) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_UNSUPPORTED_SCHEMA',
          'Semantic change-set payload is not supported by this diff slice.',
        ),
      ],
    };
  }

  const reviewChanges = semanticReviewChangesFromPayload(payload);
  if (!reviewChanges) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_UNSUPPORTED_SCHEMA',
          'Semantic change-set payload is not supported by this diff slice.',
        ),
      ],
    };
  }

  const projectableChanges = projectableSemanticChanges(reviewChanges);
  const displayContext = mergeSemanticDiffDisplayContexts(
    semanticDiffDisplayContextFromPayload(payload),
    options.displayContext,
  );
  const entries: { readonly entry: VersionDiffEntry; readonly source: unknown }[] = [];
  for (let index = 0; index < projectableChanges.length; index++) {
    const projectableChange = projectableChanges[index]!;
    const entry = mapSemanticChange(projectableChange.value, displayContext);
    if (!entry) {
      if (isIgnorableRustAggregateChange(projectableChange.value)) continue;
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_UNSUPPORTED_SCHEMA',
            'Semantic change record is not supported by this diff slice.',
            {
              details: { itemIndex: projectableChange.sourceIndex },
            },
          ),
        ],
      };
    }
    entries.push({ entry, source: projectableChange.value });
  }

  return {
    ok: true,
    items: mapEntriesWithOrderKeys(entries),
  };
}

function projectableSemanticChanges(
  changes: readonly unknown[],
): readonly ProjectableSemanticChange[] {
  const childChanges = rustSpecificCellChangeIds(changes);
  return changes.flatMap((change, sourceIndex) =>
    shouldProjectSemanticChange(change, childChanges) ? [{ value: change, sourceIndex }] : [],
  );
}

function rustSpecificCellChangeIds(changes: readonly unknown[]): {
  readonly valueCellIds: ReadonlySet<string>;
  readonly formulaCellIds: ReadonlySet<string>;
} {
  const valueCellIds = new Set<string>();
  const formulaCellIds = new Set<string>();

  for (const change of changes) {
    if (!isRecord(change) || typeof change.objectId !== 'string') continue;
    if (change.domainId === 'cells.values' && change.objectKind === 'cell-value') {
      valueCellIds.add(stripRustObjectPrefix(change.objectId, 'value:'));
    }
    if (change.domainId === 'cells.formulas' && change.objectKind === 'cell-formula') {
      formulaCellIds.add(stripRustObjectPrefix(change.objectId, 'formula:'));
    }
  }

  return { valueCellIds, formulaCellIds };
}

function shouldProjectSemanticChange(
  change: unknown,
  childChanges: {
    readonly valueCellIds: ReadonlySet<string>;
    readonly formulaCellIds: ReadonlySet<string>;
  },
): boolean {
  if (!isRecord(change) || change.objectKind !== 'cell' || typeof change.objectId !== 'string') {
    return true;
  }

  if (change.domainId === 'cells.values') {
    if (childChanges.valueCellIds.has(change.objectId)) return false;
    return rustAggregateValueProjectionState(change) !== 'unchanged';
  }

  if (change.domainId === 'cells.formulas') {
    if (childChanges.formulaCellIds.has(change.objectId)) return false;
    return rustAggregateFormulaProjectionState(change) !== 'unchanged';
  }

  return true;
}

function rustAggregateValueProjectionState(
  change: Readonly<Record<string, unknown>>,
): 'changed' | 'unchanged' | 'unsupported' {
  const before = mapRustCellValueDiffValue(change.beforeRecord);
  const after = mapRustCellValueDiffValue(change.afterRecord);
  if (!before || !after) return 'unsupported';
  return sameDiffValue(before, after) ? 'unchanged' : 'changed';
}

function rustAggregateFormulaProjectionState(
  change: Readonly<Record<string, unknown>>,
): 'changed' | 'unchanged' | 'unsupported' {
  const before = mapRustCellFormulaDiffValue(change.beforeRecord);
  const after = mapRustCellFormulaDiffValue(change.afterRecord);
  if (!before || !after) return 'unsupported';
  return sameDiffValue(before, after) ? 'unchanged' : 'changed';
}

function sameDiffValue(left: VersionDiffValue, right: VersionDiffValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isIgnorableRustAggregateChange(value: unknown): boolean {
  if (!isRustSheetChangeRecord(value)) return false;
  if (!('beforeRecord' in value) && !('afterRecord' in value)) return true;
  return rustSheetProjection(value).kind === 'unchanged';
}

function mapSemanticChange(
  value: unknown,
  displayContext: SemanticDiffDisplayContext,
): VersionDiffEntry | null {
  if (!isRecord(value)) return null;
  return (
    mapReviewSemanticChange(value, displayContext) ?? mapRustSemanticChange(value, displayContext)
  );
}

function mapReviewSemanticChange(
  value: Readonly<Record<string, unknown>>,
  displayContext: SemanticDiffDisplayContext,
): VersionDiffEntry | null {
  const structural = mapStructuralMetadata(value);
  const before = structural ? mapReviewAccessDiffValue(structural, value.before) : null;
  const after = structural ? mapReviewAccessDiffValue(structural, value.after) : null;
  if (!structural || !before || !after) return null;

  const display = reviewDiffDisplay(value, displayContext);
  if (value.display !== undefined && !display) return null;
  const historical =
    value.historical === undefined ? undefined : mapDiffHistoricalMetadata(value.historical);
  if (value.historical !== undefined && !historical) return null;

  return {
    structural,
    before,
    after,
    ...(display ? { display } : {}),
    ...(historical ? { historical } : {}),
  };
}

function reviewDiffDisplay(
  value: Readonly<Record<string, unknown>>,
  displayContext: SemanticDiffDisplayContext,
): VersionDiffDisplay | undefined | null {
  const display = value.display === undefined ? undefined : mapDiffDisplay(value.display);
  if (value.display !== undefined && !display) return null;
  if (display?.sheetName) return display;

  const sheetName = sheetNameForCellSemanticChange(value, displayContext);
  if (!sheetName) return display;
  return {
    ...display,
    sheetName,
  };
}

function mapRustSemanticChange(
  value: Readonly<Record<string, unknown>>,
  displayContext: SemanticDiffDisplayContext,
): VersionDiffEntry | null {
  if (
    typeof value.changeId !== 'string' ||
    typeof value.domainId !== 'string' ||
    typeof value.objectId !== 'string' ||
    typeof value.objectKind !== 'string'
  ) {
    return null;
  }

  if (value.domainId === 'cells.values') {
    return mapRustCellValueChange(value, displayContext);
  }
  if (value.domainId === 'cells.formulas') {
    return mapRustCellFormulaChange(value, displayContext);
  }
  if (value.domainId === 'cells.formats.direct') {
    return mapRustDirectFormatChange(value, displayContext);
  }
  if (value.domainId === 'sheets') {
    return mapRustSheetChange(value);
  }
  return null;
}

function mapRustSheetChange(value: Readonly<Record<string, unknown>>): VersionDiffEntry | null {
  if (value.objectKind !== 'sheet') return null;

  const projection = rustSheetProjection(value);
  if (projection.kind === 'added') {
    return rustSheetStructuralEntry({
      changeId: value.changeId as string,
      propertyPath: ['sheet'],
      sheetId: projection.sheet.sheetId,
      before: { kind: 'value', value: null },
      after: rustSheetDiffValue(projection.sheet),
      entityLabel: projection.sheet.name,
    });
  }
  if (projection.kind === 'removed') {
    return rustSheetStructuralEntry({
      changeId: value.changeId as string,
      propertyPath: ['sheet'],
      sheetId: projection.sheet.sheetId,
      before: rustSheetDiffValue(projection.sheet),
      after: { kind: 'value', value: null },
      entityLabel: projection.sheet.name,
    });
  }
  if (projection.kind === 'renamed') {
    return rustSheetStructuralEntry({
      changeId: value.changeId as string,
      propertyPath: ['name'],
      sheetId: projection.sheetId,
      before: { kind: 'value', value: projection.beforeName },
      after: { kind: 'value', value: projection.afterName },
      entityLabel: projection.afterName,
    });
  }

  return null;
}

function rustSheetStructuralEntry(input: {
  readonly changeId: string;
  readonly propertyPath: readonly string[];
  readonly sheetId: string;
  readonly before: VersionDiffValue;
  readonly after: VersionDiffValue;
  readonly entityLabel: string;
}): VersionDiffEntry {
  return {
    structural: {
      kind: 'metadata',
      changeId: input.changeId,
      domain: 'sheet',
      entityId: input.sheetId,
      propertyPath: [...input.propertyPath],
    },
    before: input.before,
    after: input.after,
    display: {
      entityLabel: { kind: 'value', value: input.entityLabel },
    },
  };
}

type RustSheetProjection =
  | { readonly kind: 'added'; readonly sheet: RustSheetRecord }
  | { readonly kind: 'removed'; readonly sheet: RustSheetRecord }
  | {
      readonly kind: 'renamed';
      readonly sheetId: string;
      readonly beforeName: string;
      readonly afterName: string;
    }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'unsupported' };

type RustSheetRecord = {
  readonly sheetId: string;
  readonly name: string;
};

function rustSheetProjection(value: Readonly<Record<string, unknown>>): RustSheetProjection {
  if (!isRustSheetChangeRecord(value)) return { kind: 'unsupported' };

  const hasBeforeRecord = 'beforeRecord' in value;
  const hasAfterRecord = 'afterRecord' in value;
  const before = rustSheetRecord(value.beforeRecord);
  const after = rustSheetRecord(value.afterRecord);
  if ((hasBeforeRecord && !before) || (hasAfterRecord && !after)) {
    return { kind: 'unsupported' };
  }
  if (!before && !after) return { kind: 'unchanged' };
  if (!before && after) return { kind: 'added', sheet: after };
  if (before && !after) return { kind: 'removed', sheet: before };
  if (!before || !after) return { kind: 'unsupported' };
  if (before.sheetId === after.sheetId && before.name !== after.name) {
    return {
      kind: 'renamed',
      sheetId: after.sheetId,
      beforeName: before.name,
      afterName: after.name,
    };
  }
  return sameRustSheetRecord(before, after) ? { kind: 'unchanged' } : { kind: 'unsupported' };
}

function isRustSheetChangeRecord(value: unknown): value is Readonly<Record<string, unknown>> & {
  readonly domainId: 'sheets';
  readonly objectKind: 'sheet';
} {
  return isRecord(value) && value.domainId === 'sheets' && value.objectKind === 'sheet';
}

function rustSheetRecord(value: unknown): RustSheetRecord | null {
  const evidence = rustRecordEvidence(value);
  if (!evidence || !isRecord(evidence.record)) return null;

  const sheetId =
    typeof evidence.record.sheetId === 'string'
      ? evidence.record.sheetId
      : stripRustObjectPrefix(evidence.objectId, 'sheet:');
  if (sheetId.length === 0 || typeof evidence.record.name !== 'string') return null;

  return {
    sheetId,
    name: evidence.record.name,
  };
}

function rustSheetDiffValue(sheet: RustSheetRecord): VersionDiffValue {
  const fields: { key: string; value: VersionSemanticValue }[] = [
    { key: 'name', value: sheet.name },
  ];
  return { kind: 'value', value: { kind: 'object', fields } };
}

function sameRustSheetRecord(left: RustSheetRecord, right: RustSheetRecord): boolean {
  return left.sheetId === right.sheetId && left.name === right.name;
}

function mapRustCellValueChange(
  value: Readonly<Record<string, unknown>>,
  displayContext: SemanticDiffDisplayContext,
): VersionDiffEntry | null {
  if (value.objectKind !== 'cell' && value.objectKind !== 'cell-value') return null;

  const cell = rustCellCoordinates(value);
  if (!cell) return null;
  const before = mapRustCellValueDiffValue(value.beforeRecord);
  const after = mapRustCellValueDiffValue(value.afterRecord);
  if (!before || !after) return null;

  return rustCellEntry({
    changeId: value.changeId as string,
    domain: 'cells.values',
    propertyPath: ['value'],
    cell: rustCellCoordinatesWithDisplayContext(cell, displayContext),
    before,
    after,
  });
}

function mapRustCellFormulaChange(
  value: Readonly<Record<string, unknown>>,
  displayContext: SemanticDiffDisplayContext,
): VersionDiffEntry | null {
  if (value.objectKind !== 'cell-formula' && value.objectKind !== 'cell') return null;

  const cell = rustCellCoordinates(value);
  if (!cell) return null;
  const before = mapRustCellFormulaDiffValue(value.beforeRecord);
  const after = mapRustCellFormulaDiffValue(value.afterRecord);
  if (!before || !after) return null;

  return rustCellEntry({
    changeId: value.changeId as string,
    domain: 'cells.formulas',
    propertyPath: ['formula'],
    cell: rustCellCoordinatesWithDisplayContext(cell, displayContext),
    before,
    after,
  });
}

function mapRustDirectFormatChange(
  value: Readonly<Record<string, unknown>>,
  displayContext: SemanticDiffDisplayContext,
): VersionDiffEntry | null {
  if (value.objectKind !== 'direct-format') return null;

  const cell = rustDirectFormatCoordinates(value);
  if (!cell) return null;
  const before = mapRustDirectFormatDiffValue(value.beforeRecord);
  const after = mapRustDirectFormatDiffValue(value.afterRecord);
  if (!before || !after) return null;

  return rustCellEntry({
    changeId: value.changeId as string,
    domain: 'cells.formats.direct',
    propertyPath: ['format'],
    cell: rustCellCoordinatesWithDisplayContext(cell, displayContext),
    before,
    after,
  });
}

function rustCellEntry(input: {
  readonly changeId: string;
  readonly domain: string;
  readonly propertyPath: readonly string[];
  readonly cell: RustCellCoordinates;
  readonly before: VersionDiffValue;
  readonly after: VersionDiffValue;
}): VersionDiffEntry {
  const address = toA1(input.cell.row, input.cell.column);
  return {
    structural: {
      kind: 'metadata',
      changeId: input.changeId,
      domain: input.domain,
      entityId: `${input.cell.sheetId}!${address}`,
      propertyPath: [...input.propertyPath],
    },
    before: input.before,
    after: input.after,
    display: {
      ...(input.cell.sheetName
        ? { sheetName: { kind: 'value' as const, value: input.cell.sheetName } }
        : {}),
      address: { kind: 'value', value: address },
    },
    historical: {
      cell: {
        sheetId: input.cell.sheetId,
        row: input.cell.row,
        column: input.cell.column,
      },
    },
  };
}

type RustCellCoordinates = {
  readonly sheetId: string;
  readonly sheetName?: string;
  readonly row: number;
  readonly column: number;
};

function rustCellCoordinates(value: Readonly<Record<string, unknown>>): RustCellCoordinates | null {
  const afterEvidence = rustRecordEvidence(value.afterRecord);
  const beforeEvidence = rustRecordEvidence(value.beforeRecord);
  return (
    rustCellCoordinatesFromEvidenceRecord(afterEvidence) ??
    rustCellCoordinatesFromEvidenceRecord(beforeEvidence) ??
    rustCellCoordinatesWithEvidence(
      rustCellCoordinatesFromObjectId(value.objectId),
      afterEvidence ?? beforeEvidence,
    )
  );
}

function rustCellCoordinatesFromEvidenceRecord(
  evidence: RustRecordEvidence | null,
): RustCellCoordinates | null {
  if (!evidence) return null;
  const coordinates = isRecord(evidence.record)
    ? rustCellCoordinatesFromRecord(evidence.record)
    : null;
  return rustCellCoordinatesWithEvidence(
    coordinates ?? rustCellCoordinatesFromObjectId(evidence.objectId),
    evidence,
  );
}

function rustCellCoordinatesWithEvidence(
  coordinates: RustCellCoordinates | null,
  evidence: RustRecordEvidence | null,
): RustCellCoordinates | null {
  if (!coordinates) return null;
  const sheetName = safeSheetName(evidence?.sheetName);
  return {
    ...coordinates,
    ...(sheetName ? { sheetName } : {}),
  };
}

function rustCellCoordinatesFromRecord(
  record: Readonly<Record<string, unknown>>,
): RustCellCoordinates | null {
  if (
    typeof record.sheetId !== 'string' ||
    !isSafeCoordinate(record.row) ||
    !isSafeCoordinate(record.column)
  ) {
    return null;
  }
  return { sheetId: record.sheetId, row: record.row, column: record.column };
}

function rustCellCoordinatesFromObjectId(value: unknown): RustCellCoordinates | null {
  if (typeof value !== 'string') return null;
  const cellObjectId = stripRustObjectPrefix(
    stripRustObjectPrefix(stripRustObjectPrefix(value, 'direct-format:'), 'value:'),
    'formula:',
  );
  const match = /^cell:(.+):r([0-9]+):c([0-9]+)$/.exec(cellObjectId);
  if (!match) return null;
  const row = Number(match[2]);
  const column = Number(match[3]);
  if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column)) return null;
  return { sheetId: match[1]!, row, column };
}

function rustDirectFormatCoordinates(
  value: Readonly<Record<string, unknown>>,
): RustCellCoordinates | null {
  const afterEvidence = rustRecordEvidence(value.afterRecord);
  const beforeEvidence = rustRecordEvidence(value.beforeRecord);
  return (
    rustCellCoordinatesFromEvidenceRecord(afterEvidence) ??
    rustCellCoordinatesFromEvidenceRecord(beforeEvidence) ??
    rustCellCoordinatesWithEvidence(
      rustCellCoordinatesFromObjectId(value.objectId),
      afterEvidence ?? beforeEvidence,
    )
  );
}

function rustCellCoordinatesWithDisplayContext(
  coordinates: RustCellCoordinates,
  displayContext: SemanticDiffDisplayContext,
): RustCellCoordinates {
  if (coordinates.sheetName) return coordinates;
  const sheetName = displayContext.sheetNamesBySheetId.get(coordinates.sheetId);
  return sheetName ? { ...coordinates, sheetName } : coordinates;
}

function mapRustCellValueDiffValue(value: unknown): VersionDiffValue | null {
  if (value === undefined) return blankDiffValue();
  const evidence = rustRecordEvidence(value);
  if (!evidence) return null;
  const semanticValue = mapRustCellValueEvidenceRecord(evidence.record);
  return semanticValue === undefined ? null : { kind: 'value', value: semanticValue };
}

function mapRustCellValueEvidenceRecord(value: unknown): VersionSemanticValue | undefined {
  if (value === undefined) return { kind: 'blank' };
  if (isRecord(value) && rustCellCoordinatesFromRecord(value)) {
    return 'value' in value ? mapCanonicalCellValue(value.value) : { kind: 'blank' };
  }
  return mapCanonicalCellValue(value);
}

function mapCanonicalCellValue(value: unknown): VersionSemanticValue | undefined {
  if (value === undefined) return { kind: 'blank' };
  if (!isRecord(value)) return undefined;
  if (typeof value.valueKind !== 'string' && !('canonicalValue' in value)) return undefined;
  if (value.canonicalValue === undefined || value.valueKind === 'blank') {
    return { kind: 'blank' };
  }
  return mapSemanticValue(value.canonicalValue);
}

function mapRustCellFormulaDiffValue(value: unknown): VersionDiffValue | null {
  if (value === undefined) return blankDiffValue();
  const evidence = rustRecordEvidence(value);
  if (!evidence) return null;
  const semanticValue = mapRustFormulaEvidenceRecord(evidence.record);
  return semanticValue === undefined ? null : { kind: 'value', value: semanticValue };
}

function mapRustFormulaEvidenceRecord(value: unknown): VersionSemanticValue | undefined {
  if (value === undefined) return { kind: 'blank' };
  if (isRecord(value) && rustCellCoordinatesFromRecord(value)) {
    return 'formula' in value ? mapCanonicalFormula(value.formula) : { kind: 'blank' };
  }
  return mapCanonicalFormula(value);
}

function mapCanonicalFormula(value: unknown): VersionSemanticValue | undefined {
  if (value === undefined) return { kind: 'blank' };
  if (!isRecord(value)) return undefined;
  return typeof value.normalizedFormula === 'string'
    ? { kind: 'formula', formula: value.normalizedFormula }
    : undefined;
}

function mapRustDirectFormatDiffValue(value: unknown): VersionDiffValue | null {
  if (value === undefined) return { kind: 'value', value: null };
  const evidence = rustRecordEvidence(value);
  if (!evidence || !isRecord(evidence.record)) return null;
  const properties =
    evidence.record.properties === undefined
      ? {}
      : isRecord(evidence.record.properties)
        ? evidence.record.properties
        : null;
  if (!properties) return null;
  return { kind: 'value', value: mapPlainJsonObjectValue(properties) };
}

function mapPlainJsonObjectValue(
  value: Readonly<Record<string, unknown>>,
): Extract<VersionSemanticValue, { readonly kind: 'object' }> {
  return {
    kind: 'object',
    fields: Object.keys(value)
      .sort()
      .flatMap((key) => {
        const mapped = mapPlainJsonValue(value[key]);
        return mapped === undefined ? [] : [{ key, value: mapped }];
      }),
  };
}

function mapPlainJsonValue(value: unknown, depth = 0): VersionSemanticValue | undefined {
  if (depth > 16) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const values = value.map((item) => mapPlainJsonValue(item, depth + 1));
    return values.some((item) => item === undefined)
      ? undefined
      : { kind: 'array', values: values as VersionSemanticValue[] };
  }
  if (!isRecord(value)) return undefined;
  return mapPlainJsonObjectValue(value);
}

type RustRecordEvidence = {
  readonly objectId: string;
  readonly objectKind: string;
  readonly domainId: string;
  readonly sheetId?: string;
  readonly sheetName?: string;
  readonly record: unknown;
};

function rustRecordEvidence(value: unknown): RustRecordEvidence | null {
  if (
    !isRecord(value) ||
    typeof value.objectId !== 'string' ||
    typeof value.objectKind !== 'string' ||
    typeof value.domainId !== 'string' ||
    !('record' in value)
  ) {
    return null;
  }
  return {
    objectId: value.objectId,
    objectKind: value.objectKind,
    domainId: value.domainId,
    ...(typeof value.sheetId === 'string' ? { sheetId: value.sheetId } : {}),
    ...(typeof value.sheetName === 'string' ? { sheetName: value.sheetName } : {}),
    record: value.record,
  };
}

function blankDiffValue(): VersionDiffValue {
  return { kind: 'value', value: { kind: 'blank' } };
}

function stripRustObjectPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function safeSheetName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function mapDiffHistoricalMetadata(value: unknown): VersionDiffHistoricalMetadata | null {
  if (!isRecord(value)) return null;
  const historical: VersionDiffHistoricalMetadata = {
    ...(value.cell === undefined ? {} : { cell: mapCellCoordinate(value.cell) }),
    ...(value.range === undefined ? {} : { range: mapRangeCoordinate(value.range) }),
  };
  if (value.cell !== undefined && !historical.cell) return null;
  if (value.range !== undefined && !historical.range) return null;
  return historical.cell || historical.range ? historical : null;
}

function mapCellCoordinate(value: unknown): VersionDiffHistoricalMetadata['cell'] | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.sheetId !== 'string' ||
    !isSafeCoordinate(value.row) ||
    !isSafeCoordinate(value.column)
  ) {
    return undefined;
  }
  return {
    sheetId: value.sheetId,
    row: value.row,
    column: value.column,
  };
}

function mapRangeCoordinate(value: unknown): VersionDiffHistoricalMetadata['range'] | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.sheetId !== 'string' ||
    !isSafeCoordinate(value.rowStart) ||
    !isSafeCoordinate(value.rowEnd) ||
    !isSafeCoordinate(value.columnStart) ||
    !isSafeCoordinate(value.columnEnd) ||
    value.rowEnd < value.rowStart ||
    value.columnEnd < value.columnStart
  ) {
    return undefined;
  }
  return {
    sheetId: value.sheetId,
    rowStart: value.rowStart,
    rowEnd: value.rowEnd,
    columnStart: value.columnStart,
    columnEnd: value.columnEnd,
  };
}

function mapReviewAccessDiffValue(
  structural: VersionDiffStructuralMetadata,
  value: unknown,
): VersionDiffValue | null {
  const reviewValue = projectReviewAccessDiffValue(structural, value);
  return reviewValue === undefined ? mapDiffValue(value) : reviewValue;
}

function mapStructuralMetadata(
  value: Readonly<Record<string, unknown>>,
): VersionDiffStructuralMetadata | null {
  const structural = mapRedactedValue(value.structural);
  if (structural) return structural;
  const source = isRecord(value.structural) ? value.structural : value;

  if (
    typeof source.changeId !== 'string' ||
    typeof source.domain !== 'string' ||
    typeof source.entityId !== 'string' ||
    !Array.isArray(source.propertyPath) ||
    !source.propertyPath.every((segment) => typeof segment === 'string')
  ) {
    return null;
  }

  return {
    kind: 'metadata',
    changeId: source.changeId,
    domain: source.domain,
    entityId: source.entityId,
    propertyPath: [...source.propertyPath],
  };
}

function mapDiffValue(value: unknown): VersionDiffValue | null {
  const redacted = mapRedactedValue(value);
  if (redacted) return redacted;
  if (!isRecord(value) || value.kind !== 'value') return null;

  const semanticValue = mapSemanticValue(value.value);
  if (semanticValue === undefined) return null;
  return { kind: 'value', value: semanticValue };
}

function mapDiffDisplay(value: unknown): VersionDiffDisplay | null {
  if (!isRecord(value)) return null;
  const display: {
    sheetName?: VersionDiffDisplayValue;
    address?: VersionDiffDisplayValue;
    entityLabel?: VersionDiffDisplayValue;
  } = {};

  for (const key of ['sheetName', 'address', 'entityLabel'] as const) {
    if (value[key] === undefined) continue;
    const displayValue = mapDiffDisplayValue(value[key]);
    if (!displayValue) return null;
    display[key] = displayValue;
  }
  return display;
}

function mapDiffDisplayValue(value: unknown): VersionDiffDisplayValue | null {
  const redacted = mapRedactedValue(value);
  if (redacted) return redacted;
  if (!isRecord(value) || value.kind !== 'value' || typeof value.value !== 'string') return null;
  return { kind: 'value', value: value.value };
}

function mapRedactedValue(value: unknown): VersionRedactedValue | null {
  if (!isRecord(value) || value.kind !== 'redacted' || typeof value.reason !== 'string') {
    return null;
  }
  if (!REDACTED_VALUE_REASONS.has(value.reason)) return null;
  return {
    kind: 'redacted',
    reason: value.reason as VersionRedactedValue['reason'],
  };
}

function mapSemanticValue(value: unknown, depth = 0): VersionSemanticValue | undefined {
  if (depth > 16) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!isRecord(value)) return undefined;

  switch (value.kind) {
    case 'blank':
      return { kind: 'blank' };
    case 'dateTime':
      return typeof value.iso === 'string' ? { kind: 'dateTime', iso: value.iso } : undefined;
    case 'duration':
      return typeof value.iso === 'string' ? { kind: 'duration', iso: value.iso } : undefined;
    case 'error':
      if (typeof value.code !== 'string') return undefined;
      return {
        kind: 'error',
        code: value.code,
        ...(typeof value.message === 'string' ? { message: value.message } : {}),
      };
    case 'formula': {
      if (typeof value.formula !== 'string') return undefined;
      if (!('result' in value)) return { kind: 'formula', formula: value.formula };
      const result = mapSemanticValue(value.result, depth + 1);
      return result === undefined ? undefined : { kind: 'formula', formula: value.formula, result };
    }
    case 'array': {
      if (!Array.isArray(value.values)) return undefined;
      const values = mapSemanticValues(value.values, depth + 1);
      return values ? { kind: 'array', values } : undefined;
    }
    case 'richText': {
      if (!Array.isArray(value.runs)) return undefined;
      const runs = value.runs.map((run) => {
        if (!isRecord(run) || typeof run.text !== 'string') return null;
        return {
          text: run.text,
          ...(typeof run.styleRef === 'string' ? { styleRef: run.styleRef } : {}),
        };
      });
      if (runs.some((run) => run === null)) return undefined;
      return {
        kind: 'richText',
        runs: runs as { readonly text: string; readonly styleRef?: string }[],
      };
    }
    case 'object': {
      if (!Array.isArray(value.fields)) return undefined;
      const fields = value.fields.map((field) => {
        if (!isRecord(field) || typeof field.key !== 'string') return null;
        const mappedValue = mapSemanticValue(field.value, depth + 1);
        return mappedValue === undefined ? null : { key: field.key, value: mappedValue };
      });
      if (fields.some((field) => field === null)) return undefined;
      return {
        kind: 'object',
        fields: fields as { readonly key: string; readonly value: VersionSemanticValue }[],
      };
    }
    default:
      return undefined;
  }
}

function mapSemanticValues(
  values: readonly unknown[],
  depth: number,
): readonly VersionSemanticValue[] | undefined {
  const mapped = values.map((value) => mapSemanticValue(value, depth));
  return mapped.some((value) => value === undefined)
    ? undefined
    : (mapped as readonly VersionSemanticValue[]);
}

function isSafeCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
