import type {
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionRedactedValue,
  VersionSemanticValue,
  WorkbookVersionReviewDecisionTarget,
} from '@mog-sdk/contracts/api';

import { reviewServiceStructuralTargetSupport } from './review-service-target-support';

const REDACTED_VALUE_REASONS = new Set([
  'permission-denied',
  'redaction-policy',
  'historical-acl-unavailable',
]);
const INCOMPLETE_REVIEW_REDACTED_VALUE_REASONS = new Set([
  'permission-denied',
  'historical-acl-unavailable',
]);
const REVIEW_ACCESS_REDACTED_VALUE: VersionRedactedValue = {
  kind: 'redacted',
  reason: 'permission-denied',
};

const RANGE_REVIEW_VALUE_SPEC = reviewObjectSpec(
  {
    kind: 'string',
    rangeKind: 'string',
    rangeId: 'string',
    encoding: 'string',
    rowCount: 'number',
    colCount: 'number',
    anchor: 'rangeAnchor',
  },
  ['kind', 'rangeKind', 'rangeId', 'encoding', 'rowCount', 'colCount', 'anchor'],
);

const VC06_REVIEW_VALUE_SPECS = {
  namedRangeDefinition: reviewObjectSpec({ kind: 'string', name: 'string' }, ['kind', 'name']),
  tableDefinition: reviewObjectSpec(
    { kind: 'string', tableId: 'string', name: 'string', sheetId: 'string' },
    ['kind', 'tableId', 'sheetId'],
  ),
  commentCell: reviewObjectSpec({ kind: 'string', cellId: 'string', address: 'string' }, [
    'kind',
    'cellId',
  ]),
  conditionalFormatRule: reviewObjectSpec({ kind: 'string', ruleId: 'string' }, ['kind', 'ruleId']),
  filterState: reviewObjectSpec(
    {
      kind: 'string',
      filterId: 'string',
      filterKind: 'string',
      tableId: 'string',
      capability: 'string',
      hasActiveFilter: 'boolean',
      clearable: 'boolean',
      action: 'string',
      hiddenRowCount: 'number',
      visibleRowCount: 'number',
      unsupportedReasons: 'stringArray',
    },
    ['kind'],
  ),
  sortOrder: reviewObjectSpec({ kind: 'string', range: 'string', rowsMoved: 'number' }, [
    'kind',
    'range',
    'rowsMoved',
  ]),
  chartSourceRange: reviewObjectSpec(
    {
      kind: 'string',
      objectId: 'string',
      objectType: 'string',
      changedFields: 'stringArray',
      chartType: 'string',
      dataRange: 'string',
      seriesRange: 'string',
      categoryRange: 'string',
      sourceTableId: 'string',
      tableCategoryColumn: 'string',
      tableDataColumns: 'stringArray',
      tableColumnNames: 'stringArray',
    },
    ['kind', 'objectId', 'objectType'],
  ),
  floatingObjectAnchor: reviewObjectSpec(
    {
      kind: 'string',
      objectId: 'string',
      objectType: 'string',
      changedFields: 'stringArray',
      anchor: 'floatingAnchor',
      bounds: 'floatingBounds',
      width: 'number',
      height: 'number',
      zIndex: 'number',
      rotation: 'number',
    },
    ['kind', 'objectId'],
  ),
} as const;

type ReviewFieldKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'stringOrNumber'
  | 'stringArray'
  | 'rangeAnchor'
  | 'floatingAnchor'
  | 'floatingBounds';

type ReviewObjectSpec = {
  readonly fields: Readonly<Record<string, ReviewFieldKind>>;
  readonly required: readonly string[];
};

