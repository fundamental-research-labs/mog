import type { VersionDiagnostic, VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export type VersionLiveCollaborationState =
  | 'absent'
  | 'disabled'
  | 'idle'
  | 'active'
  | 'unknown';

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

export type VersionLiveCollaborationStatusReaderInput = {
  readonly readState: () =>
    | {
        readonly state: Exclude<VersionLiveCollaborationState, 'active' | 'unknown'>;
        readonly statusRevision?: string;
      }
    | {
        readonly state: 'active' | 'unknown';
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
    return {
      ...state,
      statusRevision: state.statusRevision ?? defaultStatusRevision(state),
    };
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
    diagnostics: dedupeDiagnostics([
      ...unsafeReasons,
      ...(status.diagnostics ?? []),
    ]),
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
  return [];
}

function toPublicLiveCollaborationStatus(
  status: VersionLiveCollaborationStatus,
): NonNullable<VersionSurfaceStatus['dirty']['liveCollaboration']> {
  return {
    state: status.state,
    statusRevision: status.statusRevision,
    ...(status.roomId ? { roomId: status.roomId } : {}),
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

  const status: VersionLiveCollaborationStatus = {
    state,
    statusRevision: value.statusRevision,
    ...(optionalString(value.roomId) ? { roomId: optionalString(value.roomId) } : {}),
    ...(optionalString(value.sidecarStatus)
      ? { sidecarStatus: optionalString(value.sidecarStatus) }
      : {}),
    ...(optionalNumber(value.activeParticipantCount) === undefined
      ? {}
      : { activeParticipantCount: optionalNumber(value.activeParticipantCount) }),
    ...(optionalBoolean(value.remoteProviderAttached) === undefined
      ? {}
      : { remoteProviderAttached: optionalBoolean(value.remoteProviderAttached) }),
    ...(optionalNumber(value.inFlightRemoteUpdateCount) === undefined
      ? {}
      : { inFlightRemoteUpdateCount: optionalNumber(value.inFlightRemoteUpdateCount) }),
    ...(optionalNumber(value.syncApplyRemoteQueueDepth) === undefined
      ? {}
      : { syncApplyRemoteQueueDepth: optionalNumber(value.syncApplyRemoteQueueDepth) }),
  };
  const diagnostics = optionalDiagnosticArray(value.diagnostics);
  if (value.diagnostics !== undefined && !diagnostics) return null;
  return diagnostics ? { ...status, diagnostics } : status;
}

function defaultStatusRevision(
  state:
    | ReturnType<VersionLiveCollaborationStatusReaderInput['readState']>
    | VersionLiveCollaborationStatus,
): string {
  return [
    'liveCollaboration',
    state.state,
    'roomId' in state && state.roomId ? `room:${state.roomId}` : null,
    'sidecarStatus' in state && state.sidecarStatus ? `sidecar:${state.sidecarStatus}` : null,
    'activeParticipantCount' in state && typeof state.activeParticipantCount === 'number'
      ? `participants:${state.activeParticipantCount}`
      : null,
    'remoteProviderAttached' in state && typeof state.remoteProviderAttached === 'boolean'
      ? `provider:${state.remoteProviderAttached ? 'attached' : 'none'}`
      : null,
    'inFlightRemoteUpdateCount' in state && typeof state.inFlightRemoteUpdateCount === 'number'
      ? `remoteUpdates:${state.inFlightRemoteUpdateCount}`
      : null,
    'syncApplyRemoteQueueDepth' in state && typeof state.syncApplyRemoteQueueDepth === 'number'
      ? `syncApplyQueue:${state.syncApplyRemoteQueueDepth}`
      : null,
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
  return {
    collaborationState: status.state,
    statusRevision: status.statusRevision,
    ...(status.roomId ? { roomId: status.roomId } : {}),
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

function optionalDiagnosticArray(value: unknown): readonly VersionDiagnostic[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    if (
      typeof entry.code !== 'string' ||
      typeof entry.severity !== 'string' ||
      typeof entry.message !== 'string'
    ) {
      return null;
    }
  }
  return Object.freeze(value as VersionDiagnostic[]);
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
