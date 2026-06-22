import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { hasPendingRemoteSegmentStoreProvider } from '../../document/version-store/pending-remote-segment-store';
import type {
  VersionGraphRegistryReadResult,
  VersionStoreProvider,
} from '../../document/version-store/provider';
import { namespaceForRegistry } from '../../document/version-store/registry';
import {
  isVersionProviderWriteActivityTracker,
  type VersionProviderWriteActivitySnapshot,
} from '../../document/version-store/provider-write-activity';

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
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
  if (!activity || !hasProviderWriteActivity(activity)) return persisted;
  return combinePendingProviderWriteStatuses(
    activeProviderWriteActivityStatus(activity),
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

  if (registry.status === 'absent') {
    return noPendingProviderWrites('pendingRemote:absentGraph');
  }

  if (registry.status !== 'ok') {
    return failedPendingProviderWritesRead(
      'Version provider could not read the visible graph registry for checkout preflight.',
    );
  }

  try {
    const store = await provider.openPendingRemoteSegmentStore(
      namespaceForRegistry(registry.registry),
    );
    const listed = await store.listByState('pending');
    if (listed.status !== 'success') {
      return failedPendingProviderWritesRead(
        'Pending remote segments could not be listed for checkout preflight.',
      );
    }

    if (listed.records.length === 0) {
      return noPendingProviderWrites('pendingRemote:0');
    }

    const reason = diagnostic(
      'version.surfaceStatus.pendingProviderWrites',
      'warning',
      'Remote sync changes are waiting to be promoted into version history; checkout is unsafe.',
      {
        pendingRemoteSegmentCount: listed.records.length,
      },
    );
    return {
      pendingProviderWrites: true,
      statusRevision: `pendingRemote:${listed.records.length}`,
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
): VersionProviderWriteActivitySnapshot | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;
  for (const candidate of [
    services.providerWriteActivityTracker,
    services.versionProviderWriteActivityTracker,
    services.providerWriteActivity,
    services.versionProviderWriteActivity,
    services,
  ]) {
    if (!isVersionProviderWriteActivityTracker(candidate)) continue;
    try {
      return candidate.readActivity();
    } catch {
      return failedProviderWriteActivitySnapshot();
    }
  }
  return null;
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

function failedProviderWriteActivitySnapshot(): VersionProviderWriteActivitySnapshot {
  return {
    remoteSyncApplyActiveCount: 1,
    pendingRemotePromotionActiveCount: 0,
    pendingRemotePromotionQueuedCount: 0,
    statusRevision: 'readFailed',
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

function failedPendingProviderWritesRead(message: string): VersionPendingProviderWritesStatus {
  const reason = diagnostic(
    'version.surfaceStatus.pendingProviderWritesReadFailed',
    'warning',
    `${message} Checkout is disabled conservatively until provider writes can be proven settled.`,
  );
  return {
    pendingProviderWrites: true,
    statusRevision: 'pendingRemote:unknown',
    unsafeReasons: [reason],
    diagnostics: [reason],
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

function diagnostic(
  code: VersionDiagnostic['code'],
  severity: VersionDiagnostic['severity'],
  message: string,
  data: VersionDiagnostic['data'] = {},
): VersionDiagnostic {
  return {
    code,
    severity,
    message,
    dependency: 'VC-09',
    ...(Object.keys(data).length > 0 ? { data } : {}),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
