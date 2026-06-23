import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import {
  LIVE_COLLABORATION_DIAGNOSTIC_DEPENDENCIES,
  REDACTED_LIVE_COLLABORATION_ID,
} from './version-live-collaboration-status-constants';
import { isRecord } from './version-live-collaboration-status-guards';
import type {
  UnsafeProviderLifecycleState,
  VersionLiveCollaborationStatus,
} from './version-live-collaboration-status-types';

export function diagnostic(
  code: VersionDiagnostic['code'],
  severity: VersionDiagnostic['severity'],
  message: string,
  status?: VersionLiveCollaborationStatus,
): VersionDiagnostic {
  const data = status ? diagnosticData(status) : undefined;
  return {
    code,
    severity,
    message,
    dependency: 'VC-09',
    ...(data && Object.keys(data).length > 0 ? { data } : {}),
  };
}

export function diagnosticData(
  status: VersionLiveCollaborationStatus,
): NonNullable<VersionDiagnostic['data']> {
  const providerLifecycleState = unsafeProviderLifecycleState(status);
  return {
    collaborationState: status.state,
    statusRevision: status.statusRevision,
    ...(providerLifecycleState ? { providerLifecycleState } : {}),
    ...(status.roomId ? { roomId: REDACTED_LIVE_COLLABORATION_ID, redacted: true } : {}),
    ...(status.sidecarStatus ? { sidecarStatus: status.sidecarStatus } : {}),
    ...(typeof status.activeParticipantCount === 'number'
      ? { activeParticipantCount: status.activeParticipantCount }
      : {}),
    ...(typeof status.remoteProviderAttached === 'boolean'
      ? { remoteProviderAttached: status.remoteProviderAttached }
      : {}),
    ...(typeof status.inFlightRemoteUpdateCount === 'number'
      ? { inFlightRemoteUpdateCount: status.inFlightRemoteUpdateCount }
      : {}),
    ...(typeof status.syncApplyRemoteQueueDepth === 'number'
      ? { syncApplyRemoteQueueDepth: status.syncApplyRemoteQueueDepth }
      : {}),
  };
}

export function unsafeProviderLifecycleState(
  status: VersionLiveCollaborationStatus,
): UnsafeProviderLifecycleState | null {
  const sidecarTokens = normalizedSidecarStatusTokens(status.sidecarStatus);
  if (sidecarTokens.has('active') || sidecarTokens.has('joining') || sidecarTokens.has('syncing')) {
    return 'active';
  }
  if (sidecarTokens.has('unknown') || sidecarTokens.has('indeterminate')) return 'unknown';
  if (sidecarTokens.has('quarantine') || sidecarTokens.has('quarantined')) return 'quarantined';
  if (sidecarTokens.has('disconnect') || sidecarTokens.has('disconnected')) return 'disconnected';
  if (sidecarTokens.has('stale')) return 'stale';
  if (status.state !== 'active' && (status.activeParticipantCount ?? 0) > 1) return 'active';
  if (status.remoteProviderAttached === false && status.state === 'idle') return 'disconnected';
  if ((status.inFlightRemoteUpdateCount ?? 0) > 0) return 'inFlightRemoteUpdates';
  if ((status.syncApplyRemoteQueueDepth ?? 0) > 0) return 'syncApplyQueue';
  return null;
}

export function unsafeProviderLifecycleMessage(state: UnsafeProviderLifecycleState): string {
  switch (state) {
    case 'active':
      return 'Live collaboration provider reports active participants; checkout is disabled conservatively until the provider can be proven idle.';
    case 'disconnected':
      return 'Live collaboration provider is disconnected; checkout is disabled conservatively until the provider can be proven idle.';
    case 'unknown':
      return 'Live collaboration provider state is unknown; checkout is disabled conservatively until the provider can be proven idle.';
    case 'quarantined':
      return 'Live collaboration provider is quarantined; checkout is disabled conservatively until the provider can be proven idle.';
    case 'stale':
      return 'Live collaboration provider state is stale; checkout is disabled conservatively until the provider can be proven idle.';
    case 'inFlightRemoteUpdates':
      return 'Live collaboration provider has in-flight remote updates; checkout is disabled conservatively until they settle.';
    case 'syncApplyQueue':
      return 'Live collaboration provider has queued remote sync application work; checkout is disabled conservatively until it settles.';
  }
}

