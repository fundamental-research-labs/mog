export type SemanticDiffDisplayContext = {
  readonly sheetNamesBySheetId: ReadonlyMap<string, string>;
};

export type SemanticSheetNameDisplay = {
  readonly kind: 'value';
  readonly value: string;
};

export function semanticDiffDisplayContextFromPayload(
  payload: unknown,
): SemanticDiffDisplayContext {
  const sheetNamesBySheetId = new Map<string, string>();
  for (const change of allPayloadChanges(payload)) {
    collectSheetNamesFromChange(change, sheetNamesBySheetId);
  }
  collectReviewCellSheetNamesFromRustEvidence(payload, sheetNamesBySheetId);
  return { sheetNamesBySheetId };
}

export function mergeSemanticDiffDisplayContexts(
  primary: SemanticDiffDisplayContext,
  secondary: SemanticDiffDisplayContext | undefined,
): SemanticDiffDisplayContext {
  if (!secondary || secondary.sheetNamesBySheetId.size === 0) return primary;
  const sheetNamesBySheetId = new Map<string, string>(secondary.sheetNamesBySheetId);
  for (const [sheetId, sheetName] of primary.sheetNamesBySheetId) {
    sheetNamesBySheetId.set(sheetId, sheetName);
  }
  return { sheetNamesBySheetId };
}

export function sheetNameForCellSemanticChange(
  value: Readonly<Record<string, unknown>>,
  context: SemanticDiffDisplayContext,
): SemanticSheetNameDisplay | undefined {
  const sheetId = sheetIdForCellSemanticChange(value);
  if (!sheetId) return undefined;
  const sheetName = context.sheetNamesBySheetId.get(sheetId);
  return sheetName ? { kind: 'value', value: sheetName } : undefined;
}

export function sheetIdForCellSemanticChange(
  value: Readonly<Record<string, unknown>>,
): string | undefined {
  const historical = isRecord(value.historical) ? value.historical : undefined;
  const cell = isRecord(historical?.cell) ? historical.cell : undefined;
  const range = isRecord(historical?.range) ? historical.range : undefined;
  return (
    safeSheetId(cell?.sheetId) ??
    safeSheetId(range?.sheetId) ??
    sheetIdFromRecordEvidence(value.afterRecord) ??
    sheetIdFromRecordEvidence(value.beforeRecord) ??
    sheetIdFromCellObjectId(value.objectId) ??
    sheetIdFromCellStructuralEntity(value.structural)
  );
}

function sheetIdForSemanticChange(
  value: Readonly<Record<string, unknown>>,
): string | undefined {
  const historical = isRecord(value.historical) ? value.historical : undefined;
  const cell = isRecord(historical?.cell) ? historical.cell : undefined;
  const range = isRecord(historical?.range) ? historical.range : undefined;
  return (
    safeSheetId(cell?.sheetId) ??
    safeSheetId(range?.sheetId) ??
    sheetIdFromRecordEvidence(value.afterRecord) ??
    sheetIdFromRecordEvidence(value.beforeRecord) ??
    sheetIdFromCellObjectId(value.objectId) ??
    sheetIdFromSheetObjectId(value.objectId) ??
    sheetIdFromSheetStructuralEntity(value.structural) ??
    sheetIdFromStructuralEntity(value.structural) ??
    sheetIdFromSemanticValue(value.before) ??
    sheetIdFromSemanticValue(value.after)
  );
}

function allPayloadChanges(payload: unknown): readonly unknown[] {
  if (!isRecord(payload) || payload.schemaVersion !== 1) return [];
  const changes: unknown[] = [];
  if (Array.isArray(payload.changes)) changes.push(...payload.changes);
  if (isRecord(payload.semanticDiff) && Array.isArray(payload.semanticDiff.changes)) {
    changes.push(...payload.semanticDiff.changes);
  }
  if (Array.isArray(payload.reviewChanges)) changes.push(...payload.reviewChanges);
  return changes;
}

