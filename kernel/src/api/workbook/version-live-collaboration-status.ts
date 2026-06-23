import type { VersionDiagnostic, VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;
const REDACTED_LIVE_COLLABORATION_ID = 'redacted';
const LIVE_COLLABORATION_DIAGNOSTIC_DEPENDENCIES = new Set([
  'VC-04',
  'VC-05',
  'VC-07',
  'VC-09',
  'storage',
  'featureGate',
  'hostCapability',
  'upstreamRevertContract',
]);

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export type VersionLiveCollaborationState = 'absent' | 'disabled' | 'idle' | 'active' | 'unknown';

export type VersionLiveCollaborationStatus = {
  readonly state: VersionLiveCollaborationState;
  readonly statusRevision: string;
  readonly roomId?: string;
  readonly sidecarStatus?: string;
  readonly activeParticipantCount?: number;
  readonly remoteProviderAttached?: boolean;
  readonly inFlightRemoteUpdateCount?: number;
  readonly syncApplyRemoteQueueDepth?: number;
  readonly diagnostics?: readonly VersionDiagnostic[];
};

export type VersionLiveCollaborationStatusReader =
  () => MaybePromise<VersionLiveCollaborationStatus>;

export type VersionLiveCollaborationStatusService = {
  readonly readLiveCollaborationStatus?: VersionLiveCollaborationStatusReader;
  readonly getLiveCollaborationStatus?: VersionLiveCollaborationStatusReader;
  readonly readStatus?: VersionLiveCollaborationStatusReader;
  readonly getStatus?: VersionLiveCollaborationStatusReader;
};

export type VersionLiveCollaborationDirtyStatus = {
  readonly liveCollaboration: NonNullable<VersionSurfaceStatus['dirty']['liveCollaboration']>;
  readonly statusRevision: string;
  readonly unsafeReasons: readonly VersionDiagnostic[];
  readonly diagnostics: readonly VersionDiagnostic[];
};

type UnsafeProviderLifecycleState =
  | 'disconnected'
  | 'quarantined'
  | 'stale'
  | 'inFlightRemoteUpdates'
  | 'syncApplyQueue';

export type VersionLiveCollaborationStatusReaderInput = {
  readonly readState: () => {
    readonly state: VersionLiveCollaborationState;
    readonly roomId?: string;
    readonly sidecarStatus?: string;
    readonly activeParticipantCount?: number;
    readonly remoteProviderAttached?: boolean;
    readonly inFlightRemoteUpdateCount?: number;
    readonly syncApplyRemoteQueueDepth?: number;
    readonly statusRevision?: string;
  };
};

export function createVersionLiveCollaborationStatusReader(
  input: VersionLiveCollaborationStatusReaderInput,
): VersionLiveCollaborationStatusReader {
  return () => {
    const state = input.readState();
    const projected = projectLiveCollaborationStatus(withDefaultStatusRevision(state));
    return (
      projected ??
      unknownLiveCollaborationStatus(
        'The local VC-05 live-collaboration state reader returned an invalid payload.',
      )
    );
  };
}

export async function readVersionLiveCollaborationStatus(
  ctx: DocumentContext,
): Promise<VersionLiveCollaborationDirtyStatus> {
  const reader = getAttachedLiveCollaborationStatusReader(ctx);
  if (!reader) return liveCollaborationDirtyStatus(absentLiveCollaborationStatus());

  try {
    const projected = projectLiveCollaborationStatus(await reader());
    if (projected) return liveCollaborationDirtyStatus(projected);
  } catch {
    return liveCollaborationDirtyStatus(
      unknownLiveCollaborationStatus(
        'The attached VC-05 live-collaboration status service failed.',
      ),
    );
  }

  return liveCollaborationDirtyStatus(
    unknownLiveCollaborationStatus(
      'The attached VC-05 live-collaboration status service returned an invalid payload.',
    ),
  );
}

function getAttachedLiveCollaborationStatusReader(
  ctx: DocumentContext,
): VersionLiveCollaborationStatusReader | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.liveCollaborationStatusService,
    services.versionLiveCollaborationStatusService,
    services.collaborationStatusService,
    services.versionCollaborationStatusService,
    services,
  ]) {
    const reader = toLiveCollaborationStatusReader(candidate);
    if (reader) return reader;
  }
  return null;
}

function toLiveCollaborationStatusReader(
  value: unknown,
): VersionLiveCollaborationStatusReader | null {
  const read =
    bindMethod(value, 'readLiveCollaborationStatus') ??
    bindMethod(value, 'getLiveCollaborationStatus') ??
    bindMethod(value, 'readStatus') ??
    bindMethod(value, 'getStatus');
  return read ? () => read() as MaybePromise<VersionLiveCollaborationStatus> : null;
}

