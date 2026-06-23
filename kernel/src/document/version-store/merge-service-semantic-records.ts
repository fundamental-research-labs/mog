import type {
  VersionDiffDisplay,
  VersionDiffDisplayValue,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionRedactedValue,
  VersionSemanticValue,
  VersionStoreDiagnostic as PublicVersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';
import { parseCellAddress } from '@mog/spreadsheet-utils/a1';

type MergeDiagnostic = PublicVersionStoreDiagnostic;
type RowColumnAxis = 'row' | 'column';

type RowColumnTarget = {
  readonly sheetId: string;
  readonly axis: RowColumnAxis;
  readonly index: number;
};

type RowColumnMergeValue =
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'present';
      readonly sheetId: string;
      readonly axis: RowColumnAxis;
      readonly index: number;
    };

type SemanticValueChangeSupport =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: string;
    };

export type SemanticValueChange = {
  readonly key: string;
  readonly structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>;
  readonly before: VersionDiffValue;
  readonly after: VersionDiffValue;
  readonly display?: VersionDiffDisplay;
};

type ParsedSemanticChangeSet =
  | {
      readonly ok: true;
      readonly changes: readonly SemanticValueChange[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly MergeDiagnostic[];
    };

type ParsedSemanticChange =
  | {
      readonly ok: true;
      readonly change: SemanticValueChange;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly MergeDiagnostic[];
    };

const REDACTED_VALUE_REASONS = new Set([
  'permission-denied',
  'redaction-policy',
  'historical-acl-unavailable',
]);

const SUPPORTED_SEMANTIC_MERGE_DOMAINS = new Set([
  'cell',
  'cells.values',
  'cells.formulas',
  'cells.formats.direct',
  'rows-columns',
]);

export function parseSemanticChangeSet(
  payload: unknown,
  branch: 'ours' | 'theirs',
): ParsedSemanticChangeSet {
  if (!isRecord(payload) || payload.schemaVersion !== 1) {
    return unsupportedChangeSet(branch);
  }

  const values = Array.isArray(payload.reviewChanges)
    ? payload.reviewChanges
    : Array.isArray(payload.changes)
      ? payload.changes
      : null;
  if (!values) return unsupportedChangeSet(branch);

  const changes: SemanticValueChange[] = [];
  const seenKeys = new Set<string>();
  for (let index = 0; index < values.length; index++) {
    const parsed = parseSemanticChange(values[index], branch, index);
    if (!parsed.ok) return parsed;
    if (seenKeys.has(parsed.change.key)) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_UNSUPPORTED_SCHEMA',
            'Merge preview cannot classify duplicate value changes for the same property.',
            { payload: { branch, itemIndex: index } },
          ),
        ],
      };
    }
    seenKeys.add(parsed.change.key);
    changes.push(parsed.change);
  }

  return { ok: true, changes };
}

export function stableMergePairStructural(
  left: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  right: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): Exclude<VersionDiffStructuralMetadata, VersionRedactedValue> {
  if (isCellContentMergeDomain(left.domain) && isCellContentMergeDomain(right.domain)) {
    const formulasOnly = left.domain === 'cells.formulas' && right.domain === 'cells.formulas';
    return {
      kind: 'metadata',
      changeId: left.changeId,
      domain: formulasOnly ? 'cells.formulas' : 'cells.values',
      entityId: left.entityId,
      propertyPath: formulasOnly ? ['formula'] : ['value'],
    };
  }
  if (left.domain === 'rows-columns' && right.domain === 'rows-columns') {
    return { ...left, domain: 'rows-columns', propertyPath: ['order'] };
  }
  if (left.domain === 'cells.formats.direct' && right.domain === 'cells.formats.direct') {
    return { ...left, domain: 'cells.formats.direct', propertyPath: ['format'] };
  }
  return left;
}

