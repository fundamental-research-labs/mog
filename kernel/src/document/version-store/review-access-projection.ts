import type {
  VersionAuthor,
  VersionDiagnostic,
  VersionDiffEntry,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionRedactedValue,
  VersionSemanticValue,
  WorkbookVersionReviewApprovalEvidence,
  WorkbookVersionReviewDecision,
  WorkbookVersionReviewDecisionTarget,
  WorkbookVersionReviewDiffChange,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

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
const SENSITIVE_PRINCIPAL_TOKEN_RE =
  /\b(?:principal|actor|reviewer|agent|user)[_-][A-Za-z0-9_.:-]+\b/g;
const SENSITIVE_REF_TOKEN_RE = /\brefs\/[A-Za-z0-9._/@:-]+\b/g;
const SENSITIVE_BRANCH_OR_REF_FIELD_RE =
  /\b((?:branch|ref)(?:\s*(?:name|id)?\s*[:=]\s*))[A-Za-z0-9._/@:-]+\b/gi;

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
  const reviewSpec = reviewSpecForStructural(structural);
  if (reviewSpec === undefined) return undefined;
  if (reviewSpec === null) return null;

  const redacted = mapRedactedValue(value);
  if (redacted) return redacted;
  if (!isRecord(value) || value.kind !== 'value') return null;

  const semanticValue = projectReviewSemanticValue(value.value, reviewSpec);
  return semanticValue === undefined ? null : { kind: 'value', value: semanticValue };
}

export function projectReviewAccessRecordSummary(
  record: WorkbookVersionReviewRecordSummary,
): WorkbookVersionReviewRecordSummary {
  return {
    ...cloneJson(record),
    ...(record.title === undefined ? {} : { title: sanitizeDiagnosticString(record.title) }),
    createdBy: projectReviewAccessAuthor(record.createdBy),
  };
}

export function projectReviewAccessRecord(
  record: WorkbookVersionReviewRecord,
): WorkbookVersionReviewRecord {
  const summary = projectReviewAccessRecordSummary(record);
  return {
    ...cloneJson(record),
    ...summary,
    decisions: record.decisions.map(projectReviewAccessDecision),
    ...(record.approval === undefined
      ? {}
      : { approval: projectReviewAccessApproval(record.approval) }),
    redaction: {
      policy: cloneJson(record.redaction.policy),
      redactedFields: record.redaction.redactedFields.includes('reviewAuthors.principalTrace')
        ? [...record.redaction.redactedFields]
        : [...record.redaction.redactedFields, 'reviewAuthors.principalTrace'],
      diagnostics: sanitizeVersionDiagnostics(record.redaction.diagnostics),
    },
    diagnostics: sanitizeVersionDiagnostics(record.diagnostics),
  };
}

export function projectReviewAccessDiffPage(
  page: WorkbookVersionReviewDiffPage,
):
  | { readonly ok: true; readonly value: WorkbookVersionReviewDiffPage }
  | { readonly ok: false; readonly diagnostics: readonly VersionDiagnostic[] } {
  const blockingDiagnostics = blockingReviewDiffDiagnostics(page);
  if (blockingDiagnostics.length > 0) {
    return { ok: false, diagnostics: blockingDiagnostics };
  }

  if (hiddenAuthoredUpstreamChanges(page).length > 0) {
    return {
      ok: false,
      diagnostics: [
        reviewAccessDiagnostic(
          'VERSION_REVIEW_DIFF_INCOMPLETE',
          'error',
          'The requested review diff includes semantic changes that are not visible through the review access projection.',
        ),
      ],
    };
  }

  const incompleteProjectionDiagnostics = incompleteReviewProjectionDiagnostics(page);
  if (incompleteProjectionDiagnostics.length > 0) {
    return { ok: false, diagnostics: incompleteProjectionDiagnostics };
  }

  const changes = page.changes.map(projectReviewAccessDiffChange);
  const derivedImpact = page.derivedImpact?.map(projectReviewAccessDiffChange);
  return {
    ok: true,
    value: {
      schemaVersion: page.schemaVersion,
      source: page.source,
      baseCommitId: page.baseCommitId,
      headCommitId: page.headCommitId,
      changeSetDigest: cloneJson(page.changeSetDigest),
      ...(page.reviewId === undefined ? {} : { reviewId: page.reviewId }),
      changes,
      ...(derivedImpact === undefined ? {} : { derivedImpact }),
      summary: {
        ...cloneJson(page.summary),
        authoredChanges: changes.length,
        derivedChanges: derivedImpact?.length ?? page.summary.derivedChanges,
      },
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      limit: page.limit,
      diagnostics: sanitizeVersionDiagnostics(page.diagnostics),
    },
  };
}

