import type {
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { VersionObjectStoreError } from '../../../../../document/version-store/object-store';
import type { VersionMergePublicOperation } from '../../merge/version-merge-capability';
import {
  recoverabilityForVersionObjectRead,
  versionObjectReadDiagnosticCode,
} from '../../../version-object-read-diagnostics';
import { isRecord } from './version-merge-review-artifacts-guards';

const PUBLIC_DIAGNOSTIC_PAYLOAD_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const MAX_PUBLIC_DIAGNOSTIC_MESSAGE_BYTES = 300;
const MAX_PUBLIC_DIAGNOSTIC_PAYLOAD_STRING_BYTES = 128;
const CELL_REFERENCE_TEXT_RE =
  /(?:^|[\s"'`([{])(?:[A-Za-z0-9_-]+!)?\$?[A-Z]{1,3}\$?\d{1,7}(?::\$?[A-Z]{1,3}\$?\d{1,7})?(?:$|[\s"',.;:)\]}])/;
const HOST_OBJECT_TEXT_RE = /\b(?:__proto__|prototype|constructor)\b/;
const PACKAGE_PATH_TEXT_RE =
  /(?:^|[\s"'`])(?:xl\/|_rels\/|docProps\/|customXml\/|worksheets\/|sharedStrings\.xml|workbook\.xml|styles\.xml|theme\/|media\/|[A-Za-z]:\\|\/(?:Users|tmp|var|private|home)\/|\.\.?\/)/i;
const STRUCTURAL_PATH_TEXT_RE =
  /\b(?:cells?|cols?|columns?|rows?|sheets?|packages?|parts?)\/[^\s"',)]+/i;
const UNSAFE_VALUE_TEXT_RE =
  /\b(?:secret|password|credential|api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|bearer\s+[A-Za-z0-9._-]+|sk_(?:live|test)_[A-Za-z0-9_-]+)\b/i;
const SENSITIVE_PRINCIPAL_TOKEN_RE =
  /\b(?:principal|actor|reviewer|agent|user)[_-][A-Za-z0-9_.:-]+\b/i;
const PERSISTED_ARTIFACT_REF_TEXT_RE =
  /\b(?:[0-9a-f]{64}|(?:commit:sha256:|sha256:|merge-result:|merge-payload:|conflict:[A-Za-z0-9_.:-]*:|option:[A-Za-z0-9_.:-]*:)[0-9A-Za-z_.:-]+)\b/i;

export function mergeReviewProviderErrorDiagnostic(
  operation: VersionMergePublicOperation,
): VersionStoreDiagnostic {
  return mergeReviewDiagnostic(
    operation,
    'VERSION_PROVIDER_FAILED',
    'Version merge review provider failed.',
    { recoverability: 'retry' },
  );
}

export function invalidPreviewArtifactDiagnostic(
  operation: VersionMergePublicOperation,
): VersionStoreDiagnostic {
  return mergeReviewDiagnostic(
    operation,
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'Persisted merge preview artifact payload is invalid or unsupported.',
    { recoverability: 'repair' },
  );
}

export function mapMergeReviewProviderDiagnostics(
  operation: VersionMergePublicOperation,
  diagnostics: readonly unknown[],
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return [mergeReviewProviderErrorDiagnostic(operation)];
  }
  return diagnostics.map((diagnostic) => {
    if (!isRecord(diagnostic)) return mergeReviewProviderErrorDiagnostic(operation);
    const issueCode =
      typeof diagnostic.issueCode === 'string'
        ? diagnostic.issueCode
        : typeof diagnostic.code === 'string'
          ? diagnostic.code
          : 'VERSION_PROVIDER_FAILED';
    return mergeReviewDiagnostic(
      operation,
      issueCode,
      typeof diagnostic.safeMessage === 'string'
        ? diagnostic.safeMessage
        : defaultSafeMessageForIssue(issueCode),
      {
        recoverability: recoverabilityForVersionObjectRead(
          issueCode,
          isRecoverability(diagnostic.recoverability)
            ? diagnostic.recoverability
            : recoverabilityForIssue(issueCode),
        ),
      },
    );
  });
}

export function persistedReviewArtifactReadDiagnostics(
  operation: VersionMergePublicOperation,
  error: unknown,
  missingMessage: string,
): readonly VersionStoreDiagnostic[] {
  if (
    error instanceof VersionObjectStoreError &&
    error.diagnostic.code === 'VERSION_OBJECT_NOT_FOUND'
  ) {
    return [
      mergeReviewDiagnostic(operation, 'VERSION_MISSING_OBJECT', missingMessage, {
        recoverability: 'repair',
      }),
    ];
  }
  const diagnostic = providerDiagnosticFromError(error);
  if (!diagnostic) return [mergeReviewProviderErrorDiagnostic(operation)];
  const issueCode = publicArtifactIssueCode(diagnostic);
  return [
    mergeReviewDiagnostic(
      operation,
      issueCode,
      reviewArtifactSafeMessage(issueCode, missingMessage),
      {
        recoverability: recoverabilityForVersionObjectRead(
          versionObjectReadDiagnosticCode(diagnostic),
          recoverabilityForIssue(issueCode),
        ),
      },
    ),
  ];
}

export function mergeReviewDiagnostic(
  operation: VersionMergePublicOperation,
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionStoreDiagnostic['payload'];
    readonly mutationGuarantee?: VersionStoreDiagnostic['mutationGuarantee'];
  } = {},
): VersionStoreDiagnostic {
  const publicIssueCode = sanitizePublicIssueCode(issueCode);
  return {
    issueCode: publicIssueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForIssue(publicIssueCode),
    messageTemplateId: `version.${operation}.${publicIssueCode}`,
    safeMessage: sanitizePublicDiagnosticMessage(publicIssueCode, safeMessage),
    payload: sanitizePublicDiagnosticPayload(operation, options.payload),
    redacted: true,
    mutationGuarantee: options.mutationGuarantee ?? 'no-write-attempted',
  };
}

function recoverabilityForIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_PROVIDER_FAILED':
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'retry';
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
    case 'VERSION_MISSING_DEPENDENCY':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'repair';
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_STORE_UNAVAILABLE':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return 'unsupported';
    default:
      return 'none';
  }
}

function defaultSafeMessageForIssue(issueCode: string): string {
  switch (issueCode) {
    case 'VERSION_INVALID_OPTIONS':
      return 'The version merge review request is invalid.';
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
      return 'Persisted merge preview artifact payload is invalid or unsupported.';
    case 'VERSION_MISSING_OBJECT':
      return 'Persisted merge review object could not be found.';
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'Persisted merge review objects could not be updated.';
    case 'VERSION_PERMISSION_DENIED':
      return 'Version merge review is not authorized for this caller.';
    case 'VERSION_STORE_UNAVAILABLE':
      return 'No version graph provider is attached for persisted merge review.';
    case 'VERSION_PROVIDER_FAILED':
      return 'Version merge review provider failed.';
    default:
      return 'Version merge review request could not be completed.';
  }
}

function providerDiagnosticFromError(error: unknown): Readonly<Record<string, unknown>> | null {
  if (!isRecord(error)) return null;
  const first = Array.isArray(error.diagnostics) ? error.diagnostics[0] : error.diagnostic;
  return isRecord(first) ? first : null;
}

function publicArtifactIssueCode(diagnostic: Readonly<Record<string, unknown>>): string {
  const raw = versionObjectReadDiagnosticCode(diagnostic) ?? 'VERSION_PROVIDER_FAILED';
  switch (raw) {
    case 'VERSION_OBJECT_NOT_FOUND':
      return 'VERSION_MISSING_OBJECT';
    case 'VERSION_BYTE_LENGTH_MISMATCH':
    case 'VERSION_DIGEST_MISMATCH':
    case 'VERSION_INVALID_PAYLOAD':
    case 'VERSION_INVALID_PREIMAGE':
    case 'VERSION_OBJECT_CORRUPTION':
    case 'VERSION_OBJECT_TYPE_MISMATCH':
    case 'VERSION_UNSUPPORTED_OBJECT_TYPE':
    case 'VERSION_UNSUPPORTED_PAYLOAD_ENCODING':
      return 'VERSION_INVALID_COMMIT_PAYLOAD';
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
    case 'VERSION_MISSING_DEPENDENCY':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_OBJECT_STORE_FAILURE':
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_PROVIDER_FAILED':
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_STALE_PAGE_CURSOR':
    case 'VERSION_STORE_UNAVAILABLE':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return raw;
    default:
      return 'VERSION_PROVIDER_FAILED';
  }
}

function reviewArtifactSafeMessage(issueCode: string, missingMessage: string): string {
  switch (issueCode) {
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
      return 'Persisted merge review artifact payload is invalid or unsupported.';
    case 'VERSION_MISSING_OBJECT':
      return missingMessage;
    case 'VERSION_PERMISSION_DENIED':
      return 'Version merge review is not authorized for this caller.';
    case 'VERSION_REF_CONFLICT':
      return 'Version merge review target is stale.';
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'Version merge review cursor is stale.';
    default:
      return 'Version merge review provider failed.';
  }
}

function sanitizePublicIssueCode(issueCode: string): string {
  return isUnsafeDiagnosticText(issueCode, MAX_PUBLIC_DIAGNOSTIC_PAYLOAD_STRING_BYTES)
    ? 'VERSION_PROVIDER_FAILED'
    : issueCode;
}

function sanitizePublicDiagnosticMessage(issueCode: string, safeMessage: string): string {
  return isUnsafeDiagnosticText(safeMessage, MAX_PUBLIC_DIAGNOSTIC_MESSAGE_BYTES)
    ? defaultSafeMessageForIssue(issueCode)
    : safeMessage;
}

function sanitizePublicDiagnosticPayload(
  operation: VersionMergePublicOperation,
  payload?: VersionStoreDiagnostic['payload'],
): VersionDiagnosticPublicPayload {
  const sanitized: Record<string, string | number | boolean | null> = {};
  if (payload) {
    for (const [key, value] of Object.entries(payload)) {
      if (key === 'operation' || !PUBLIC_DIAGNOSTIC_PAYLOAD_KEY_RE.test(key)) continue;
      const sanitizedValue = sanitizePublicDiagnosticPayloadValue(key, value);
      if (sanitizedValue !== undefined) sanitized[key] = sanitizedValue;
    }
  }
  sanitized.operation = operation;
  return sanitized;
}

function sanitizePublicDiagnosticPayloadValue(
  key: string,
  value: unknown,
): string | number | boolean | null | undefined {
  if (isSensitiveDiagnosticPayloadKey(key)) return 'redacted';
  switch (typeof value) {
    case 'string':
      return isUnsafeDiagnosticText(value, MAX_PUBLIC_DIAGNOSTIC_PAYLOAD_STRING_BYTES)
        ? 'redacted'
        : value;
    case 'number':
      return Number.isFinite(value) ? value : undefined;
    case 'boolean':
      return value;
    default:
      return value === null ? null : undefined;
  }
}

function isUnsafeDiagnosticText(value: string, maxUtf8Bytes: number): boolean {
  return (
    utf8ByteLength(value) > maxUtf8Bytes ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    CELL_REFERENCE_TEXT_RE.test(value) ||
    HOST_OBJECT_TEXT_RE.test(value) ||
    PACKAGE_PATH_TEXT_RE.test(value) ||
    STRUCTURAL_PATH_TEXT_RE.test(value) ||
    UNSAFE_VALUE_TEXT_RE.test(value) ||
    SENSITIVE_PRINCIPAL_TOKEN_RE.test(value) ||
    PERSISTED_ARTIFACT_REF_TEXT_RE.test(value)
  );
}

function isSensitiveDiagnosticPayloadKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('principal') ||
    normalized.includes('digest') ||
    normalized.includes('hidden') ||
    normalized === 'conflictid' ||
    normalized === 'optionid' ||
    normalized === 'payloadid' ||
    normalized === 'resultid' ||
    normalized === 'resolutionsetdigest' ||
    normalized === 'resolvedattemptdigest' ||
    normalized === 'targetref' ||
    normalized === 'expectedtargethead' ||
    normalized === 'commitid' ||
    normalized === 'basecommitid' ||
    normalized === 'headcommitid' ||
    normalized === 'value' ||
    normalized === 'before' ||
    normalized === 'after' ||
    normalized === 'rawvalue' ||
    normalized === 'cellvalue'
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

function isRecoverability(value: unknown): value is VersionStoreDiagnostic['recoverability'] {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none';
}
