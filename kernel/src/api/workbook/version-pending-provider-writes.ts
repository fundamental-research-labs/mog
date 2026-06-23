import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  hasPendingRemoteSegmentStoreProvider,
  isPendingRemoteSegmentRecord,
  pendingRemoteSegmentKeyMaterialForOperationContext,
  type PendingRemoteSegmentRecord,
} from '../../document/version-store/pending-remote-segment-store';
import { versionGraphNamespaceKey } from '../../document/version-store/object-store';
import type {
  VersionGraphRegistryReadResult,
  VersionStoreProvider,
} from '../../document/version-store/provider';
import {
  namespaceForRegistry,
  versionDocumentScopeKey,
  type VersionGraphRegistry,
} from '../../document/version-store/registry';
import {
  isVersionProviderWriteActivityTracker,
  type VersionProviderWriteActivitySnapshot,
} from '../../document/version-store/provider-write-activity';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const OBJECT_DIGEST_RE = /^[0-9a-f]{64}$/;
const PENDING_REMOTE_SEGMENT_ID_RE = /^pending-remote-segment:sha256:[0-9a-f]{64}$/;
const PENDING_REMOTE_IDEMPOTENCY_KEY_RE = /^pending-remote:sha256:[0-9a-f]{64}$/;
const SYNC_BATCH_STATUS_ID_RE = /^sync-batch-status:sha256:[0-9a-f]{64}$/;
const SAFE_STATUS_REVISION_RE = /^[A-Za-z0-9:._|/-]{1,512}$/;
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

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type PublicDiagnosticData = Readonly<Record<string, string | number | boolean | null>>;

type ProviderWriteActivityProjection =
  | {
      readonly status: 'absent';
    }
  | {
      readonly status: 'ok';
      readonly activity: VersionProviderWriteActivitySnapshot;
    }
  | {
      readonly status: 'failed';
      readonly data: PublicDiagnosticData;
    };

type RegistryProjection =
  | {
      readonly status: 'ok';
      readonly registry: VersionGraphRegistry;
    }
  | {
      readonly status: 'absent';
    }
  | {
      readonly status: 'failed';
      readonly message: string;
      readonly data: PublicDiagnosticData;
    };

export type VersionPendingProviderWritesStatus = {
  readonly pendingProviderWrites: boolean;
  readonly statusRevision: string;
  readonly unsafeReasons: readonly VersionDiagnostic[];
  readonly diagnostics: readonly VersionDiagnostic[];
};

export async function readVersionPendingProviderWrites(
  ctx: DocumentContext,
): Promise<VersionPendingProviderWritesStatus> {
  const activity = readAttachedProviderWriteActivity(ctx);
  const persisted = await readPersistedPendingRemoteProviderWrites(ctx);
  if (activity.status === 'failed') {
    return combinePendingProviderWriteStatuses(
      failedProviderWriteActivityStatus(activity.data),
      persisted,
    );
  }
  if (activity.status === 'absent' || !hasProviderWriteActivity(activity.activity)) {
    return persisted;
  }
  return combinePendingProviderWriteStatuses(
    activeProviderWriteActivityStatus(activity.activity),
    persisted,
  );
}

async function readPersistedPendingRemoteProviderWrites(
  ctx: DocumentContext,
): Promise<VersionPendingProviderWritesStatus> {
  const provider = getAttachedVersionStoreProvider(ctx);
  if (!provider || !hasPendingRemoteSegmentStoreProvider(provider)) {
    return noPendingProviderWrites('provider:none');
  }

  let registry: VersionGraphRegistryReadResult;
  try {
    registry = await provider.readGraphRegistry();
  } catch {
    return failedPendingProviderWritesRead(
      'Version provider failed while reading the visible graph registry for checkout preflight.',
    );
  }

  const projectedRegistry = projectRegistryReadResult(registry);
  if (projectedRegistry.status === 'failed') {
    return failedPendingProviderWritesRead(projectedRegistry.message, projectedRegistry.data);
  }

  if (projectedRegistry.status === 'absent') {
    return noPendingProviderWrites('pendingRemote:absentGraph');
  }

  try {
    const registry = projectedRegistry.registry;
    const namespace = namespaceForRegistry(registry);
    const store = await provider.openPendingRemoteSegmentStore(
      namespace,
    );
    const listed = await store.listByState('pending');
    const projectedList = await projectPendingRemoteSegmentListResult(listed, registry);
    if (projectedList.status === 'failed') {
      return failedPendingProviderWritesRead(
        projectedList.message,
        projectedList.data,
      );
    }

    if (projectedList.records.length === 0) {
      return noPendingProviderWrites('pendingRemote:0');
    }

    const reason = diagnostic(
      'version.surfaceStatus.pendingProviderWrites',
      'warning',
      'Remote sync changes are waiting to be promoted into version history; checkout is unsafe.',
      {
        pendingRemoteSegmentCount: projectedList.records.length,
      },
    );
    return {
      pendingProviderWrites: true,
      statusRevision: `pendingRemote:${projectedList.records.length}`,
      unsafeReasons: [reason],
      diagnostics: [reason],
    };
  } catch {
    return failedPendingProviderWritesRead(
      'Version provider failed while opening pending remote segment state for checkout preflight.',
    );
  }
}

