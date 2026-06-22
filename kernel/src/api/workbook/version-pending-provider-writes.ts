import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { hasPendingRemoteSegmentStoreProvider } from '../../document/version-store/pending-remote-segment-store';
import type {
  VersionGraphRegistryReadResult,
  VersionStoreProvider,
} from '../../document/version-store/provider';
import { namespaceForRegistry } from '../../document/version-store/registry';

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
