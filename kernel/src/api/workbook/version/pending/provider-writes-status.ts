import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import type {
  PublicDiagnosticData,
  VersionPendingProviderWritesStatus,
} from './provider-writes-types';

export function noPendingProviderWrites(
  statusRevision: string,
): VersionPendingProviderWritesStatus {
  return {
    pendingProviderWrites: false,
    statusRevision,
    unsafeReasons: [],
    diagnostics: [],
  };
}

export function failedPendingProviderWritesRead(
  message: string,
  data: PublicDiagnosticData = { redacted: true },
): VersionPendingProviderWritesStatus {
  const reason = diagnostic(
    'version.surfaceStatus.pendingProviderWritesReadFailed',
    'warning',
    `${message} Checkout is disabled conservatively until provider writes can be proven settled.`,
    { ...data, redacted: true },
  );
  return {
    pendingProviderWrites: true,
    statusRevision: 'pendingRemote:unknown',
    unsafeReasons: [reason],
    diagnostics: [reason],
  };
}

export function combinePendingProviderWriteStatuses(
  activity: VersionPendingProviderWritesStatus,
  persisted: VersionPendingProviderWritesStatus,
): VersionPendingProviderWritesStatus {
  return {
    pendingProviderWrites: activity.pendingProviderWrites || persisted.pendingProviderWrites,
    statusRevision: `${activity.statusRevision}|${persisted.statusRevision}`,
    unsafeReasons: dedupeDiagnostics([...activity.unsafeReasons, ...persisted.unsafeReasons]),
    diagnostics: dedupeDiagnostics([...activity.diagnostics, ...persisted.diagnostics]),
  };
}

export function diagnostic(
  code: VersionDiagnostic['code'],
  severity: VersionDiagnostic['severity'],
  message: string,
  data: PublicDiagnosticData = {},
): VersionDiagnostic {
  return {
    code,
    severity,
    message,
    dependency: 'VC-09',
    ...(Object.keys(data).length > 0 ? { data } : {}),
  };
}

function dedupeDiagnostics(
  diagnostics: readonly VersionDiagnostic[],
): readonly VersionDiagnostic[] {
  const seen = new Set<string>();
  const deduped: VersionDiagnostic[] = [];
  for (const item of diagnostics) {
    const key = `${item.code}:${item.message}:${JSON.stringify(item.data ?? {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return Object.freeze(deduped);
}
