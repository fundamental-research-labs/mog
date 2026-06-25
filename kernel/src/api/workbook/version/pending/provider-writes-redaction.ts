import type { PublicDiagnosticData } from './provider-writes-types';
import { isRecord } from './provider-writes-utils';

const PENDING_REMOTE_SEGMENT_ID_RE = /^pending-remote-segment:sha256:[0-9a-f]{64}$/;
const PENDING_REMOTE_IDEMPOTENCY_KEY_RE = /^pending-remote:sha256:[0-9a-f]{64}$/;
const SYNC_BATCH_STATUS_ID_RE = /^sync-batch-status:sha256:[0-9a-f]{64}$/;
const REDACTED_DIAGNOSTIC_KEYS = new Set([
  'authorityref',
  'originid',
  'payloadhash',
  'providerid',
  'providerrefid',
  'remotesessionid',
  'roomid',
  'sessionid',
  'stableoriginid',
  'updateid',
]);

export function providerDiagnosticsData(diagnostics: unknown): PublicDiagnosticData {
  if (!Array.isArray(diagnostics)) return { redacted: true };
  const data: Record<string, string | number | boolean | null> = {
    providerDiagnosticCount: diagnostics.length,
  };
  const firstDiagnostic = diagnostics.find(isRecord);
  if (firstDiagnostic) {
    assignSanitizedDiagnosticValue(data, 'providerDiagnosticCode', firstDiagnostic.code);
    assignSanitizedDiagnosticValue(
      data,
      'providerDiagnosticRecoverability',
      firstDiagnostic.recoverability,
    );
    assignSanitizedDiagnosticDetails(data, firstDiagnostic.details);
    assignSanitizedDiagnosticDetails(data, firstDiagnostic.payload);
  }
  data.redacted = true;
  return data;
}

function assignSanitizedDiagnosticDetails(
  data: Record<string, string | number | boolean | null>,
  details: unknown,
): void {
  if (!isRecord(details)) return;
  for (const [key, value] of Object.entries(details)) {
    assignSanitizedDiagnosticValue(data, key, value);
  }
}

function assignSanitizedDiagnosticValue(
  data: Record<string, string | number | boolean | null>,
  key: string,
  value: unknown,
): void {
  if (!isPublicDiagnosticDataValue(value)) return;
  data[key] = shouldRedactDiagnosticDataValue(key, value) ? 'redacted' : value;
}

function isPublicDiagnosticDataValue(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function shouldRedactDiagnosticDataValue(
  key: string,
  value: string | number | boolean | null,
): boolean {
  const normalizedKey = key.toLowerCase();
  if (
    REDACTED_DIAGNOSTIC_KEYS.has(normalizedKey) ||
    normalizedKey.includes('secret') ||
    normalizedKey.includes('credential') ||
    normalizedKey.includes('password') ||
    normalizedKey.includes('authorization') ||
    normalizedKey.includes('token') ||
    normalizedKey.includes('cursor') ||
    normalizedKey.includes('trace') ||
    normalizedKey.includes('opaque') ||
    normalizedKey.includes('hidden') ||
    normalizedKey.includes('deleted') ||
    normalizedKey.includes('protected') ||
    normalizedKey === 'pagetoken' ||
    normalizedKey === 'nextpagetoken' ||
    normalizedKey.endsWith('batchid') ||
    normalizedKey.endsWith('batchstatusid')
  ) {
    return true;
  }
  return (
    typeof value === 'string' &&
    (SYNC_BATCH_STATUS_ID_RE.test(value) ||
      PENDING_REMOTE_SEGMENT_ID_RE.test(value) ||
      PENDING_REMOTE_IDEMPOTENCY_KEY_RE.test(value))
  );
}
