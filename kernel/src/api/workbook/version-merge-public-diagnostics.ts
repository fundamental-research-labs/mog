import type {
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

const PUBLIC_ISSUE_CODE_RE = /^[A-Z][A-Z0-9_]{0,80}$/;
const MAX_PUBLIC_DIAGNOSTIC_PAYLOAD_STRING_BYTES = 128;
const AUTHORITY_TEXT_RE =
  /\b(?:principal|proposal|workspace|role|permission|authorization|auth|conflict|merge-result|merge-payload|option|commit:sha256|sha256:)[A-Za-z0-9_.:-]*\b/i;
const SECRET_TEXT_RE =
  /\b(?:secret|password|credential|api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|bearer\s+[A-Za-z0-9._-]+|sk_(?:live|test)_[A-Za-z0-9_-]+)\b/i;

export function mapGraphDiagnostics(value: unknown): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [graphUninitializedDiagnostic()];
  }

  return value.map(mapGraphDiagnostic);
}

export function serviceUnavailableDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    'No document-scoped version graph read service is attached; no merge preview is fabricated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
    },
  );
}

export function mergeUnavailableDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_MERGE_SERVICE_UNAVAILABLE',
    'No document-scoped version merge preview service is attached; no merge preview is fabricated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
    },
  );
}

export function providerErrorDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    'The version merge service failed before returning a usable public result.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

