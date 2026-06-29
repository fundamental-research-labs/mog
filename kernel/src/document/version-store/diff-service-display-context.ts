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

function sheetIdForSemanticChange(value: Readonly<Record<string, unknown>>): string | undefined {
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

function collectSheetNamesFromChange(value: unknown, sheetNames: Map<string, string>): void {
  if (!isRecord(value)) return;
  collectSheetNameFromRecordEvidence(value.beforeRecord, sheetNames);
  collectSheetNameFromRecordEvidence(value.afterRecord, sheetNames);

  const sheetId = sheetIdForSemanticChange(value);
  const displaySheetName = displaySheetNameForSheetSemanticChange(value);
  if (displaySheetName && sheetId) sheetNames.set(sheetId, displaySheetName);
}

function collectSheetNameFromRecordEvidence(value: unknown, sheetNames: Map<string, string>): void {
  const evidence = recordEvidence(value);
  if (!evidence) return;

  const sheetId =
    safeSheetId(evidence.sheetId) ??
    sheetIdFromSheetRecordEvidence(evidence) ??
    sheetIdFromCellObjectId(evidence.objectId);
  const sheetName = safeSheetName(evidence.sheetName) ?? sheetNameFromSheetRecordEvidence(evidence);
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

function stripObjectPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
