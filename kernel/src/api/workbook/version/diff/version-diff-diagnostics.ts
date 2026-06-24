import type {
  VersionDiagnosticPublicPayload,
  VersionDiffEntry,
  VersionRecordRevision,
  VersionStoreDiagnostic,
  WorkbookDiffPage,
} from '@mog-sdk/contracts/api';
import { VERSION_DIFF_PAGE_ORDER } from '@mog-sdk/contracts/versioning';
import {
  normalizeVersionObjectReadDiagnosticCode,
  recoverabilityForVersionObjectRead,
} from '../../version-object-read-diagnostics';
import { VERSION_HEAD_REF, VERSION_MAIN_REF } from './version-diff-constants';
import { isRecord, isRecoverability, sanitizePayloadPrimitive } from './version-diff-utils';

export function mapGraphDiagnostics(value: unknown): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) return [providerErrorDiagnostic()];
  return value.map(mapGraphDiagnostic);
}

function mapGraphDiagnostic(value: unknown): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic();
  const rawIssueCode =
    typeof value.issueCode === 'string'
      ? value.issueCode
      : typeof value.code === 'string'
        ? value.code
        : 'VERSION_PROVIDER_ERROR';
  const issueCode = publicDiffIssueCode(rawIssueCode);
  const severity = value.severity === 'corruption' ? 'error' : value.severity;
  return publicDiagnostic(issueCode, safeMessageForIssue(issueCode), {
    severity:
      severity === 'info' || severity === 'warning' || severity === 'error' || severity === 'fatal'
        ? severity
        : 'error',
    recoverability: recoverabilityForVersionObjectRead(
      issueCode,
      isRecoverability(value.recoverability)
        ? value.recoverability
        : recoverabilityForIssue(issueCode),
    ),
    payload: sanitizeDiagnosticPayload(value),
  });
}

function publicDiffIssueCode(issueCode: string): string {
  const objectReadCode = normalizeVersionObjectReadDiagnosticCode(issueCode);
  return objectReadCode === 'VERSION_OBJECT_NOT_FOUND'
    ? 'VERSION_MISSING_OBJECT'
    : (objectReadCode ?? issueCode);
}

function sanitizeDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = {
    operation: 'diff',
  };
  if (typeof value.option === 'string') payload.option = value.option;
  if (typeof value.selector === 'string') payload.selector = value.selector;
  const refName = value.refName;
  if (refName === VERSION_HEAD_REF || refName === VERSION_MAIN_REF) {
    payload.refName = refName;
  }
  const details = isRecord(value.details) ? value.details : null;
  const providerPayload = isRecord(value.payload) ? value.payload : null;
  const detailRefName = details?.refName;
  if (
    payload.refName === undefined &&
    (detailRefName === VERSION_HEAD_REF || detailRefName === VERSION_MAIN_REF)
  ) {
    payload.refName = detailRefName;
  }
  for (const source of [providerPayload, details]) {
    if (!source) continue;
    for (const key of [
      'reason',
      'min',
      'max',
      'pageSize',
      'receivedPageSize',
      'includeDerivedImpact',
      'includeDiagnostics',
      'category',
      'completenessCode',
      'completenessSeverity',
      'path',
      'domain',
      'source',
    ] as const) {
      const detailValue = source[key];
      const sanitized = sanitizePayloadPrimitive(detailValue);
      if (sanitized !== undefined) payload[key] = sanitized;
    }
  }
  return payload;
}

export function serviceUnavailableDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    'No document-scoped version graph read service is attached; no diff is fabricated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
    },
  );
}

export function semanticDiffUnavailableDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_UNMATERIALIZABLE_COMMIT',
    'No document-scoped semantic version diff service is attached; no diff is fabricated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
    },
  );
}

export function providerErrorDiagnostic(
  payload: VersionDiagnosticPublicPayload = { source: 'provider' },
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    'The version diff service failed before returning a usable public result.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

export function unsupportedDiffDomainDiagnostic(
  domain: string,
  itemIndex: number,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'unsupportedDomain',
    'The requested version diff includes unsupported semantic state.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      payload: { category: 'unsupported', domain, itemIndex },
    },
  );
}

export function unsupportedRefDiagnostic(selector: string): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PERMISSION_DENIED',
    'This version diff slice can resolve only HEAD or public refs/heads/<branch> refs.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      payload: { selector, refName: 'redacted' },
    },
  );
}

export function invalidDiffOptionDiagnostic(
  option: string,
  safeMessage: string,
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_OPTIONS', safeMessage, {
    severity: 'error',
    recoverability: 'none',
    payload: {
      option,
      ...payload,
    },
  });
}