function parseSemanticChange(
  value: unknown,
  branch: 'ours' | 'theirs',
  itemIndex: number,
): ParsedSemanticChange {
  if (!isRecord(value)) return unsupportedChange(branch, itemIndex);
  if (isOpaqueSemanticDiffRecord(value)) {
    return opaqueSemanticChange(branch, itemIndex, {
      reason: 'opaqueSemanticDiffRecord',
      domain: value.domainId,
      objectKind: typeof value.objectKind === 'string' ? value.objectKind : undefined,
    });
  }
  if (
    hasRedactedValue(value.structural) ||
    hasRedactedValue(value.before) ||
    hasRedactedValue(value.after)
  ) {
    return redactedChange(branch, itemIndex);
  }

  const structural = mapStructuralMetadata(value);
  if (!structural) return unsupportedChange(branch, itemIndex);
  if (!allowsEmptySemanticPropertyPath(structural.domain) && structural.propertyPath.length === 0) {
    return unsupportedChange(branch, itemIndex);
  }

  const before = mapDiffValue(value.before);
  const after = mapDiffValue(value.after);
  if (!before || !after) {
    return hasOpaqueSemanticValue(value.before) || hasOpaqueSemanticValue(value.after)
      ? opaqueSemanticChange(branch, itemIndex, {
          reason: 'opaqueSemanticValue',
          domain: structural.domain,
        })
      : unsupportedChange(branch, itemIndex);
  }

  const support = inspectSupportedSemanticValueChange(structural, before, after);
  if (!support.ok) return unsupportedDomainChange(branch, itemIndex, structural, support.reason);

  const display = value.display === undefined ? undefined : mapDiffDisplay(value.display);
  if (value.display !== undefined && !display) {
    return hasRedactedDisplay(value.display)
      ? redactedChange(branch, itemIndex)
      : unsupportedChange(branch, itemIndex);
  }

  return {
    ok: true,
    change: {
      key: semanticMergePropertyKey(structural),
      structural,
      before,
      after,
      ...(display ? { display } : {}),
    },
  };
}

function inspectSupportedSemanticValueChange(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  before: VersionDiffValue,
  after: VersionDiffValue,
): SemanticValueChangeSupport {
  if (!SUPPORTED_SEMANTIC_MERGE_DOMAINS.has(structural.domain)) {
    return { ok: false, reason: 'unsupportedDomain' };
  }

  if (isCellContentMergeDomain(structural.domain)) {
    if (!hasMaterializableCellEntity(structural.entityId)) {
      return { ok: false, reason: 'unsupportedEntityId' };
    }
    if (!isSupportedCellPropertyPath(structural.domain, structural.propertyPath)) {
      return { ok: false, reason: 'unsupportedPropertyPath' };
    }
    const supported =
      structural.domain === 'cells.formulas'
        ? isMaterializableFormulaCellDiffValue(before) &&
          isMaterializableFormulaCellDiffValue(after)
        : isMaterializableSemanticCellDiffValue(before) &&
          isMaterializableSemanticCellDiffValue(after);
    return supported
      ? { ok: true }
      : {
          ok: false,
          reason:
            structural.domain === 'cells.formulas'
              ? 'unsupportedFormulaValue'
              : 'unsupportedCellValue',
        };
  }

  if (structural.domain === 'rows-columns') {
    const target = parseRowColumnEntity(structural.entityId);
    if (!target) return { ok: false, reason: 'unsupportedEntityId' };
    if (!(structural.propertyPath.length === 1 && structural.propertyPath[0] === 'order')) {
      return { ok: false, reason: 'unsupportedPropertyPath' };
    }
    return isSupportedRowColumnTransition({ before, after }, target)
      ? { ok: true }
      : { ok: false, reason: 'unsupportedRowsColumnsTransition' };
  }

  if (!hasMaterializableCellEntity(structural.entityId)) {
    return { ok: false, reason: 'unsupportedEntityId' };
  }
  if (!(structural.propertyPath.length === 1 && structural.propertyPath[0] === 'format')) {
    return { ok: false, reason: 'unsupportedPropertyPath' };
  }
  return { ok: true };
}

function isSupportedCellPropertyPath(domain: string, propertyPath: readonly string[]): boolean {
  if (domain === 'cell') return propertyPath.length === 1 && propertyPath[0] === 'value';
  if (domain === 'cells.values') {
    return propertyPath.length === 0 || (propertyPath.length === 1 && propertyPath[0] === 'value');
  }
  return (
    propertyPath.length === 0 ||
    (propertyPath.length === 1 && (propertyPath[0] === 'formula' || propertyPath[0] === 'value'))
  );
}

function semanticMergePropertyKey(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): string {
  if (isCellContentMergeDomain(structural.domain)) {
    return JSON.stringify(['cells.values', structural.entityId, ['value']]);
  }
  if (structural.domain === 'rows-columns') {
    return JSON.stringify(['rows-columns', structural.entityId, ['order']]);
  }
  if (structural.domain === 'cells.formats.direct') {
    return JSON.stringify(['cells.formats.direct', structural.entityId, ['format']]);
  }
  return JSON.stringify([structural.domain, structural.entityId, structural.propertyPath]);
}

function isCellContentMergeDomain(domain: string): boolean {
  return domain === 'cell' || domain === 'cells.values' || domain === 'cells.formulas';
}

function allowsEmptySemanticPropertyPath(domain: string): boolean {
  return domain === 'cells.values' || domain === 'cells.formulas';
}

