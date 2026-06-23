import type {
  VersionDiagnostic,
  VersionDiffEntry,
  WorkbookVersionReviewDiffChange,
  WorkbookVersionReviewDiffPage,
} from '@mog-sdk/contracts/api';

import {
  isIncompleteReviewRedactedValue,
  projectReviewAccessDiffValue,
  structuralFromReviewTarget,
} from './review-access-value-projection';
import { reviewServiceSemanticTargetSupport } from './review-service-target-support';

const SENSITIVE_PRINCIPAL_TOKEN_RE =
  /\b(?:principal|actor|reviewer|agent|user)[_-][A-Za-z0-9_.:-]+\b/g;
const SENSITIVE_REF_TOKEN_RE = /\brefs\/[A-Za-z0-9._/@:-]+\b/g;
const SENSITIVE_BRANCH_OR_REF_FIELD_RE =
  /\b((?:branch|ref)(?:\s*(?:name|id)?\s*[:=]\s*))[A-Za-z0-9._/@:-]+\b/gi;

export function reviewAccessDiffPageRejectionDiagnostics(
  page: WorkbookVersionReviewDiffPage,
): readonly VersionDiagnostic[] {
  const blockingDiagnostics = blockingReviewDiffDiagnostics(page);
  if (blockingDiagnostics.length > 0) return blockingDiagnostics;

  if (hiddenAuthoredUpstreamChanges(page).length > 0) {
    return [
      reviewAccessDiagnostic(
        'VERSION_REVIEW_DIFF_INCOMPLETE',
        'error',
        'The requested review diff includes semantic changes that are not visible through the review access projection.',
      ),
    ];
  }

  const unsupportedTargetDiagnostics = unsupportedReviewTargetDiagnostics(page);
  if (unsupportedTargetDiagnostics.length > 0) return unsupportedTargetDiagnostics;

  return incompleteReviewProjectionDiagnostics(page);
}

export function sanitizeVersionDiagnostics(
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

export function sanitizeDiagnosticData(value: unknown): unknown {
  return sanitizeDiagnosticDataField(value);
}

function sanitizeDiagnosticDataField(
  value: unknown,
  key?: string,
): unknown | typeof OMIT_DIAGNOSTIC_FIELD {
  if (key && isSensitiveDiagnosticKey(key)) return OMIT_DIAGNOSTIC_FIELD;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeDiagnosticDataField(item))
      .filter((item) => item !== OMIT_DIAGNOSTIC_FIELD);
  }
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value)) {
      const sanitized = sanitizeDiagnosticDataField(child, childKey);
      if (sanitized !== OMIT_DIAGNOSTIC_FIELD) output[childKey] = sanitized;
    }
    return output;
  }
  return typeof value === 'string' ? sanitizeDiagnosticString(value) : value;
}

export function sanitizeDiagnosticString(value: string): string {
  return value
    .replace(SENSITIVE_PRINCIPAL_TOKEN_RE, 'redacted-principal')
    .replace(SENSITIVE_REF_TOKEN_RE, 'redacted-ref')
    .replace(SENSITIVE_BRANCH_OR_REF_FIELD_RE, 'redacted-ref');
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

function unsupportedReviewTargetDiagnostics(
  page: WorkbookVersionReviewDiffPage,
): readonly VersionDiagnostic[] {
  const changes = [...page.changes, ...(page.derivedImpact ?? [])];
  for (const change of changes) {
    const target = change.target;
    if (target.kind !== 'semanticChange') continue;
    const support = reviewServiceSemanticTargetSupport(target);
    if (support.ok) continue;
    return [
      reviewAccessDiagnostic(
        'VERSION_REVIEW_DIFF_INCOMPLETE',
        'error',
        'The requested review diff includes unsupported semantic review targets that cannot be accepted as complete review data.',
      ),
    ];
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