export function sanitizeReviewAccessDiagnostics(
  diagnostics: readonly VersionDiagnostic[],
): readonly VersionDiagnostic[] {
  return sanitizeVersionDiagnostics(diagnostics);
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

function projectReviewAccessDecision(
  decision: WorkbookVersionReviewDecision,
): WorkbookVersionReviewDecision {
  return {
    ...cloneJson(decision),
    reviewer: projectReviewAccessAuthor(decision.reviewer),
    ...(decision.body === undefined ? {} : { body: sanitizeDiagnosticString(decision.body) }),
    ...(decision.metadata === undefined
      ? {}
      : {
          metadata: sanitizeDiagnosticData(
            decision.metadata,
          ) as WorkbookVersionReviewDecision['metadata'],
        }),
  };
}

function projectReviewAccessApproval(
  approval: WorkbookVersionReviewApprovalEvidence,
): WorkbookVersionReviewApprovalEvidence {
  return {
    ...cloneJson(approval),
    approvedBy: projectReviewAccessAuthor(approval.approvedBy),
  };
}

function projectReviewAccessAuthor(author: VersionAuthor): VersionAuthor {
  return {
    kind: author.kind,
    trust: author.trust,
    ...(author.displayName === undefined
      ? {}
      : { displayName: sanitizeDiagnosticString(author.displayName) }),
  };
}

function projectReviewAccessDiffChange(
  change: WorkbookVersionReviewDiffChange,
): WorkbookVersionReviewDiffChange {
  const structural = structuralFromReviewTarget(change.target);
  return {
    ...cloneJson(change),
    before: structural
      ? projectReviewAccessChangeValue(structural, change.before)
      : cloneJson(change.before),
    after: structural
      ? projectReviewAccessChangeValue(structural, change.after)
      : cloneJson(change.after),
    diagnostics: sanitizeVersionDiagnostics(change.diagnostics),
  };
}

function projectReviewAccessChangeValue(
  structural: VersionDiffStructuralMetadata,
  value: VersionDiffValue,
): VersionDiffValue {
  const projected = projectReviewAccessDiffValue(structural, value);
  if (projected === undefined) return cloneJson(value);
  return projected ?? REVIEW_ACCESS_REDACTED_VALUE;
}

function structuralFromReviewTarget(
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

function blockingReviewDiffDiagnostics(
  page: WorkbookVersionReviewDiffPage,
): readonly VersionDiagnostic[] {
  const diagnostics = [
    ...publicDiagnosticsFrom(page.diagnostics),
    ...publicDiagnosticsFrom(
      isRecord(page.upstreamDiff) ? page.upstreamDiff.diagnostics : undefined,
    ),
  ];
  return diagnostics
    .filter(isBlockingReviewDiffDiagnostic)
    .map((item) =>
      reviewAccessDiagnostic(
        diagnosticCode(item) ?? 'VERSION_REVIEW_DIFF_COMPLETENESS_BLOCKED',
        diagnosticSeverity(item),
        'The requested review diff includes hidden or unsupported semantic state.',
      ),
    );
}

function hiddenAuthoredUpstreamChanges(
  page: WorkbookVersionReviewDiffPage,
): readonly VersionDiffEntry[] {
  const upstreamDiff = page.upstreamDiff;
  if (!isRecord(upstreamDiff) || !Array.isArray(upstreamDiff.items)) return [];

  const projectedKeys = new Set<string>();
  for (const change of page.changes) {
    const key = reviewDiffChangeKey(change);
    if (key) projectedKeys.add(key);
  }
  for (const change of page.derivedImpact ?? []) {
    const key = reviewDiffChangeKey(change);
    if (key) projectedKeys.add(key);
  }

  const hidden: VersionDiffEntry[] = [];
  for (const item of upstreamDiff.items) {
    const key = upstreamEntryKey(item);
    if (key && !projectedKeys.has(key)) hidden.push(item as VersionDiffEntry);
  }
  return hidden;
}

function incompleteReviewProjectionDiagnostics(
  page: WorkbookVersionReviewDiffPage,
): readonly VersionDiagnostic[] {
  const changes = [...page.changes, ...(page.derivedImpact ?? [])];
  for (const change of changes) {
    if (hasIncompleteReviewProjection(change)) {
      return [
        reviewAccessDiagnostic(
          'VERSION_REVIEW_DIFF_INCOMPLETE',
          'error',
          'The requested review diff includes review values that are hidden by access control and cannot be accepted as complete review data.',
        ),
      ];
    }
  }
  return [];
}

function hasIncompleteReviewProjection(change: WorkbookVersionReviewDiffChange): boolean {
  const structural = structuralFromReviewTarget(change.target);
  if (!structural) return false;
  return [change.before, change.after].some((value) => {
    const projected = projectReviewAccessDiffValue(structural, value);
    return projected === null || isIncompleteReviewRedactedValue(projected);
  });
}

function reviewDiffChangeKey(change: WorkbookVersionReviewDiffChange): string | null {
  const target = change.target;
  if (target.kind !== 'semanticChange') return null;
  return semanticChangeKey(
    target.changeId,
    target.entityKind,
    target.entityId,
    target.propertyPath,
  );
}

function upstreamEntryKey(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const structural = value.structural;
  if (!isRecord(structural) || structural.kind !== 'metadata') return null;
  const changeId = structural.changeId;
  const domain = structural.domain;
  const entityId = structural.entityId;
  const propertyPath = structural.propertyPath;
  if (
    typeof changeId !== 'string' ||
    typeof domain !== 'string' ||
    typeof entityId !== 'string' ||
    !Array.isArray(propertyPath) ||
    !propertyPath.every((segment) => typeof segment === 'string')
  ) {
    return null;
  }
  return semanticChangeKey(changeId, domain, entityId, propertyPath);
}

function semanticChangeKey(
  changeId: string,
  entityKind: string,
  entityId: string,
  propertyPath: readonly string[],
): string {
  return JSON.stringify([changeId, entityKind, entityId, propertyPath]);
}

function isBlockingReviewDiffDiagnostic(value: Readonly<Record<string, unknown>>): boolean {
  const code = diagnosticCode(value)?.toLowerCase() ?? '';
  const message = diagnosticMessage(value).toLowerCase();
  const data = diagnosticData(value);
  const category = diagnosticStringField(data, 'category')?.toLowerCase();
  return (
    code.includes('completeness') ||
    code.includes('unsupported') ||
    code.includes('opaque') ||
    message.includes('completeness') ||
    message.includes('unsupported') ||
    message.includes('opaque') ||
    message.includes('subset-hidden') ||
    category === 'unsupported' ||
    category === 'opaque' ||
    category === 'subset-hidden' ||
    category === 'incomplete'
  );
}

function publicDiagnosticsFrom(value: unknown): Readonly<Record<string, unknown>>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Readonly<Record<string, unknown>> => isRecord(item))
    : [];
}