function hasMaterializableCellEntity(entityId: string): boolean {
  const separator = entityId.lastIndexOf('!');
  if (separator <= 0 || separator === entityId.length - 1) return false;
  return Boolean(parseCellAddress(entityId.slice(separator + 1)));
}

function parseRowColumnEntity(entityId: string): RowColumnTarget | null {
  const separator = entityId.lastIndexOf('!');
  if (separator <= 0 || separator === entityId.length - 1) return null;
  const sheetId = entityId.slice(0, separator);
  const axisAndIndex = entityId.slice(separator + 1);
  const axisSeparator = axisAndIndex.lastIndexOf(':');
  if (axisSeparator <= 0 || axisSeparator === axisAndIndex.length - 1) return null;
  const rawAxis = axisAndIndex.slice(0, axisSeparator);
  const axis = rawAxis === 'row' || rawAxis === 'column' ? rawAxis : null;
  if (!axis) return null;
  const index = Number(axisAndIndex.slice(axisSeparator + 1));
  if (!Number.isSafeInteger(index) || index < 0) return null;
  return { sheetId, axis, index };
}

function isMaterializableSemanticCellDiffValue(value: VersionDiffValue): boolean {
  return value.kind === 'value' && isMaterializableSemanticCellValue(value.value);
}

function isMaterializableFormulaCellDiffValue(value: VersionDiffValue): boolean {
  return value.kind === 'value' && isMaterializableFormulaCellValue(value.value);
}

function isMaterializableSemanticCellValue(value: VersionSemanticValue): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (!isRecord(value)) return false;
  if (value.kind === 'blank') return true;
  return value.kind === 'formula' && typeof value.formula === 'string' && value.formula.length > 0;
}

function isMaterializableFormulaCellValue(value: VersionSemanticValue): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (value.kind === 'blank') return true;
  return value.kind === 'formula' && typeof value.formula === 'string' && value.formula.length > 0;
}

function isSupportedRowColumnTransition(
  change: { readonly before: VersionDiffValue; readonly after: VersionDiffValue },
  target: RowColumnTarget,
): boolean {
  const before = parseRowColumnMergeValue(change.before, target);
  const after = parseRowColumnMergeValue(change.after, target);
  if (!before || !after) return false;
  if (rowColumnValuesEqual(before, after)) return true;
  return (
    (before.kind === 'absent' && after.kind === 'present') ||
    (before.kind === 'present' && after.kind === 'absent')
  );
}

function parseRowColumnMergeValue(
  value: VersionDiffValue,
  target: RowColumnTarget,
): RowColumnMergeValue | null {
  if (value.kind !== 'value') return null;
  if (value.value === null) return { kind: 'absent' };
  const fields = semanticObjectFieldMap(value.value);
  if (!fields) return null;
  if (
    fields.get('axis') !== target.axis ||
    fields.get('sheetId') !== target.sheetId ||
    fields.get('index') !== target.index
  ) {
    return null;
  }
  return { kind: 'present', sheetId: target.sheetId, axis: target.axis, index: target.index };
}

function rowColumnValuesEqual(left: RowColumnMergeValue, right: RowColumnMergeValue): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'absent' || right.kind === 'absent') return true;
  return left.sheetId === right.sheetId && left.axis === right.axis && left.index === right.index;
}

function semanticObjectFieldMap(
  value: VersionSemanticValue,
): Map<string, VersionSemanticValue> | null {
  if (!isRecord(value) || value.kind !== 'object' || !Array.isArray(value.fields)) return null;
  const fields = new Map<string, VersionSemanticValue>();
  for (const field of value.fields) {
    if (!isRecord(field) || typeof field.key !== 'string') return null;
    fields.set(field.key, field.value as VersionSemanticValue);
  }
  return fields;
}