function readAttachedProviderWriteActivity(
  ctx: DocumentContext,
): ProviderWriteActivityProjection {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return { status: 'absent' };
  const pendingRemotePromotionService = isRecord(services.pendingRemotePromotionService)
    ? services.pendingRemotePromotionService
    : null;
  for (const candidate of [
    services.providerWriteActivityTracker,
    services.versionProviderWriteActivityTracker,
    services.providerWriteActivity,
    services.versionProviderWriteActivity,
    pendingRemotePromotionService?.providerWriteActivityTracker,
    services,
  ]) {
    if (!isVersionProviderWriteActivityTracker(candidate)) continue;
    try {
      return projectProviderWriteActivitySnapshot(candidate.readActivity());
    } catch {
      return failedProviderWriteActivityRead();
    }
  }
  return { status: 'absent' };
}

function hasProviderWriteActivity(activity: VersionProviderWriteActivitySnapshot): boolean {
  return (
    activity.remoteSyncApplyActiveCount > 0 ||
    activity.pendingRemotePromotionActiveCount > 0 ||
    activity.pendingRemotePromotionQueuedCount > 0
  );
}

function activeProviderWriteActivityStatus(
  activity: VersionProviderWriteActivitySnapshot,
): VersionPendingProviderWritesStatus {
  const reason = diagnostic(
    'version.surfaceStatus.pendingProviderWrites',
    'warning',
    'Version provider writes are in flight; checkout is unsafe until they settle.',
    {
      remoteSyncApplyActiveCount: activity.remoteSyncApplyActiveCount,
      pendingRemotePromotionActiveCount: activity.pendingRemotePromotionActiveCount,
      pendingRemotePromotionQueuedCount: activity.pendingRemotePromotionQueuedCount,
    },
  );
  return {
    pendingProviderWrites: true,
    statusRevision: `providerActivity:${activity.statusRevision}`,
    unsafeReasons: [reason],
    diagnostics: [reason],
  };
}

function failedProviderWriteActivityRead(): ProviderWriteActivityProjection {
  return {
    status: 'failed',
    data: {
      redacted: true,
      providerPayload: 'activityReadFailed',
    },
  };
}

function failedProviderWriteActivityStatus(
  data: PublicDiagnosticData,
): VersionPendingProviderWritesStatus {
  const reason = diagnostic(
    'version.surfaceStatus.pendingProviderWritesReadFailed',
    'warning',
    'Version provider write activity could not be proven settled. Checkout is disabled conservatively until provider writes can be proven settled.',
    data,
  );
  return {
    pendingProviderWrites: true,
    statusRevision: 'providerActivity:unknown',
    unsafeReasons: [reason],
    diagnostics: [reason],
  };
}

