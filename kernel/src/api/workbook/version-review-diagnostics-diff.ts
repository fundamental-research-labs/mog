import type {
  VersionDiagnosticPublicPayload,
  VersionDiffEntry,
  VersionStoreDiagnostic,
  WorkbookVersionReviewDiffPage,
} from '@mog-sdk/contracts/api';

import type { VersionReviewPublicOperation } from './version-review-operation';
import {
  isPayloadPrimitive,
  isRecord,
  isSensitiveDiagnosticKey,
} from './version-review-diagnostics-values';

export function hardenReviewDiffPage(
  value: unknown,
):
  | { readonly ok: true; readonly value: WorkbookVersionReviewDiffPage }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  if (!isRecord(value)) {
    return { ok: false, diagnostics: [providerInvalidPayloadDiagnostic('getReviewDiff')] };
  }

  const blockingDiagnostics = blockingReviewDiffCompletenessDiagnostics(value);
  if (blockingDiagnostics.length > 0) {
    return { ok: false, diagnostics: blockingDiagnostics };
  }

  const hiddenChanges = hiddenAuthoredUpstreamChanges(value);
  if (hiddenChanges.length > 0) {
    return {
      ok: false,
      diagnostics: [reviewDiffHiddenAuthoredDomainDiagnostic(hiddenChanges)],
    };
  }

  return { ok: true, value: value as unknown as WorkbookVersionReviewDiffPage };
}

function blockingReviewDiffCompletenessDiagnostics(
  page: Readonly<Record<string, unknown>>,
): readonly VersionStoreDiagnostic[] {
  const diagnostics = publicDiagnosticsFrom(page.diagnostics);
  const upstreamDiff = page.upstreamDiff;
  if (isRecord(upstreamDiff)) {
    diagnostics.push(...publicDiagnosticsFrom(upstreamDiff.diagnostics));
  }

  return diagnostics
    .filter(isBlockingReviewDiffCompletenessDiagnostic)
    .map((diagnosticValue) => reviewDiffBlockingCompletenessDiagnostic(diagnosticValue));
}

function hiddenAuthoredUpstreamChanges(
  page: Readonly<Record<string, unknown>>,
): readonly VersionDiffEntry[] {
  const upstreamDiff = page.upstreamDiff;
  if (!isRecord(upstreamDiff) || !Array.isArray(upstreamDiff.items)) return [];

  const projectedKeys = new Set<string>();
  for (const change of reviewDiffChangesFrom(page.changes)) {
    const key = reviewDiffChangeKey(change);
    if (key) projectedKeys.add(key);
  }
  for (const change of reviewDiffChangesFrom(page.derivedImpact)) {
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

function reviewDiffChangesFrom(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Readonly<Record<string, unknown>> => isRecord(item))
    : [];
}

function reviewDiffChangeKey(change: Readonly<Record<string, unknown>>): string | null {
  const target = change.target;
  if (!isRecord(target) || target.kind !== 'semanticChange') return null;
  const changeId = target.changeId;
  const entityKind = target.entityKind;
  const entityId = target.entityId;
  const propertyPath = target.propertyPath;
  if (
    typeof changeId !== 'string' ||
    typeof entityKind !== 'string' ||
    typeof entityId !== 'string' ||
    !Array.isArray(propertyPath) ||
    !propertyPath.every((segment) => typeof segment === 'string')
  ) {
    return null;
  }
  return semanticChangeKey(changeId, entityKind, entityId, propertyPath);
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

function reviewDiffHiddenAuthoredDomainDiagnostic(
  hiddenChanges: readonly VersionDiffEntry[],
): VersionStoreDiagnostic {
  const domains = [
    ...new Set(
      hiddenChanges
        .map((entry) => (entry.structural.kind === 'metadata' ? entry.structural.domain : null))
        .filter((domain): domain is string => typeof domain === 'string' && domain.length > 0),
    ),
  ].sort();
  const payload: VersionDiagnosticPublicPayload = {
    omittedChangeCount: hiddenChanges.length,
    ...(domains.length === 1 ? { domain: domains[0] } : {}),
    ...(domains.length > 1 ? { omittedDomains: domains.join(',') } : {}),
  };
  return reviewDiagnostic(
    'getReviewDiff',
    'VERSION_REVIEW_DIFF_INCOMPLETE',
    'Review diff omitted authored semantic changes; unsupported or opaque domains must be surfaced before review.',
    { recoverability: 'unsupported', payload },
  );
}

function reviewDiffBlockingCompletenessDiagnostic(
  diagnosticValue: Readonly<Record<string, unknown>>,
): VersionStoreDiagnostic {
  const code = diagnosticCode(diagnosticValue) ?? 'VERSION_REVIEW_DIFF_COMPLETENESS_BLOCKED';
  return reviewDiagnostic(
    'getReviewDiff',
    code,
    'Review diff completeness diagnostics block review because authored domains may be hidden.',
    {
      recoverability: 'unsupported',
      payload: sanitizedCompletenessPayload(diagnosticValue),
    },
  );
}

function isBlockingReviewDiffCompletenessDiagnostic(
  diagnosticValue: Readonly<Record<string, unknown>>,
): boolean {
  const code = diagnosticCode(diagnosticValue)?.toLowerCase() ?? '';
  const message = diagnosticMessage(diagnosticValue).toLowerCase();
  const data = diagnosticData(diagnosticValue);
  const category = diagnosticStringField(data, 'category')?.toLowerCase();
  const payloadCategory = diagnosticStringField(
    isRecord(data?.payload) ? data.payload : undefined,
    'category',
  )?.toLowerCase();
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
    category === 'incomplete' ||
    payloadCategory === 'unsupported' ||
    payloadCategory === 'opaque' ||
    payloadCategory === 'subset-hidden' ||
    payloadCategory === 'incomplete'
  );
}

function sanitizedCompletenessPayload(
  diagnosticValue: Readonly<Record<string, unknown>>,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = {
    source: 'reviewDiffCompleteness',
  };
  const data = diagnosticData(diagnosticValue);
  const publicData = isRecord(data?.payload) ? data.payload : data;
  if (!isRecord(publicData)) return payload;

  for (const key of [
    'operation',
    'selector',
    'category',
    'completenessCode',
    'completenessSeverity',
    'path',
    'domain',
    'source',
    'omittedChangeCount',
    'omittedDomains',
  ] as const) {
    const value = publicData[key];
    if (!isSensitiveDiagnosticKey(key) && isPayloadPrimitive(value)) payload[key] = value;
  }
  return payload;
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

function providerInvalidPayloadDiagnostic(
  operation: VersionReviewPublicOperation,
): VersionStoreDiagnostic {
  return reviewDiagnostic(
    operation,
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'The version review service did not return a valid public review result.',
    { recoverability: 'repair', severity: 'error' },
  );
}

function reviewDiagnostic(
  operation: VersionReviewPublicOperation,
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionDiagnosticPublicPayload;
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? 'none',
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    payload: { operation, ...(options.payload ?? {}) },
    redacted: true,
  };
}