export function publicDiagnostic(
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
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.diff.${issueCode}`,
    safeMessage,
    payload: { operation: 'diff', ...options.payload },
    redacted: true,
  };
}

function safeMessageForIssue(issueCode: string): string {
  switch (issueCode) {
    case 'VERSION_GRAPH_UNINITIALIZED':
      return 'The workbook version graph is not initialized for this document.';
    case 'VERSION_INVALID_OPTIONS':
      return 'The version diff options are invalid for this method.';
    case 'VERSION_PERMISSION_DENIED':
      return 'The requested version diff ref is not exposed by this public slice.';
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'The version diff page token is stale or unsupported by this read slice.';
    case 'VERSION_STALE_SELECTOR':
      return 'The requested version diff selector is stale or unsupported by this read slice.';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_BYTE_LENGTH_MISMATCH':
    case 'VERSION_DIGEST_MISMATCH':
    case 'VERSION_INVALID_PAYLOAD':
    case 'VERSION_INVALID_PREIMAGE':
    case 'VERSION_OBJECT_CORRUPTION':
    case 'VERSION_OBJECT_TYPE_MISMATCH':
    case 'VERSION_OBJECT_STORE_FAILURE':
    case 'VERSION_OBJECT_NOT_FOUND':
    case 'VERSION_UNSUPPORTED_OBJECT_TYPE':
    case 'VERSION_UNSUPPORTED_PAYLOAD_ENCODING':
      return 'The version graph could not validate the requested diff commit closure.';
    case 'VERSION_UNMATERIALIZABLE_COMMIT':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return 'The requested version diff is not materializable by the attached service.';
    case 'VERSION_PROVIDER_FAILED':
      return 'The version diff provider is temporarily unavailable.';
    case 'VERSION_STORE_UNAVAILABLE':
      return 'The version store is unavailable for this document.';
    case 'VERSION_UNSUPPORTED_AUTHORED_DOMAIN':
    case 'unsupportedDomain':
    case 'unsupportedFormat':
    case 'externalReferenceUnsupported':
      return 'The requested version diff includes unsupported semantic state.';
    case 'opaqueDomain':
    case 'opaqueDomainDigestUnavailable':
    case 'opaqueFormatPointer':
      return 'The requested version diff includes opaque semantic state.';
    case 'derivedImpactStale':
    case 'staleDiffCursor':
      return 'The requested version diff includes stale semantic state evidence.';
    case 'indexKeyedVisibility':
    case 'indexKeyedRowVisibility':
    case 'indexKeyedColumnVisibility':
    case 'inconsistentVisibilityCache':
      return 'The requested version diff includes subset-hidden semantic state.';
    default:
      return 'The version graph could not complete diff.';
  }
}

function recoverabilityForIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_STALE_PAGE_CURSOR':
    case 'VERSION_STALE_SELECTOR':
    case 'derivedImpactStale':
    case 'staleDiffCursor':
    case 'VERSION_REF_CONFLICT':
      return 'retry';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_BYTE_LENGTH_MISMATCH':
    case 'VERSION_DIGEST_MISMATCH':
    case 'VERSION_INVALID_PAYLOAD':
    case 'VERSION_INVALID_PREIMAGE':
    case 'VERSION_OBJECT_CORRUPTION':
    case 'VERSION_OBJECT_TYPE_MISMATCH':
    case 'VERSION_OBJECT_STORE_FAILURE':
    case 'VERSION_UNSUPPORTED_OBJECT_TYPE':
    case 'VERSION_UNSUPPORTED_PAYLOAD_ENCODING':
      return 'repair';
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_STORE_UNAVAILABLE':
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_UNMATERIALIZABLE_COMMIT':
    case 'VERSION_UNSUPPORTED_SCHEMA':
    case 'VERSION_UNSUPPORTED_AUTHORED_DOMAIN':
    case 'unsupportedDomain':
    case 'unsupportedFormat':
    case 'externalReferenceUnsupported':
    case 'opaqueDomain':
    case 'opaqueDomainDigestUnavailable':
    case 'opaqueFormatPointer':
    case 'indexKeyedVisibility':
    case 'indexKeyedRowVisibility':
    case 'indexKeyedColumnVisibility':
    case 'inconsistentVisibilityCache':
      return 'unsupported';
    case 'VERSION_PROVIDER_FAILED':
      return 'retry';
    default:
      return 'none';
  }
}

export function degradedDiffPage(
  diagnostics: readonly VersionStoreDiagnostic[],
  items: readonly VersionDiffEntry[] = [],
  readRevision?: VersionRecordRevision,
): WorkbookDiffPage {
  return {
    status: 'degraded',
    items,
    ...(readRevision ? { readRevision } : {}),
    order: VERSION_DIFF_PAGE_ORDER,
    diagnostics,
  };
}