export function projectReviewAccessDiffValue(
  structural: VersionDiffStructuralMetadata,
  value: unknown,
): VersionDiffValue | null | undefined {
  if (!reviewServiceStructuralTargetSupport(structural).ok) return null;

  const reviewSpec = reviewSpecForStructural(structural);
  if (reviewSpec === undefined) return undefined;
  if (reviewSpec === null) return null;

  const redacted = mapRedactedValue(value);
  if (redacted) return redacted;
  if (!isRecord(value) || value.kind !== 'value') return null;

  const semanticValue = projectReviewSemanticValue(value.value, reviewSpec);
  return semanticValue === undefined ? null : { kind: 'value', value: semanticValue };
}

export function projectReviewAccessChangeValue(
  structural: VersionDiffStructuralMetadata,
  value: VersionDiffValue,
): VersionDiffValue {
  const projected = projectReviewAccessDiffValue(structural, value);
  if (projected === undefined) return cloneJson(value);
  return projected ?? REVIEW_ACCESS_REDACTED_VALUE;
}

export function structuralFromReviewTarget(
  target: WorkbookVersionReviewDecisionTarget,
): VersionDiffStructuralMetadata | null {
  if (target.kind !== 'semanticChange') return null;
  return {
    kind: 'metadata',
    changeId: target.changeId,
    domain: target.entityKind,
    entityId: target.entityId,
    propertyPath: [...target.propertyPath],
  };
}

export function isIncompleteReviewRedactedValue(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.kind === 'redacted' &&
    typeof value.reason === 'string' &&
    INCOMPLETE_REVIEW_REDACTED_VALUE_REASONS.has(value.reason)
  );
}

function reviewSpecForStructural(
  structural: VersionDiffStructuralMetadata,
): ReviewObjectSpec | null | undefined {
  if (structural.kind !== 'metadata') return undefined;

  switch (structural.domain) {
    case 'named-ranges':
      if (hasPropertyPath(structural, ['definition'])) {
        return VC06_REVIEW_VALUE_SPECS.namedRangeDefinition;
      }
      if (hasPropertyPath(structural, ['range'])) return RANGE_REVIEW_VALUE_SPEC;
      return null;
    case 'tables':
      if (hasPropertyPath(structural, ['definition'])) {
        return VC06_REVIEW_VALUE_SPECS.tableDefinition;
      }
      if (hasPropertyPath(structural, ['range'])) return RANGE_REVIEW_VALUE_SPEC;
      return null;
    case 'comments-notes':
      return hasPropertyPath(structural, ['cell']) ? VC06_REVIEW_VALUE_SPECS.commentCell : null;
    case 'conditional-formatting':
      if (hasPropertyPath(structural, ['rule'])) {
        return VC06_REVIEW_VALUE_SPECS.conditionalFormatRule;
      }
      if (hasPropertyPath(structural, ['range'])) return RANGE_REVIEW_VALUE_SPEC;
      return null;
    case 'data-validation':
      return hasPropertyPath(structural, ['range']) ? RANGE_REVIEW_VALUE_SPEC : null;
    case 'filters':
      return hasPropertyPath(structural, ['state']) ? VC06_REVIEW_VALUE_SPECS.filterState : null;
    case 'sorts':
      return hasPropertyPath(structural, ['order']) ? VC06_REVIEW_VALUE_SPECS.sortOrder : null;
    case 'charts.source-range':
      return hasPropertyPath(structural, ['sourceRange'])
        ? VC06_REVIEW_VALUE_SPECS.chartSourceRange
        : null;
    case 'floating-objects.anchors':
      return hasPropertyPath(structural, ['anchor'])
        ? VC06_REVIEW_VALUE_SPECS.floatingObjectAnchor
        : null;
    default:
      return undefined;
  }
}