function liveCollaborationDirtyStatus(
  status: VersionLiveCollaborationStatus,
): VersionLiveCollaborationDirtyStatus {
  const liveCollaboration = toPublicLiveCollaborationStatus(status);
  const unsafeReasons = liveCollaborationUnsafeReasons(status);
  return {
    liveCollaboration,
    statusRevision: status.statusRevision,
    unsafeReasons,
    diagnostics: dedupeDiagnostics([...unsafeReasons, ...(status.diagnostics ?? [])]),
  };
}

function liveCollaborationUnsafeReasons(
  status: VersionLiveCollaborationStatus,
): readonly VersionDiagnostic[] {
  if (status.state === 'active') {
    return [
      diagnostic(
        'version.surfaceStatus.liveCollaborationActive',
        'warning',
        'Live collaboration is active; checkout is unsafe until the stream is fully closed.',
        status,
      ),
    ];
  }
  if (status.state === 'unknown') {
    return [
      diagnostic(
        'version.surfaceStatus.liveCollaborationUnknown',
        'warning',
        'Live collaboration state could not be proven idle; checkout is disabled conservatively.',
        status,
      ),
    ];
  }
  const unsafeProviderState = unsafeProviderLifecycleState(status);
  if (unsafeProviderState) {
    return [
      diagnostic(
        'version.surfaceStatus.liveCollaborationUnknown',
        'warning',
        unsafeProviderLifecycleMessage(unsafeProviderState),
        status,
      ),
    ];
  }
  return [];
}