export function invalidMergeOptionDiagnostic(
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
    messageTemplateId: `version.merge.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: { operation: 'merge', ...options.payload } } : {}),
    redacted: true,
  };
}

function mapGraphDiagnostic(value: unknown): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic();

  const issueCode =
    typeof value.issueCode === 'string'
      ? value.issueCode
      : typeof value.code === 'string'
        ? value.code
        : 'VERSION_PROVIDER_ERROR';
  const publicIssueCode = publicIssueCodeForDiagnostic(issueCode);
  const severity = value.severity === 'corruption' ? 'error' : value.severity;

  return publicDiagnostic(publicIssueCode, safeMessageForIssue(publicIssueCode), {
    severity:
      severity === 'info' || severity === 'warning' || severity === 'error' || severity === 'fatal'
        ? severity
        : 'error',
    recoverability: recoverabilityForIssue(publicIssueCode),
    payload: sanitizeDiagnosticPayload(value, publicIssueCode),
  });
}

function sanitizeDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
  issueCode: string,
): VersionDiagnosticPublicPayload {
  if (issueCode === 'VERSION_PERMISSION_DENIED') return {};

  const payload: Record<string, string | number | boolean | null> = {};

  if (typeof value.option === 'string') {
    const option = sanitizeDiagnosticPayloadValue('option', value.option);
    if (option !== undefined) payload.option = option;
  }
  if (typeof value.selector === 'string') {
    const selector = sanitizeDiagnosticPayloadValue('selector', value.selector);
    if (selector !== undefined) payload.selector = selector;
  }
  const details = isRecord(value.details) ? value.details : null;
  if (details) {
    for (const [key, detailValue] of Object.entries(details)) {
      const sanitized = sanitizeDiagnosticPayloadValue(key, detailValue);
      if (sanitized !== undefined) payload[key] = sanitized;
    }
  }

  return payload;
}

function publicIssueCodeForDiagnostic(issueCode: string): string {
  const normalized = issueCode.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  if (isAuthorizationDeniedIssue(normalized)) return 'VERSION_PERMISSION_DENIED';
  return PUBLIC_ISSUE_CODE_RE.test(issueCode) ? issueCode : 'VERSION_PROVIDER_ERROR';
}

function isAuthorizationDeniedIssue(issueCode: string): boolean {
  return (
    issueCode === 'VERSION_PERMISSION_DENIED' ||
    issueCode.includes('PERMISSION_DENIED') ||
    issueCode.includes('AUTHORIZATION_DENIED') ||
    issueCode.includes('ACCESS_DENIED') ||
    issueCode.includes('CROSS_WORKSPACE') ||
    (issueCode.includes('WORKSPACE') &&
      (issueCode.includes('ROLE') || issueCode.includes('AUTH'))) ||
    (issueCode.includes('PROPOSAL') &&
      (issueCode.includes('DENIED') ||
        issueCode.includes('MISMATCH') ||
        issueCode.includes('STALE')))
  );
}

function sanitizeDiagnosticPayloadValue(
  key: string,
  value: unknown,
): string | number | boolean | null | undefined {
  if (isSensitivePayloadKey(key)) return 'redacted';
  switch (typeof value) {
    case 'string':
      return isUnsafePayloadString(value) ? 'redacted' : value;
    case 'number':
      return Number.isFinite(value) ? value : undefined;
    case 'boolean':
      return value;
    default:
      return value === null ? null : undefined;
  }
}

function graphUninitializedDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    'The workbook version graph is not initialized for this document.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
    },
  );
}

function safeMessageForIssue(issueCode: string): string {
  switch (issueCode) {
    case 'VERSION_GRAPH_UNINITIALIZED':
      return 'The workbook version graph is not initialized for this document.';
    case 'VERSION_INVALID_OPTIONS':
      return 'The version merge options are invalid for this method.';
    case 'VERSION_REDACTION_VIOLATION':
      return 'The requested version merge preview contains redacted semantic data.';
    case 'VERSION_MERGE_SERVICE_UNAVAILABLE':
      return 'No document-scoped version merge preview service is attached.';
    case 'VERSION_MERGE_BASE_AMBIGUOUS':
      return 'The requested version merge has multiple possible merge bases.';
    case 'VERSION_MERGE_BASE_MISMATCH':
      return 'The requested version merge base does not match the graph ancestry.';
    case 'VERSION_MERGE_UNRELATED_HISTORIES':
      return 'The requested version merge commits do not share a common ancestor.';
    case 'VERSION_MERGE_UNSUPPORTED_ANCESTRY':
      return 'The requested version merge ancestry is not previewable by the attached service.';
    case 'VERSION_PERMISSION_DENIED':
      return 'Version merge preview is not authorized for this caller.';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_MISSING_PARENT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'The version graph could not validate the requested merge commit closure.';
    case 'VERSION_UNMATERIALIZABLE_COMMIT':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return 'The requested version merge is not previewable by the attached service.';
    default:
      return 'The version graph could not complete merge preview.';
  }
}

function recoverabilityForIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_STALE_PAGE_CURSOR':
    case 'VERSION_REF_CONFLICT':
      return 'retry';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_MISSING_PARENT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'repair';
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_MERGE_SERVICE_UNAVAILABLE':
    case 'VERSION_MERGE_BASE_AMBIGUOUS':
    case 'VERSION_MERGE_BASE_MISMATCH':
    case 'VERSION_MERGE_UNRELATED_HISTORIES':
    case 'VERSION_MERGE_UNSUPPORTED_ANCESTRY':
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_REDACTION_VIOLATION':
    case 'VERSION_UNMATERIALIZABLE_COMMIT':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return 'unsupported';
    default:
      return 'none';
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isSensitivePayloadKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('principal') ||
    normalized.includes('proposal') ||
    normalized.includes('workspace') ||
    normalized.includes('role') ||
    normalized.includes('digest') ||
    normalized.includes('conflict') ||
    normalized.includes('option') ||
    normalized.includes('payload') ||
    normalized.includes('result') ||
    normalized.includes('target') ||
    normalized.includes('commit') ||
    normalized.includes('value') ||
    normalized === 'before' ||
    normalized === 'after'
  );
}

function isUnsafePayloadString(value: string): boolean {
  return (
    utf8ByteLength(value) > MAX_PUBLIC_DIAGNOSTIC_PAYLOAD_STRING_BYTES ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    AUTHORITY_TEXT_RE.test(value) ||
    SECRET_TEXT_RE.test(value)
  );
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}