function projectReviewSemanticValue(
  value: unknown,
  spec: ReviewObjectSpec,
): VersionSemanticValue | undefined {
  if (value === null) return null;
  if (!isRecord(value) || value.kind !== 'object' || !Array.isArray(value.fields)) {
    return undefined;
  }

  const fields: { readonly key: string; readonly value: VersionSemanticValue }[] = [];
  const seen = new Set<string>();
  for (const field of value.fields) {
    if (!isRecord(field) || typeof field.key !== 'string') return undefined;
    const fieldKind = spec.fields[field.key];
    if (!fieldKind || seen.has(field.key)) return undefined;
    seen.add(field.key);
    const mappedValue = projectReviewFieldValue(field.value, fieldKind);
    if (mappedValue === undefined) return undefined;
    fields.push({ key: field.key, value: mappedValue });
  }

  for (const required of spec.required) {
    if (!seen.has(required)) return undefined;
  }
  return { kind: 'object', fields };
}

function projectReviewFieldValue(
  value: unknown,
  fieldKind: ReviewFieldKind,
): VersionSemanticValue | undefined {
  switch (fieldKind) {
    case 'string':
      return typeof value === 'string' ? value : undefined;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'stringOrNumber':
      if (typeof value === 'string') return value;
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    case 'stringArray':
      return projectStringArrayValue(value);
    case 'rangeAnchor':
      return projectNestedReviewObject(
        value,
        reviewObjectSpec(
          {
            kind: 'string',
            startRow: 'stringOrNumber',
            endRow: 'stringOrNumber',
            startCol: 'stringOrNumber',
            endCol: 'stringOrNumber',
            rowCount: 'number',
            colCount: 'number',
            firstRowId: 'string',
            lastRowId: 'string',
            firstColId: 'string',
            lastColId: 'string',
          },
          ['kind'],
        ),
      );
    case 'floatingAnchor':
      return projectNestedReviewObject(
        value,
        reviewObjectSpec(
          {
            anchorRow: 'number',
            anchorCol: 'number',
            anchorRowOffsetEmu: 'number',
            anchorColOffsetEmu: 'number',
            anchorMode: 'string',
            absoluteXEmu: 'number',
            absoluteYEmu: 'number',
            endRow: 'number',
            endCol: 'number',
            endRowOffsetEmu: 'number',
            endColOffsetEmu: 'number',
            extentCxEmu: 'number',
            extentCyEmu: 'number',
          },
          [],
        ),
      );
    case 'floatingBounds':
      return projectNestedReviewObject(
        value,
        reviewObjectSpec(
          { x: 'number', y: 'number', width: 'number', height: 'number', rotation: 'number' },
          [],
        ),
      );
    default:
      return undefined;
  }
}

function projectNestedReviewObject(
  value: unknown,
  spec: ReviewObjectSpec,
): VersionSemanticValue | undefined {
  const projected = projectReviewSemanticValue(value, spec);
  return isRecord(projected) && projected.kind === 'object' ? projected : undefined;
}

function projectStringArrayValue(value: unknown): VersionSemanticValue | undefined {
  if (!isRecord(value) || value.kind !== 'array' || !Array.isArray(value.values)) {
    return undefined;
  }
  if (!value.values.every((item) => typeof item === 'string')) return undefined;
  return { kind: 'array', values: [...(value.values as string[])] };
}

function mapRedactedValue(value: unknown): VersionRedactedValue | null {
  if (!isRecord(value) || value.kind !== 'redacted' || typeof value.reason !== 'string') {
    return null;
  }
  if (!REDACTED_VALUE_REASONS.has(value.reason)) return null;
  if (INCOMPLETE_REVIEW_REDACTED_VALUE_REASONS.has(value.reason)) return null;
  return {
    kind: 'redacted',
    reason: value.reason as VersionRedactedValue['reason'],
  };
}

function hasPropertyPath(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  expected: readonly string[],
): boolean {
  return (
    structural.propertyPath.length === expected.length &&
    expected.every((segment, index) => structural.propertyPath[index] === segment)
  );
}

function reviewObjectSpec(
  fields: Readonly<Record<string, ReviewFieldKind>>,
  required: readonly string[],
): ReviewObjectSpec {
  return { fields, required };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