export function dedupeDiagnostics(
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

export function optionalDiagnosticArray(
  value: unknown,
  extraSensitiveValues: readonly string[],
): readonly VersionDiagnostic[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const diagnostics: VersionDiagnostic[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    if (
      typeof entry.code !== 'string' ||
      !isDiagnosticSeverity(entry.severity) ||
      typeof entry.message !== 'string'
    ) {
      return null;
    }
    const data = sanitizeDiagnosticData(entry.data, extraSensitiveValues);
    const dependency = optionalDiagnosticDependency(entry.dependency);
    diagnostics.push({
      code: entry.code,
      severity: entry.severity,
      message: redactKnownSensitiveText(entry.message, data.sensitiveValues),
      ...(dependency ? { dependency } : {}),
      ...(data.data ? { data: data.data } : {}),
    });
  }
  return Object.freeze(diagnostics);
}

export function collectSensitiveStrings(
  value: Readonly<Record<string, unknown>>,
  initialValues: readonly string[],
): readonly string[] {
  const sensitiveValues = new Set(initialValues.filter((entry) => entry.length > 0));
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && shouldRedactDiagnosticDataValue(key)) {
      sensitiveValues.add(entry);
    }
  }
  return [...sensitiveValues];
}

function normalizedSidecarStatusTokens(value: string | undefined): ReadonlySet<string> {
  if (!value) return new Set();
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 0),
  );
}

function sanitizeDiagnosticData(
  value: unknown,
  extraSensitiveValues: readonly string[],
): {
  readonly data?: NonNullable<VersionDiagnostic['data']>;
  readonly sensitiveValues: readonly string[];
} {
  if (!isRecord(value)) return { sensitiveValues: extraSensitiveValues };
  const sensitiveValues = collectSensitiveStrings(value, extraSensitiveValues);
  const data: Record<string, string | number | boolean | null> = {};
  let redacted = false;

  for (const [key, entry] of Object.entries(value)) {
    if (!isDiagnosticDataValue(entry)) continue;
    if (shouldRedactDiagnosticDataValue(key)) {
      data[key] = REDACTED_LIVE_COLLABORATION_ID;
      redacted = true;
      continue;
    }
    const sanitized =
      typeof entry === 'string' ? redactKnownSensitiveText(entry, sensitiveValues) : entry;
    if (sanitized !== entry) redacted = true;
    data[key] = sanitized;
  }

  if (redacted) data.redacted = true;
  return {
    ...(Object.keys(data).length > 0 ? { data } : {}),
    sensitiveValues,
  };
}

function redactKnownSensitiveText(value: string, sensitiveValues: readonly string[]): string {
  let redacted = value;
  for (const sensitive of [...sensitiveValues].sort((a, b) => b.length - a.length)) {
    redacted = redacted.split(sensitive).join(REDACTED_LIVE_COLLABORATION_ID);
  }
  return redacted;
}

function isDiagnosticDataValue(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function shouldRedactDiagnosticDataValue(key: string): boolean {
  const normalizedKey = key.toLowerCase();
  return (
    normalizedKey.includes('roomid') ||
    normalizedKey.includes('userid') ||
    normalizedKey.includes('providerid') ||
    normalizedKey.includes('providerref') ||
    normalizedKey.includes('participantid') ||
    normalizedKey.includes('clientid') ||
    normalizedKey.includes('sessionid') ||
    normalizedKey.includes('authorityref') ||
    normalizedKey.includes('originid')
  );
}

function isDiagnosticSeverity(value: unknown): value is VersionDiagnostic['severity'] {
  return value === 'info' || value === 'warning' || value === 'error';
}

function optionalDiagnosticDependency(value: unknown): VersionDiagnostic['dependency'] | undefined {
  return typeof value === 'string' && LIVE_COLLABORATION_DIAGNOSTIC_DEPENDENCIES.has(value)
    ? (value as VersionDiagnostic['dependency'])
    : undefined;
}