function diagnosticCode(value: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof value.code === 'string') return value.code;
  return typeof value.issueCode === 'string' ? value.issueCode : undefined;
}

function diagnosticSeverity(
  value: Readonly<Record<string, unknown>>,
): VersionDiagnostic['severity'] {
  return value.severity === 'info' || value.severity === 'warning' ? value.severity : 'error';
}

function diagnosticMessage(value: Readonly<Record<string, unknown>>): string {
  if (typeof value.message === 'string') return value.message;
  return typeof value.safeMessage === 'string' ? value.safeMessage : '';
}

function diagnosticData(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  if (isRecord(value.data)) return value.data;
  if (isRecord(value.payload)) return value.payload;
  if (isRecord(value.details)) return value.details;
  return undefined;
}

function diagnosticStringField(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const field = value?.[key];
  return typeof field === 'string' ? field : undefined;
}

function reviewAccessDiagnostic(
  code: string,
  severity: VersionDiagnostic['severity'],
  message: string,
): VersionDiagnostic {
  return { code, severity, message };
}

function sanitizeVersionDiagnostics(
  diagnostics: readonly VersionDiagnostic[],
): readonly VersionDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    message: sanitizeDiagnosticString(diagnostic.message),
    ...(diagnostic.owner === undefined
      ? {}
      : { owner: sanitizeDiagnosticString(diagnostic.owner) }),
    ...(diagnostic.data === undefined
      ? {}
      : { data: sanitizeDiagnosticData(diagnostic.data) as VersionDiagnostic['data'] }),
  }));
}

