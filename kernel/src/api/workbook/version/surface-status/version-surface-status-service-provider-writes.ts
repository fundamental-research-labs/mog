import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import type { VersionPendingProviderWritesStatus } from '../pending/provider-writes';

type MaybePromise<T> = T | Promise<T>;
type DiagnosticProjector = (value: unknown) => readonly VersionDiagnostic[] | null;

const SAFE_STATUS_REVISION_RE = /^[A-Za-z0-9:._|/-]{1,512}$/;

export async function readVersionSurfacePendingProviderWritesStatus(
  read: () => MaybePromise<VersionPendingProviderWritesStatus>,
  projectDiagnostics: DiagnosticProjector,
): Promise<VersionPendingProviderWritesStatus> {
  try {
    return (
      projectVersionSurfacePendingProviderWritesStatus(await read(), projectDiagnostics) ??
      unknownVersionSurfacePendingProviderWritesStatus(
        'The attached provider write status service returned an invalid payload.',
      )
    );
  } catch {
    return unknownVersionSurfacePendingProviderWritesStatus(
      'The attached provider write status service failed.',
    );
  }
}

export function projectVersionSurfacePendingProviderWritesStatus(
  value: unknown,
  projectDiagnostics: DiagnosticProjector,
): VersionPendingProviderWritesStatus | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.pendingProviderWrites !== 'boolean' ||
    typeof value.statusRevision !== 'string' ||
    !SAFE_STATUS_REVISION_RE.test(value.statusRevision)
  ) {
    return null;
  }
  const unsafeReasons = projectDiagnostics(value.unsafeReasons);
  const diagnostics = projectDiagnostics(value.diagnostics);
  if (!unsafeReasons || !diagnostics) return null;
  return normalizeVersionSurfacePendingProviderWritesStatus({
    pendingProviderWrites: value.pendingProviderWrites,
    statusRevision: value.statusRevision,
    unsafeReasons,
    diagnostics,
  });
}

export function normalizeVersionSurfacePendingProviderWritesStatus(
  status: VersionPendingProviderWritesStatus,
): VersionPendingProviderWritesStatus {
  const providerDiagnostics = dedupeDiagnostics(
    [...status.unsafeReasons, ...status.diagnostics].filter(isProviderWriteDiagnostic),
  );
  const pendingProviderWrites = status.pendingProviderWrites || providerDiagnostics.length > 0;
  if (!pendingProviderWrites) return status;
  const fallback =
    providerDiagnostics.length === 0
      ? [
          providerWriteReadFailedDiagnostic(
            'Version provider write state could not be proven settled.',
          ),
        ]
      : [];
  return {
    ...status,
    pendingProviderWrites: true,
    unsafeReasons: dedupeDiagnostics([
      ...status.unsafeReasons,
      ...providerDiagnostics,
      ...fallback,
    ]),
    diagnostics: dedupeDiagnostics([...status.diagnostics, ...providerDiagnostics, ...fallback]),
  };
}

function unknownVersionSurfacePendingProviderWritesStatus(
  message: string,
): VersionPendingProviderWritesStatus {
  const reason = providerWriteReadFailedDiagnostic(message);
  return {
    pendingProviderWrites: true,
    statusRevision: 'providerActivity:unknown',
    unsafeReasons: [reason],
    diagnostics: [reason],
  };
}

function isProviderWriteDiagnostic(diagnostic: VersionDiagnostic): boolean {
  return (
    diagnostic.code === 'version.surfaceStatus.pendingProviderWrites' ||
    diagnostic.code === 'version.surfaceStatus.pendingProviderWritesReadFailed'
  );
}

function providerWriteReadFailedDiagnostic(message: string): VersionDiagnostic {
  return {
    code: 'version.surfaceStatus.pendingProviderWritesReadFailed',
    severity: 'warning',
    message: `${message} Checkout is disabled conservatively until provider writes can be proven settled.`,
    dependency: 'VC-09',
    data: { redacted: true, providerPayload: 'providerWriteStatus' },
  };
}

function dedupeDiagnostics(
  diagnostics: readonly VersionDiagnostic[],
): readonly VersionDiagnostic[] {
  const seen = new Set<string>();
  const deduped: VersionDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}:${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(diagnostic);
  }
  return deduped;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