function combinePendingProviderWriteStatuses(
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

function projectProviderWriteActivitySnapshot(value: unknown): ProviderWriteActivityProjection {
  if (!isRecord(value)) {
    return malformedProviderWriteActivitySnapshot('notObject');
  }
  if (
    !isSafeCount(value.remoteSyncApplyActiveCount) ||
    !isSafeCount(value.pendingRemotePromotionActiveCount) ||
    !isSafeCount(value.pendingRemotePromotionQueuedCount)
  ) {
    return malformedProviderWriteActivitySnapshot('invalidCounts');
  }
  if (
    typeof value.statusRevision !== 'string' ||
    !SAFE_STATUS_REVISION_RE.test(value.statusRevision)
  ) {
    return malformedProviderWriteActivitySnapshot('invalidStatusRevision');
  }
  return {
    status: 'ok',
    activity: {
      remoteSyncApplyActiveCount: value.remoteSyncApplyActiveCount,
      pendingRemotePromotionActiveCount: value.pendingRemotePromotionActiveCount,
      pendingRemotePromotionQueuedCount: value.pendingRemotePromotionQueuedCount,
      statusRevision: value.statusRevision,
    },
  };
}

function malformedProviderWriteActivitySnapshot(reason: string): ProviderWriteActivityProjection {
  return {
    status: 'failed',
    data: {
      redacted: true,
      providerPayload: 'activitySnapshot',
      payloadIssue: reason,
    },
  };
}

function projectRegistryReadResult(value: unknown): RegistryProjection {
  if (!isRecord(value)) {
    return malformedRegistryReadResult('notObject');
  }
  const diagnosticData = providerDiagnosticsData(value.diagnostics);
  if (!Array.isArray(value.diagnostics)) {
    return malformedRegistryReadResult('invalidDiagnostics');
  }
  if (value.status === 'absent') {
    if (value.registry !== null) {
      return malformedRegistryReadResult('absentWithRegistry', diagnosticData);
    }
    return { status: 'absent' };
  }
  if (value.status !== 'ok') {
    return {
      status: 'failed',
      message: 'Version provider could not read the visible graph registry for checkout preflight.',
      data: diagnosticData,
    };
  }
  if (!isVersionGraphRegistry(value.registry)) {
    return malformedRegistryReadResult('invalidRegistry', diagnosticData);
  }
  try {
    namespaceForRegistry(value.registry);
    versionDocumentScopeKey(documentScopeForRegistry(value.registry));
  } catch {
    return malformedRegistryReadResult('invalidRegistryScope', diagnosticData);
  }
  return { status: 'ok', registry: value.registry };
}

function malformedRegistryReadResult(
  payloadIssue: string,
  data: PublicDiagnosticData = { redacted: true },
): RegistryProjection {
  return {
    status: 'failed',
    message:
      'Version provider returned malformed graph registry evidence for checkout preflight.',
    data: {
      ...data,
      redacted: true,
      providerPayload: 'graphRegistryRead',
      payloadIssue,
    },
  };
}

async function projectPendingRemoteSegmentListResult(
  value: unknown,
  registry: VersionGraphRegistry,
): Promise<
  | {
      readonly status: 'success';
      readonly records: readonly PendingRemoteSegmentRecord[];
    }
  | {
      readonly status: 'failed';
      readonly message: string;
      readonly data: PublicDiagnosticData;
    }
> {
  if (!isRecord(value)) {
    return malformedPendingRemoteSegmentListResult('notObject');
  }
  const diagnosticData = providerDiagnosticsData(value.diagnostics);
  if (!Array.isArray(value.diagnostics)) {
    return malformedPendingRemoteSegmentListResult('invalidDiagnostics');
  }
  if (value.status !== 'success') {
    return {
      status: 'failed',
      message: 'Pending remote segments could not be listed for checkout preflight.',
      data: diagnosticData,
    };
  }
  if (value.diagnostics.length !== 0) {
    return malformedPendingRemoteSegmentListResult('successWithDiagnostics', diagnosticData);
  }
  if (!Array.isArray(value.records)) {
    return malformedPendingRemoteSegmentListResult('missingRecords', diagnosticData);
  }

  const namespaceKey = versionGraphNamespaceKey(namespaceForRegistry(registry));
  const documentScopeKey = versionDocumentScopeKey(documentScopeForRegistry(registry));
  const records: PendingRemoteSegmentRecord[] = [];
  for (const [index, record] of value.records.entries()) {
    if (!isPendingRemoteSegmentRecord(record)) {
      return malformedPendingRemoteSegmentListResult('invalidRecord', {
        ...diagnosticData,
        recordIndex: index,
      });
    }
    if (record.namespaceKey !== namespaceKey || record.documentScopeKey !== documentScopeKey) {
      return malformedPendingRemoteSegmentListResult('wrongScopeRecord', {
        ...diagnosticData,
        recordIndex: index,
      });
    }
    if (!(await hasFreshPendingRemoteSegmentIdentity(record))) {
      return malformedPendingRemoteSegmentListResult('staleWriteIdentifier', {
        ...diagnosticData,
        recordIndex: index,
      });
    }
    records.push(record);
  }
  return { status: 'success', records };
}

function malformedPendingRemoteSegmentListResult(
  payloadIssue: string,
  data: PublicDiagnosticData = { redacted: true },
): {
  readonly status: 'failed';
  readonly message: string;
  readonly data: PublicDiagnosticData;
} {
  return {
    status: 'failed',
    message: 'Pending remote segment provider returned malformed checkout preflight evidence.',
    data: {
      ...data,
      redacted: true,
      providerPayload: 'pendingRemoteSegmentList',
      payloadIssue,
    },
  };
}

async function hasFreshPendingRemoteSegmentIdentity(
  record: PendingRemoteSegmentRecord,
): Promise<boolean> {
  try {
    const keyMaterial = await pendingRemoteSegmentKeyMaterialForOperationContext(
      record.operationContext,
    );
    return (
      record.pendingRemoteSegmentId === keyMaterial.pendingRemoteSegmentId &&
      record.idempotencyKey === keyMaterial.idempotencyKey &&
      pendingRemoteSyncIdentityEquals(record.syncIdentity, keyMaterial.syncIdentity)
    );
  } catch {
    return false;
  }
}

function pendingRemoteSyncIdentityEquals(
  left: PendingRemoteSegmentRecord['syncIdentity'],
  right: PendingRemoteSegmentRecord['syncIdentity'],
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.sourceKind === right.sourceKind &&
    left.originKind === right.originKind &&
    left.stableOriginId === right.stableOriginId &&
    left.providerId === right.providerId &&
    left.authorityRef === right.authorityRef &&
    left.roomId === right.roomId &&
    left.epoch === right.epoch &&
    left.updateId === right.updateId &&
    left.sequence === right.sequence &&
    left.payloadHash === right.payloadHash
  );
}