function collectReviewCellSheetNamesFromRustEvidence(
  payload: unknown,
  sheetNames: Map<string, string>,
): void {
  if (!isRecord(payload) || payload.schemaVersion !== 1 || !Array.isArray(payload.reviewChanges)) {
    return;
  }

  const rustCellSheetNames = rustCellSheetNamesByChangeSignature(payload);
  if (rustCellSheetNames.size === 0) return;

  for (const reviewChange of payload.reviewChanges) {
    const reviewCell = reviewCellChangeSignature(reviewChange);
    if (!reviewCell || sheetNames.has(reviewCell.sheetId)) continue;
    const sheetName = uniqueString(rustCellSheetNames.get(reviewCell.signature));
    if (sheetName) sheetNames.set(reviewCell.sheetId, sheetName);
  }
}

function rustCellSheetNamesByChangeSignature(payload: Readonly<Record<string, unknown>>) {
  const values = new Map<string, Set<string>>();
  for (const change of rustEvidencePayloadChanges(payload)) {
    const rustCell = rustCellChangeSignature(change);
    if (!rustCell) continue;
    let sheetNames = values.get(rustCell.signature);
    if (!sheetNames) {
      sheetNames = new Set<string>();
      values.set(rustCell.signature, sheetNames);
    }
    sheetNames.add(rustCell.sheetName);
  }
  return values;
}

function rustEvidencePayloadChanges(
  payload: Readonly<Record<string, unknown>>,
): readonly unknown[] {
  const changes: unknown[] = [];
  if (Array.isArray(payload.changes)) changes.push(...payload.changes);
  if (isRecord(payload.semanticDiff) && Array.isArray(payload.semanticDiff.changes)) {
    changes.push(...payload.semanticDiff.changes);
  }
  return changes;
}

function reviewCellChangeSignature(
  value: unknown,
): { readonly sheetId: string; readonly signature: string } | null {
  if (!isRecord(value)) return null;
  const structural = isRecord(value.structural) ? value.structural : undefined;
  if (!isCellDomain(structural?.domain)) return null;

  const historical = isRecord(value.historical) ? value.historical : undefined;
  const cell = isRecord(historical?.cell) ? historical.cell : undefined;
  const sheetId = safeSheetId(cell?.sheetId);
  const row = safeCoordinate(cell?.row);
  const column = safeCoordinate(cell?.column);
  if (!sheetId || row === undefined || column === undefined) return null;

  const before = reviewEndpointSignature(value.before);
  const after = reviewEndpointSignature(value.after);
  if (!before || !after) return null;

  return {
    sheetId,
    signature: cellChangeSignature(row, column, before, after),
  };
}

function rustCellChangeSignature(
  value: unknown,
): { readonly sheetName: string; readonly signature: string } | null {
  if (!isRecord(value) || !isCellDomain(value.domainId)) return null;
  const before = rustCellEvidence(value.beforeRecord);
  const after = rustCellEvidence(value.afterRecord);
  const coordinates = after?.coordinates ?? before?.coordinates;
  const sheetName = safeSheetName(after?.sheetName) ?? safeSheetName(before?.sheetName);
  if (!coordinates || !sheetName) return null;

  return {
    sheetName,
    signature: cellChangeSignature(
      coordinates.row,
      coordinates.column,
      rustEndpointSignature(before?.record),
      rustEndpointSignature(after?.record),
    ),
  };
}

function rustCellEvidence(value: unknown):
  | {
      readonly sheetName?: string;
      readonly coordinates?: { readonly row: number; readonly column: number };
      readonly record: unknown;
    }
  | undefined {
  const evidence = recordEvidence(value);
  if (!evidence) return undefined;
  const recordCoordinates = isRecord(evidence.record)
    ? coordinatesFromRecord(evidence.record)
    : undefined;
  const objectCoordinates = coordinatesFromCellObjectId(evidence.objectId);
  return {
    ...(evidence.sheetName ? { sheetName: evidence.sheetName } : {}),
    ...(recordCoordinates ?? objectCoordinates
      ? { coordinates: (recordCoordinates ?? objectCoordinates)! }
      : {}),
    record: evidence.record,
  };
}

function coordinatesFromRecord(
  value: Readonly<Record<string, unknown>>,
): { readonly row: number; readonly column: number } | undefined {
  const row = safeCoordinate(value.row);
  const column = safeCoordinate(value.column);
  return row === undefined || column === undefined ? undefined : { row, column };
}