function mapStructuralMetadata(
  value: Readonly<Record<string, unknown>>,
): Exclude<VersionDiffStructuralMetadata, VersionRedactedValue> | null {
  const source = isRecord(value.structural) ? value.structural : value;
  if (hasRedactedValue(source)) return null;

  if (
    typeof source.changeId !== 'string' ||
    typeof source.domain !== 'string' ||
    source.domain.trim().length === 0 ||
    typeof source.entityId !== 'string' ||
    source.entityId.trim().length === 0 ||
    !Array.isArray(source.propertyPath) ||
    !source.propertyPath.every(
      (segment) => typeof segment === 'string' && segment.trim().length > 0,
    )
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
  if (hasRedactedValue(value)) return null;
  if (!isRecord(value) || value.kind !== 'value') return null;

  const semanticValue = mapSemanticValue(value.value);
  if (semanticValue === undefined) return null;
  return { kind: 'value', value: semanticValue };
}

function mapDiffDisplay(value: unknown): VersionDiffDisplay | null {
  if (!isRecord(value) || hasRedactedDisplay(value)) return null;

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
  if (hasRedactedValue(value)) return null;
  if (!isRecord(value) || value.kind !== 'value' || typeof value.value !== 'string') return null;
  return { kind: 'value', value: value.value };
}

function hasRedactedDisplay(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['sheetName', 'address', 'entityLabel'].some((key) => hasRedactedValue(value[key]));
}

function hasRedactedValue(value: unknown): value is VersionRedactedValue {
  return (
    isRecord(value) &&
    value.kind === 'redacted' &&
    typeof value.reason === 'string' &&
    REDACTED_VALUE_REASONS.has(value.reason)
  );
}

function hasOpaqueSemanticValue(value: unknown, depth = 0): boolean {
  if (depth > 16 || !isRecord(value)) return false;
  if (value.kind === 'opaque') return true;
  if (isRecord(value.digest) && value.digest.algorithm === 'opaque') return true;
  if (value.kind === 'value') return hasOpaqueSemanticValue(value.value, depth + 1);
  if (Array.isArray(value.values)) {
    return value.values.some((item) => hasOpaqueSemanticValue(item, depth + 1));
  }
  if (Array.isArray(value.fields)) {
    return value.fields.some(
      (field) => isRecord(field) && hasOpaqueSemanticValue(field.value, depth + 1),
    );
  }
  return false;
}

function isOpaqueSemanticDiffRecord(
  value: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, unknown>> & { readonly domainId: string } {
  return (
    typeof value.changeId === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.domainId === 'string' &&
    typeof value.objectId === 'string' &&
    (typeof value.objectKind === 'string' ||
      value.beforeDigest !== undefined ||
      value.afterDigest !== undefined)
  );
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

function unsupportedChangeSet(branch: 'ours' | 'theirs'): ParsedSemanticChangeSet {
  return {
    ok: false,
    diagnostics: [
      diagnostic(
        'VERSION_UNSUPPORTED_SCHEMA',
        'Semantic change-set payload is not supported by merge preview.',
        { payload: { branch } },
      ),
    ],
  };
}

function unsupportedChange(branch: 'ours' | 'theirs', itemIndex: number): ParsedSemanticChange {
  return {
    ok: false,
    diagnostics: [
      diagnostic(
        'VERSION_UNSUPPORTED_SCHEMA',
        'Semantic change record is not supported by merge preview.',
        { payload: { branch, itemIndex } },
      ),
    ],
  };
}

function unsupportedDomainChange(
  branch: 'ours' | 'theirs',
  itemIndex: number,
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  reason: string,
): ParsedSemanticChange {
  return {
    ok: false,
    diagnostics: [
      diagnostic(
        'VERSION_MERGE_UNSUPPORTED_DOMAIN',
        'Merge preview supports only allowlisted semantic value changes.',
        {
          payload: {
            branch,
            itemIndex,
            domain: structural.domain,
            propertyPath: structural.propertyPath.join('.'),
            reason,
          },
        },
      ),
    ],
  };
}

function opaqueSemanticChange(
  branch: 'ours' | 'theirs',
  itemIndex: number,
  details: {
    readonly reason: string;
    readonly domain?: string;
    readonly objectKind?: string;
  },
): ParsedSemanticChange {
  return {
    ok: false,
    diagnostics: [
      diagnostic(
        'VERSION_MERGE_UNSUPPORTED_DOMAIN',
        'Merge preview cannot classify opaque semantic change records.',
        {
          payload: {
            branch,
            itemIndex,
            reason: details.reason,
            ...(details.domain ? { domain: details.domain } : {}),
            ...(details.objectKind ? { objectKind: details.objectKind } : {}),
          },
        },
      ),
    ],
  };
}

function redactedChange(branch: 'ours' | 'theirs', itemIndex: number): ParsedSemanticChange {
  return {
    ok: false,
    diagnostics: [
      diagnostic(
        'VERSION_REDACTION_VIOLATION',
        'Merge preview cannot classify redacted semantic change records.',
        { recoverability: 'unsupported', payload: { branch, itemIndex } },
      ),
    ],
  };
}

function diagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: MergeDiagnostic['severity'];
    readonly recoverability?: MergeDiagnostic['recoverability'];
    readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
  } = {},
): MergeDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.merge.${issueCode}` as MergeDiagnostic['messageTemplateId'],
    safeMessage,
    ...(options.payload ? { payload: { operation: 'merge', ...options.payload } } : {}),
    redacted: true,
  };
}

function recoverabilityForIssue(issueCode: string): MergeDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_MERGE_UNSUPPORTED_DOMAIN':
    case 'VERSION_REDACTION_VIOLATION':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return 'unsupported';
    default:
      return 'none';
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