const OMIT_DIAGNOSTIC_FIELD = Symbol('omitDiagnosticField');

function sanitizeDiagnosticData(
  value: unknown,
  key?: string,
): unknown | typeof OMIT_DIAGNOSTIC_FIELD {
  if (key && isSensitiveDiagnosticKey(key)) return OMIT_DIAGNOSTIC_FIELD;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeDiagnosticData(item))
      .filter((item) => item !== OMIT_DIAGNOSTIC_FIELD);
  }
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value)) {
      const sanitized = sanitizeDiagnosticData(child, childKey);
      if (sanitized !== OMIT_DIAGNOSTIC_FIELD) output[childKey] = sanitized;
    }
    return output;
  }
  return typeof value === 'string' ? sanitizeDiagnosticString(value) : value;
}

function sanitizeDiagnosticString(value: string): string {
  return value
    .replace(SENSITIVE_PRINCIPAL_TOKEN_RE, 'redacted-principal')
    .replace(SENSITIVE_REF_TOKEN_RE, 'redacted-ref')
    .replace(SENSITIVE_BRANCH_OR_REF_FIELD_RE, '$1redacted-ref');
}

function isSensitiveDiagnosticKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('principal') ||
    normalized.includes('hidden') ||
    normalized.includes('digest') ||
    normalized === 'actorid' ||
    normalized === 'reviewerid' ||
    normalized === 'agentrunid' ||
    normalized === 'userid' ||
    normalized === 'useremail' ||
    normalized === 'domain' ||
    normalized === 'domains' ||
    normalized === 'omittedchangecount' ||
    normalized === 'omitteddomains' ||
    normalized === 'path' ||
    normalized === 'branch' ||
    normalized === 'branchid' ||
    normalized === 'branchname' ||
    normalized === 'changeid' ||
    normalized === 'commitid' ||
    normalized === 'entityid' ||
    normalized === 'expectedhead' ||
    normalized === 'expectedtargethead' ||
    normalized === 'head' ||
    normalized === 'headref' ||
    normalized === 'ref' ||
    normalized === 'refid' ||
    normalized === 'refname' ||
    normalized === 'refrevision' ||
    normalized === 'revision' ||
    normalized === 'proposalid' ||
    normalized === 'mergepreviewid' ||
    normalized === 'conflictid' ||
    normalized === 'optionid' ||
    normalized === 'payloadid' ||
    normalized === 'resultid' ||
    normalized === 'resolutionsetdigest' ||
    normalized === 'resolvedattemptdigest' ||
    normalized === 'basecommitid' ||
    normalized === 'headcommitid' ||
    normalized === 'sourceref' ||
    normalized === 'targethead' ||
    normalized === 'targetref' ||
    normalized === 'value' ||
    normalized === 'values' ||
    normalized === 'before' ||
    normalized === 'after' ||
    normalized === 'oldvalue' ||
    normalized === 'newvalue' ||
    normalized === 'rawvalue' ||
    normalized === 'cellvalue' ||
    normalized === 'displayvalue' ||
    normalized === 'formula' ||
    normalized === 'result'
  );
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

function isIncompleteReviewRedactedValue(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.kind === 'redacted' &&
    typeof value.reason === 'string' &&
    INCOMPLETE_REVIEW_REDACTED_VALUE_REASONS.has(value.reason)
  );
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
