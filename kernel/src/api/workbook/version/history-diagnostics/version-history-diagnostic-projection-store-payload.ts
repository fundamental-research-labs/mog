import type { VersionDiagnosticPublicPayload } from '@mog-sdk/contracts/api';

import {
  diagnosticHistoryCondition,
  HISTORY_GAP_REASON,
  STALE_HEAD_REASON,
} from './version-history-diagnostic-projection-store-condition';
import {
  isPublicProviderDetailKey,
  isRecord,
  isSensitiveProviderDiagnosticPayloadKey,
  isUnsafeProviderDiagnosticString,
} from './version-history-diagnostic-projection-store-redaction';

const PUBLIC_OPERATION_RE = /^[A-Za-z][A-Za-z0-9:._/-]{0,95}$/;
const PUBLIC_OPTION_NAME_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;

export function projectVersionStoreDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = {};
  const operation = publicOperation(value.payload) ?? publicOperation(value);
  if (operation) payload.operation = operation;

  mergePublicPayload(payload, value.payload);
  mergePublicDiagnosticDetails(payload, value.details);

  const condition = diagnosticHistoryCondition(value, payload);
  if (condition === STALE_HEAD_REASON) {
    payload.condition = STALE_HEAD_REASON;
    payload.completenessCondition = 'stale';
    payload.refName = 'redacted';
    payload.head = 'redacted';
    payload.historyHead = 'stale';
  } else if (condition === HISTORY_GAP_REASON) {
    payload.condition = HISTORY_GAP_REASON;
    payload.completenessCondition = HISTORY_GAP_REASON;
    payload.historyCompleteness = HISTORY_GAP_REASON;
  }

  return Object.freeze(payload);
}

function mergePublicPayload(
  output: Record<string, string | number | boolean | null>,
  value: unknown,
): void {
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'operation') continue;
    const projected = projectPublicDiagnosticPayloadValue(key, entry);
    if (projected !== undefined) output[key] = projected;
  }
}

function mergePublicDiagnosticDetails(
  output: Record<string, string | number | boolean | null>,
  value: unknown,
): void {
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (!isPublicProviderDetailKey(key)) continue;
    const projected = projectPublicDiagnosticPayloadValue(key, entry);
    if (projected !== undefined) output[key] = projected;
  }
}

function projectPublicDiagnosticPayloadValue(
  key: string,
  value: unknown,
): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  if (key === 'option') return projectPublicDiagnosticOptionName(value);
  if (!isPublicProviderDetailKey(key) && isSensitiveProviderDiagnosticPayloadKey(key)) {
    return 'redacted';
  }
  return isUnsafeProviderDiagnosticString(value) ? 'redacted' : value;
}

function projectPublicDiagnosticOptionName(value: string): string | undefined {
  if (!PUBLIC_OPTION_NAME_RE.test(value)) return undefined;
  if (isUnsafeProviderDiagnosticString(value) && value !== 'pageToken') return 'redacted';
  return value;
}

function publicOperation(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.operation !== 'string') return undefined;
  return PUBLIC_OPERATION_RE.test(value.operation) ? value.operation : undefined;
}
