import type { VersionResult } from '@mog-sdk/contracts/api';

import {
  hardenVersionProposalServiceResult,
  sanitizeVersionProposalServiceValue,
} from './version-proposal-diagnostics';
import { isRecord } from './version-proposal-guards';
import {
  proposalFailure,
  providerInvalidPayloadDiagnostic,
} from './version-proposal-service-diagnostics';
import type { VersionProposalPublicOperation } from './version-proposal-types';

export function mapProposalServiceResult<T>(
  operation: VersionProposalPublicOperation,
  value: unknown,
): VersionResult<T> {
  if (isVersionResult(value)) {
    return hardenVersionProposalServiceResult(value as VersionResult<T>);
  }
  if (isRecord(value)) return { ok: true, value: sanitizeVersionProposalServiceValue(value as T) };
  if (operation === 'disposeProposalWorkspace' && value === true) {
    return { ok: true, value: { disposed: true } as T };
  }
  return proposalFailure(operation, [providerInvalidPayloadDiagnostic(operation)]);
}

function isVersionResult(value: unknown): boolean {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok === true) return 'value' in value;
  return value.ok === false && isRecord(value.error);
}