function toPublicLiveCollaborationStatus(
  status: VersionLiveCollaborationStatus,
): NonNullable<VersionSurfaceStatus['dirty']['liveCollaboration']> {
  return {
    state: status.state,
    statusRevision: status.statusRevision,
    ...(status.roomId ? { roomId: REDACTED_LIVE_COLLABORATION_ID } : {}),
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

function absentLiveCollaborationStatus(): VersionLiveCollaborationStatus {
  return {
    state: 'absent',
    statusRevision: 'liveCollaboration:absent',
  };
}

function unknownLiveCollaborationStatus(message: string): VersionLiveCollaborationStatus {
  return {
    state: 'unknown',
    statusRevision: 'liveCollaboration:unknown',
    diagnostics: [
      diagnostic(
        'version.surfaceStatus.liveCollaborationUnknown',
        'warning',
        `${message} Checkout is disabled conservatively until live collaboration can be proven idle.`,
      ),
    ],
  };
}

function projectLiveCollaborationStatus(value: unknown): VersionLiveCollaborationStatus | null {
  if (!isRecord(value)) return null;
  const state = value.state;
  if (!isLiveCollaborationState(state)) return null;
  if (typeof value.statusRevision !== 'string' || value.statusRevision.length === 0) return null;

  const roomId = optionalStringField(value, 'roomId');
  const sidecarStatus = optionalStringField(value, 'sidecarStatus');
  const activeParticipantCount = optionalNumberField(value, 'activeParticipantCount');
  const remoteProviderAttached = optionalBooleanField(value, 'remoteProviderAttached');
  const inFlightRemoteUpdateCount = optionalNumberField(value, 'inFlightRemoteUpdateCount');
  const syncApplyRemoteQueueDepth = optionalNumberField(value, 'syncApplyRemoteQueueDepth');
  if (
    roomId === null ||
    sidecarStatus === null ||
    activeParticipantCount === null ||
    remoteProviderAttached === null ||
    inFlightRemoteUpdateCount === null ||
    syncApplyRemoteQueueDepth === null
  ) {
    return null;
  }

  const redactedValues = collectSensitiveStrings(value, roomId ? [roomId] : []);
  const diagnostics = optionalDiagnosticArray(value.diagnostics, redactedValues);
  if (diagnostics === null) return null;

  const status: VersionLiveCollaborationStatus = {
    state,
    statusRevision: defaultStatusRevision({
      state,
      ...(roomId ? { roomId } : {}),
      ...(sidecarStatus ? { sidecarStatus } : {}),
      ...(activeParticipantCount === undefined ? {} : { activeParticipantCount }),
      ...(remoteProviderAttached === undefined ? {} : { remoteProviderAttached }),
      ...(inFlightRemoteUpdateCount === undefined ? {} : { inFlightRemoteUpdateCount }),
      ...(syncApplyRemoteQueueDepth === undefined ? {} : { syncApplyRemoteQueueDepth }),
    }),
    ...(roomId ? { roomId } : {}),
    ...(sidecarStatus ? { sidecarStatus } : {}),
    ...(activeParticipantCount === undefined ? {} : { activeParticipantCount }),
    ...(remoteProviderAttached === undefined ? {} : { remoteProviderAttached }),
    ...(inFlightRemoteUpdateCount === undefined ? {} : { inFlightRemoteUpdateCount }),
    ...(syncApplyRemoteQueueDepth === undefined ? {} : { syncApplyRemoteQueueDepth }),
  };
  return diagnostics ? { ...status, diagnostics } : status;
}

function withDefaultStatusRevision(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    statusRevision: optionalString(value.statusRevision) ?? defaultStatusRevision(value),
  };
}

function defaultStatusRevision(state: {
  readonly state?: unknown;
  readonly roomId?: unknown;
  readonly sidecarStatus?: unknown;
  readonly activeParticipantCount?: unknown;
  readonly remoteProviderAttached?: unknown;
  readonly inFlightRemoteUpdateCount?: unknown;
  readonly syncApplyRemoteQueueDepth?: unknown;
}): string {
  const collaborationState = isLiveCollaborationState(state.state) ? state.state : 'unknown';
  const sidecarStatus = optionalString(state.sidecarStatus);
  const activeParticipantCount = optionalNumber(state.activeParticipantCount);
  const remoteProviderAttached = optionalBoolean(state.remoteProviderAttached);
  const inFlightRemoteUpdateCount = optionalNumber(state.inFlightRemoteUpdateCount);
  const syncApplyRemoteQueueDepth = optionalNumber(state.syncApplyRemoteQueueDepth);
  return [
    'liveCollaboration',
    collaborationState,
    optionalString(state.roomId) ? `room:${REDACTED_LIVE_COLLABORATION_ID}` : null,
    sidecarStatus ? `sidecar:${sidecarStatus}` : null,
    activeParticipantCount === undefined ? null : `participants:${activeParticipantCount}`,
    remoteProviderAttached === undefined
      ? null
      : `provider:${remoteProviderAttached ? 'attached' : 'none'}`,
    inFlightRemoteUpdateCount === undefined ? null : `remoteUpdates:${inFlightRemoteUpdateCount}`,
    syncApplyRemoteQueueDepth === undefined ? null : `syncApplyQueue:${syncApplyRemoteQueueDepth}`,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(':');
}

function diagnostic(
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

function diagnosticData(
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

function unsafeProviderLifecycleState(
  status: VersionLiveCollaborationStatus,
): UnsafeProviderLifecycleState | null {
  const sidecarTokens = normalizedSidecarStatusTokens(status.sidecarStatus);
  if (sidecarTokens.has('quarantine') || sidecarTokens.has('quarantined')) return 'quarantined';
  if (sidecarTokens.has('disconnect') || sidecarTokens.has('disconnected')) return 'disconnected';
  if (sidecarTokens.has('stale')) return 'stale';
  if (status.remoteProviderAttached === false && status.state === 'idle') return 'disconnected';
  if ((status.inFlightRemoteUpdateCount ?? 0) > 0) return 'inFlightRemoteUpdates';
  if ((status.syncApplyRemoteQueueDepth ?? 0) > 0) return 'syncApplyQueue';
  return null;
}

function unsafeProviderLifecycleMessage(state: UnsafeProviderLifecycleState): string {
  switch (state) {
    case 'disconnected':
      return 'Live collaboration provider is disconnected; checkout is disabled conservatively until the provider can be proven idle.';
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

function normalizedSidecarStatusTokens(value: string | undefined): ReadonlySet<string> {
  if (!value) return new Set();
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 0),
  );
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

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalStringField(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined | null {
  if (value[key] === undefined) return undefined;
  return optionalString(value[key]) ?? null;
}

function optionalNumberField(
  value: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined | null {
  if (value[key] === undefined) return undefined;
  return optionalNumber(value[key]) ?? null;
}

function optionalBooleanField(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined | null {
  if (value[key] === undefined) return undefined;
  return optionalBoolean(value[key]) ?? null;
}

function optionalDiagnosticArray(
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

function collectSensitiveStrings(
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

function isLiveCollaborationState(value: unknown): value is VersionLiveCollaborationState {
  return (
    value === 'absent' ||
    value === 'disabled' ||
    value === 'idle' ||
    value === 'active' ||
    value === 'unknown'
  );
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
