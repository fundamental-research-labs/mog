const COMMIT_ID_RE = /\bcommit:sha256:[0-9a-f]{64}\b/;
const COMMIT_ID_GLOBAL_RE = /\bcommit:sha256:[0-9a-f]{64}\b/g;
const REF_NAME_RE = /\brefs\/[A-Za-z0-9._/-]+\b/;
const REF_NAME_GLOBAL_RE = /\brefs\/[A-Za-z0-9._/-]+\b/g;

export function isPublicProviderDetailKey(key: string): boolean {
  return (
    key === 'accessFiltered' ||
    key === 'completenessCondition' ||
    key === 'completenessMarker' ||
    key === 'completenessScope' ||
    key === 'corruptTraversalCondition' ||
    key === 'missingCommitRole' ||
    key === 'mode' ||
    key === 'mutationGuarantee' ||
    key === 'option' ||
    key === 'reason' ||
    key === 'reloadIssue'
  );
}

export function isSensitiveProviderDiagnosticPayloadKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('namespace') ||
    normalized.includes('documentscope') ||
    normalized.includes('principal') ||
    normalized.includes('userid') ||
    normalized.includes('useremail') ||
    normalized.includes('client') ||
    normalized.includes('session') ||
    normalized.includes('actor') ||
    normalized.includes('author') ||
    normalized.includes('providerref') ||
    normalized.includes('authorityref') ||
    normalized.includes('originid') ||
    normalized.includes('commit') ||
    normalized.includes('ref') ||
    normalized.includes('branch') ||
    normalized.includes('head') ||
    normalized.includes('revision') ||
    normalized.includes('token') ||
    normalized.includes('cursor') ||
    normalized.includes('path') ||
    normalized.includes('value') ||
    normalized.includes('formula') ||
    normalized.includes('result') ||
    normalized.includes('digest') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.includes('password') ||
    normalized.includes('trace') ||
    normalized.includes('opaque') ||
    normalized.includes('hidden') ||
    normalized.includes('deleted') ||
    normalized.includes('protected')
  );
}

export function isSensitiveDiagnosticScanKey(key: string): boolean {
  return isSensitiveProviderDiagnosticPayloadKey(key);
}

export function isUnsafeProviderDiagnosticString(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    COMMIT_ID_RE.test(value) ||
    REF_NAME_RE.test(value) ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('credential') ||
    normalized.includes('password') ||
    normalized.includes('principal') ||
    normalized.includes('client') ||
    normalized.includes('session') ||
    normalized.includes('namespace') ||
    normalized.includes('hidden') ||
    normalized.includes('protected') ||
    normalized.includes('deleted')
  );
}

export function sanitizeDiagnosticMessage(value: string): string {
  return value
    .replace(COMMIT_ID_GLOBAL_RE, 'redacted')
    .replace(REF_NAME_GLOBAL_RE, 'redacted')
    .replace(
      /\b(?:client|session|principal|namespace|token|secret)[A-Za-z0-9._:-]*\b/gi,
      'redacted',
    );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