function coordinatesFromCellObjectId(
  value: unknown,
): { readonly row: number; readonly column: number } | undefined {
  if (typeof value !== 'string') return undefined;
  const cellObjectId = stripObjectPrefix(
    stripObjectPrefix(stripObjectPrefix(value, 'direct-format:'), 'value:'),
    'formula:',
  );
  const match = /^cell:.+:r([0-9]+):c([0-9]+)$/.exec(cellObjectId);
  if (!match) return undefined;
  const row = Number(match[1]);
  const column = Number(match[2]);
  return Number.isSafeInteger(row) && Number.isSafeInteger(column) ? { row, column } : undefined;
}

function cellChangeSignature(
  row: number,
  column: number,
  before: string,
  after: string,
): string {
  return stableStringify([row, column, before, after]);
}

function reviewEndpointSignature(value: unknown): string | undefined {
  if (!isRecord(value) || value.kind !== 'value') return undefined;
  return semanticValueSignature(value.value);
}

function rustEndpointSignature(value: unknown): string {
  if (value === undefined) return semanticValueSignature({ kind: 'blank' });
  if (isRecord(value) && 'value' in value && coordinatesFromRecord(value)) {
    return rustEndpointSignature(value.value);
  }
  if (isRecord(value) && 'canonicalValue' in value) {
    return semanticValueSignature(value.canonicalValue);
  }
  if (isRecord(value) && value.valueKind === 'blank') {
    return semanticValueSignature({ kind: 'blank' });
  }
  if (isRecord(value) && typeof value.normalizedFormula === 'string') {
    return semanticValueSignature({ kind: 'formula', formula: value.normalizedFormula });
  }
  return semanticValueSignature(value);
}

function semanticValueSignature(value: unknown): string {
  if (value === null || (isRecord(value) && value.kind === 'blank')) return 'blank';
  if (isRecord(value) && value.kind === 'formula' && typeof value.formula === 'string') {
    return stableStringify({ kind: 'formula', formula: value.formula });
  }
  return stableStringify(value);
}

function uniqueString(values: ReadonlySet<string> | undefined): string | undefined {
  if (!values || values.size !== 1) return undefined;
  return values.values().next().value;
}

function collectSheetNamesFromChange(value: unknown, sheetNames: Map<string, string>): void {
  if (!isRecord(value)) return;
  collectSheetNameFromRecordEvidence(value.beforeRecord, sheetNames);
  collectSheetNameFromRecordEvidence(value.afterRecord, sheetNames);

  const sheetId = sheetIdForSemanticChange(value);
  const displaySheetName = displaySheetNameForSheetSemanticChange(value);
  if (displaySheetName && sheetId) sheetNames.set(sheetId, displaySheetName);
}

function collectSheetNameFromRecordEvidence(
  value: unknown,
  sheetNames: Map<string, string>,
): void {
  const evidence = recordEvidence(value);
  if (!evidence) return;

  const sheetId =
    safeSheetId(evidence.sheetId) ??
    sheetIdFromSheetRecordEvidence(evidence) ??
    sheetIdFromCellObjectId(evidence.objectId);
  const sheetName =
    safeSheetName(evidence.sheetName) ?? sheetNameFromSheetRecordEvidence(evidence);
  if (sheetId && sheetName) sheetNames.set(sheetId, sheetName);
}

type RecordEvidence = {
  readonly objectId: string;
  readonly objectKind: string;
  readonly domainId: string;
  readonly sheetId?: string;
  readonly sheetName?: string;
  readonly record: unknown;
};

