import type {
  CellFormat,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeChange,
  VersionMergeConflict,
  VersionSemanticValue,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { parseCellAddress } from '../internal/utils';

export type MergeMaterializationOperation = 'applyMerge' | 'commitGraphWrite';

export type MergeMaterializationSupport =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly structuralKind: VersionDiffStructuralMetadata['kind'];
      readonly domain: string;
    };

export function inspectMaterializableMergeChange(
  change: Pick<VersionMergeChange, 'structural' | 'merged'>,
): MergeMaterializationSupport {
  const structural = parseMaterializableStructural(change.structural);
  if (!structural) {
    return unsupported(change.structural, 'unsupportedStructuralMetadata');
  }
  if (!parseCellEntity(structural.entityId)) {
    return unsupported(structural, 'unsupportedEntityId');
  }
  if (structural.domain === 'cells.formats.direct') {
    return parseDirectFormatMergeValue(change.merged)
      ? { ok: true }
      : unsupported(structural, 'unsupportedMergedValue');
  }
  return parseCellMergeValue(change.merged)
    ? { ok: true }
    : unsupported(structural, 'unsupportedMergedValue');
}

export function materializableMergePlanDiagnostics(
  input: {
    readonly changes: readonly VersionMergeChange[];
    readonly conflicts?: readonly VersionMergeConflict[];
  },
  operation: MergeMaterializationOperation,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  input.changes.forEach((change, itemIndex) => {
    const support = inspectMaterializableMergeChange(change);
    if (!support.ok) diagnostics.push(unsupportedDiagnostic(operation, itemIndex, support));
  });
  input.conflicts?.forEach((conflict, conflictIndex) => {
    for (const option of conflict.resolutionOptions) {
      const support = inspectMaterializableMergeChange({
        structural: conflict.structural,
        merged: option.value,
      });
      if (!support.ok) {
        diagnostics.push(
          unsupportedDiagnostic(operation, conflictIndex, support, {
            conflictId: conflict.conflictId,
            optionId: option.optionId,
          }),
        );
      }
    }
  });
  return diagnostics;
}

function parseMaterializableStructural(
  structural: VersionDiffStructuralMetadata,
): Extract<VersionDiffStructuralMetadata, { readonly kind: 'metadata' }> | null {
  if (structural.kind !== 'metadata') return null;
  if (structural.domain === 'cells.formats.direct') {
    return structural.propertyPath.length === 1 && structural.propertyPath[0] === 'format'
      ? structural
      : null;
  }
  if (structural.domain !== 'cell' && structural.domain !== 'cells.values') return null;
  if (
    structural.propertyPath.length !== 0 &&
    !(structural.propertyPath.length === 1 && structural.propertyPath[0] === 'value')
  ) {
    return null;
  }
  return structural;
}

function parseCellEntity(entityId: string): boolean {
  const separator = entityId.lastIndexOf('!');
  if (separator <= 0 || separator === entityId.length - 1) return false;
  return Boolean(parseCellAddress(entityId.slice(separator + 1)));
}

function parseCellMergeValue(value: VersionDiffValue): boolean {
  if (value.kind !== 'value') return false;
  return isMaterializableSemanticCellValue(value.value);
}

function parseDirectFormatMergeValue(value: VersionDiffValue): boolean {
  if (value.kind !== 'value') return false;
  if (value.value === null) return true;
  return isMaterializableCellFormat(semanticFormatJsonValue(value.value));
}

function isMaterializableSemanticCellValue(value: VersionSemanticValue): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value !== 'object') return false;
  if (value.kind === 'blank') return true;
  return value.kind === 'formula' && typeof value.formula === 'string' && value.formula.length > 0;
}

function semanticFormatJsonValue(value: VersionSemanticValue, depth = 0): unknown {
  if (depth > 16) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!isRecord(value)) return undefined;
  if (value.kind === 'array') {
    if (!Array.isArray(value.values)) return undefined;
    const values = value.values.map((entry) => semanticFormatJsonValue(entry, depth + 1));
    return values.some((entry) => entry === undefined) ? undefined : values;
  }
  if (value.kind === 'object') {
    if (!Array.isArray(value.fields)) return undefined;
    const record: Record<string, unknown> = {};
    for (const field of value.fields) {
      if (!isRecord(field) || typeof field.key !== 'string') return undefined;
      const mapped = semanticFormatJsonValue(field.value as VersionSemanticValue, depth + 1);
      if (mapped === undefined) return undefined;
      record[field.key] = mapped;
    }
    return record;
  }
  return undefined;
}

function isMaterializableCellFormat(value: unknown): value is CellFormat {
  return isRecord(value) && Object.keys(value).length > 0 && value.kind !== 'Removed';
}

function unsupported(
  structural: VersionDiffStructuralMetadata,
  reason: string,
): Extract<MergeMaterializationSupport, { readonly ok: false }> {
  return {
    ok: false,
    reason,
    structuralKind: structural.kind,
    domain: structural.kind === 'metadata' ? structural.domain : 'redacted',
  };
}

function unsupportedDiagnostic(
  operation: MergeMaterializationOperation,
  itemIndex: number,
  support: Extract<MergeMaterializationSupport, { readonly ok: false }>,
  extra: Readonly<Record<string, string | number | boolean | null>> = {},
): VersionStoreDiagnostic {
  return {
    issueCode: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
    severity: 'error',
    recoverability: 'unsupported',
    messageTemplateId: `version.${operation}.VERSION_MERGE_UNSUPPORTED_DOMAIN`,
    safeMessage:
      'This merge plan contains changes that the current merge materializer cannot apply.',
    payload: {
      operation,
      itemIndex,
      structuralKind: support.structuralKind,
      domain: support.domain,
      reason: support.reason,
      ...extra,
    },
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
