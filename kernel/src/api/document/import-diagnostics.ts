import type {
  ImportDiagnosticDto,
  ImportDiagnosticLocation,
} from '@mog-sdk/contracts/data/diagnostics';
import type { DocumentImportWarning } from '@mog-sdk/contracts/document';
import type { MogImportWarning } from '@mog-sdk/contracts/sdk';

import type {
  ImportDiagnostic as WireImportDiagnostic,
  ImportDiagnosticRef as WireImportDiagnosticRef,
} from '../../bridges/compute/compute-types.gen';

export function projectImportDiagnostic(diagnostic: WireImportDiagnostic): ImportDiagnosticDto {
  const reference = diagnostic.reference
    ? projectImportDiagnosticReference(diagnostic.reference)
    : undefined;
  const details = jsonCompatibleDiagnosticValue((diagnostic as { details?: unknown }).details);
  const importPhases = (diagnostic as { importPhases?: ImportDiagnosticDto['importPhases'] })
    .importPhases;
  const firstImportPhase = (
    diagnostic as { firstImportPhase?: ImportDiagnosticDto['firstImportPhase'] }
  ).firstImportPhase;

  return stripUndefined({
    id: diagnostic.id,
    code: enumDiscriminant(diagnostic.code),
    severity: normalizeImportSeverity(diagnostic.severity),
    feature: enumDiscriminant(diagnostic.feature),
    recoverability: enumDiscriminant(diagnostic.recoverability),
    message: diagnostic.message,
    reason: primaryReason(details),
    details: details as ImportDiagnosticDto['details'],
    reference,
    location: reference,
    importPhases,
    firstImportPhase,
  });
}

export function documentImportWarningsFromDiagnostics(
  diagnostics: readonly ImportDiagnosticDto[],
): DocumentImportWarning[] {
  return diagnostics.map((diagnostic) => ({
    id: diagnostic.id,
    type: warningTypeForDiagnostic(diagnostic),
    message: diagnostic.message,
    severity: diagnostic.severity,
    recoverability: diagnostic.recoverability,
    feature: diagnostic.feature,
    reason: diagnostic.reason,
    details: diagnostic.details,
    diagnostic,
    location: warningLocation(diagnostic),
  }));
}

export function mapDocumentImportWarningToMogImportWarning(
  warning: DocumentImportWarning,
): MogImportWarning {
  return {
    id: warning.id,
    type: warning.type as MogImportWarning['type'],
    message: warning.message,
    severity: warning.severity,
    recoverability: warning.recoverability,
    feature: warning.feature,
    reason: warning.reason,
    details: warning.details,
    diagnostic: warning.diagnostic,
    location: warning.location,
  };
}

function projectImportDiagnosticReference(
  reference: WireImportDiagnosticRef,
): ImportDiagnosticLocation {
  const extended = reference as WireImportDiagnosticRef & {
    filterColId?: number;
    tableColumnOrdinal?: number;
    unresolvedFilterColId?: number;
    unresolvedTableColumnOrdinal?: number;
  };
  const location: ImportDiagnosticLocation = {
    sheet: reference.sheetName,
    cell: reference.cellRef,
    sheetIndex: reference.sheetIndex,
    sheetName: reference.sheetName,
    sourceRange: reference.sourceRange,
    row: reference.row,
    col: reference.col,
    cellRef: reference.cellRef,
    objectId: reference.objectId,
    filterColId: extended.filterColId,
    tableColumnOrdinal: extended.tableColumnOrdinal,
    unresolvedFilterColId: extended.unresolvedFilterColId,
    unresolvedTableColumnOrdinal: extended.unresolvedTableColumnOrdinal,
  };
  return stripUndefined(location);
}

function warningLocation(diagnostic: ImportDiagnosticDto): ImportDiagnosticLocation | undefined {
  const location = diagnostic.location ?? diagnostic.reference;
  if (!location) return undefined;
  return stripUndefined({
    ...location,
    sheet: location.sheet ?? location.sheetName,
    cell: location.cell ?? location.cellRef,
  });
}

function warningTypeForDiagnostic(diagnostic: ImportDiagnosticDto): DocumentImportWarning['type'] {
  switch (diagnostic.code) {
    case 'unsupportedFeature':
    case 'unsupportedChartType':
    case 'unsupportedFormulaFunction':
    case 'unsupportedVersion':
    case 'unsupportedEncryption':
      return 'unsupported_feature';
    case 'formulaParseFailed':
    case 'invalidFormula':
    case 'recalcRequired':
      return 'formula_error';
    case 'invalidStyleIndex':
    case 'roundTripLoss':
      return 'format_loss';
    default:
      return 'import_error';
  }
}

function primaryReason(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const reasons = (details as { reasons?: unknown }).reasons;
  if (!Array.isArray(reasons)) return undefined;
  return typeof reasons[0] === 'string' ? reasons[0] : undefined;
}

function normalizeImportSeverity(value: unknown): ImportDiagnosticDto['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' || value === 'fatal'
    ? value
    : 'warning';
}

function enumDiscriminant(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return String(value);
  const [key, payload] = Object.entries(value)[0] ?? [];
  if (!key) return String(value);
  return key === 'legacyParseCode' ? `${key}:${String(payload)}` : key;
}

function stripUndefined<T extends object>(value: T): T {
  const mutable = value as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (mutable[key] === undefined) delete mutable[key];
  }
  return value;
}

function jsonCompatibleDiagnosticValue(value: unknown): unknown {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  }
  if (Array.isArray(value)) {
    const projected: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const child = Object.prototype.hasOwnProperty.call(value, index)
        ? jsonCompatibleDiagnosticValue(value[index])
        : undefined;
      projected.push(child === undefined ? null : child);
    }
    return projected;
  }
  if (isPlainRecord(value)) {
    const projected: Record<string, unknown> = {};
    for (const [key, childValue] of Object.entries(value)) {
      const child = jsonCompatibleDiagnosticValue(childValue);
      if (child !== undefined) projected[key] = child;
    }
    return projected;
  }
  return undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