function recordEvidence(value: unknown): RecordEvidence | null {
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

function sheetIdFromRecordEvidence(value: unknown): string | undefined {
  const evidence = recordEvidence(value);
  if (!evidence) return undefined;
  return (
    safeSheetId(evidence.sheetId) ??
    sheetIdFromSheetRecordEvidence(evidence) ??
    sheetIdFromCellObjectId(evidence.objectId)
  );
}

function sheetIdFromSheetRecordEvidence(evidence: RecordEvidence): string | undefined {
  if (!isRecord(evidence.record)) return undefined;
  return (
    safeSheetId(evidence.record.sheetId) ??
    (evidence.domainId === 'sheets' && evidence.objectKind === 'sheet'
      ? sheetIdFromSheetObjectId(evidence.objectId)
      : undefined)
  );
}

function sheetNameFromSheetRecordEvidence(evidence: RecordEvidence): string | undefined {
  return isRecord(evidence.record) ? safeSheetName(evidence.record.name) : undefined;
}

function displaySheetNameForSheetSemanticChange(
  value: Readonly<Record<string, unknown>>,
): string | undefined {
  if (!isSheetSemanticChange(value)) return undefined;
  const display = isRecord(value.display) ? value.display : undefined;
  return (
    displayValueString(display?.sheetName) ??
    displayValueString(display?.entityLabel) ??
    sheetNameFromSemanticValue(value.after) ??
    sheetNameFromSemanticValue(value.before)
  );
}

function isSheetSemanticChange(value: Readonly<Record<string, unknown>>): boolean {
  if (value.domainId === 'sheets' && value.objectKind === 'sheet') return true;
  const structural = isRecord(value.structural) ? value.structural : undefined;
  return structural?.domain === 'sheet' || structural?.domain === 'sheets';
}

function sheetIdFromStructuralEntity(value: unknown): string | undefined {
  const structural = isRecord(value) ? value : undefined;
  if (typeof structural?.entityId !== 'string') return undefined;
  const separator = structural.entityId.lastIndexOf('!');
  return separator > 0 ? safeSheetId(structural.entityId.slice(0, separator)) : undefined;
}

function sheetIdFromCellStructuralEntity(value: unknown): string | undefined {
  const structural = isRecord(value) ? value : undefined;
  if (!isCellDomain(structural?.domain) || typeof structural?.entityId !== 'string') {
    return undefined;
  }
  const separator = structural.entityId.lastIndexOf('!');
  return separator > 0 ? safeSheetId(structural.entityId.slice(0, separator)) : undefined;
}

function isCellDomain(value: unknown): boolean {
  return value === 'cell' || value === 'cells' || value === 'cells.values';
}

function sheetIdFromSheetStructuralEntity(value: unknown): string | undefined {
  const structural = isRecord(value) ? value : undefined;
  if (!isSheetDomain(structural?.domain) || typeof structural?.entityId !== 'string') {
    return undefined;
  }
  return safeSheetId(structural.entityId);
}

function isSheetDomain(value: unknown): boolean {
  return value === 'sheet' || value === 'sheets';
}

function sheetIdFromSemanticValue(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value.kind === 'value' ? value.value : value;
  if (!isRecord(raw) || raw.kind !== 'object' || !Array.isArray(raw.fields)) return undefined;
  for (const field of raw.fields) {
    if (isRecord(field) && field.key === 'sheetId') {
      const sheetId = safeSheetId(field.value);
      if (sheetId) return sheetId;
    }
  }
  return undefined;
}

function sheetNameFromSemanticValue(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value.kind === 'value' ? value.value : value;
  if (!isRecord(raw) || raw.kind !== 'object' || !Array.isArray(raw.fields)) return undefined;
  for (const field of raw.fields) {
    if (isRecord(field) && field.key === 'name') {
      const sheetName = safeSheetName(field.value);
      if (sheetName) return sheetName;
    }
  }
  return undefined;
}

function sheetIdFromCellObjectId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cellObjectId = stripObjectPrefix(
    stripObjectPrefix(stripObjectPrefix(value, 'direct-format:'), 'value:'),
    'formula:',
  );
  const match = /^cell:(.+):r[0-9]+:c[0-9]+$/.exec(cellObjectId);
  return match ? safeSheetId(match[1]) : undefined;
}

function sheetIdFromSheetObjectId(value: unknown): string | undefined {
  return typeof value === 'string' ? safeSheetId(stripObjectPrefix(value, 'sheet:')) : undefined;
}

function displayValueString(value: unknown): string | undefined {
  return isRecord(value) && value.kind === 'value' && typeof value.value === 'string'
    ? value.value
    : undefined;
}

function safeSheetId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function safeSheetName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function safeCoordinate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function stripObjectPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Readonly<Record<string, unknown>>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}