function getAttachedVersionStoreProvider(ctx: DocumentContext): VersionStoreProvider | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;

  for (const candidate of [services.provider, services.storageProvider, services]) {
    if (isVersionStoreProvider(candidate)) return candidate;
  }
  return null;
}

function isVersionStoreProvider(value: unknown): value is VersionStoreProvider {
  return (
    isRecord(value) &&
    typeof value.readGraphRegistry === 'function' &&
    typeof value.openGraph === 'function'
  );
}

function noPendingProviderWrites(statusRevision: string): VersionPendingProviderWritesStatus {
  return {
    pendingProviderWrites: false,
    statusRevision,
    unsafeReasons: [],
    diagnostics: [],
  };
}

function failedPendingProviderWritesRead(
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

function providerDiagnosticsData(diagnostics: unknown): PublicDiagnosticData {
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

function diagnostic(
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

function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isVersionGraphRegistry(value: unknown): value is VersionGraphRegistry {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (
    !optionalVersionStoreString(value.workspaceId) ||
    !isVersionStoreString(value.documentId) ||
    !optionalVersionStoreString(value.principalScope) ||
    !isVersionStoreString(value.currentGraphId) ||
    value.headRefName !== 'refs/heads/main' ||
    typeof value.rootCommitId !== 'string' ||
    !WORKBOOK_COMMIT_ID_RE.test(value.rootCommitId) ||
    !isRecord(value.registryRevision) ||
    value.registryRevision.kind !== 'counter' ||
    typeof value.registryRevision.value !== 'string' ||
    !isRecord(value.registryChecksum) ||
    value.registryChecksum.algorithm !== 'sha256' ||
    typeof value.registryChecksum.digest !== 'string' ||
    !OBJECT_DIGEST_RE.test(value.registryChecksum.digest) ||
    typeof value.createdAt !== 'string'
  ) {
    return false;
  }
  return true;
}

function documentScopeForRegistry(registry: VersionGraphRegistry) {
  return {
    ...(registry.workspaceId === undefined ? {} : { workspaceId: registry.workspaceId }),
    documentId: registry.documentId,
    ...(registry.principalScope === undefined
      ? {}
      : { principalScope: registry.principalScope }),
  };
}

function isVersionStoreString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && utf8Length(value) <= 256;
}

function optionalVersionStoreString(value: unknown): boolean {
  return value === undefined || isVersionStoreString(value);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value.normalize('NFC')).byteLength;
}

function isPublicDiagnosticDataValue(
  value: unknown,
): value is string | number | boolean | null {
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
