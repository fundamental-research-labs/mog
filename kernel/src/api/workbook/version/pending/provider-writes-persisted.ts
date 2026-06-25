import type { DocumentContext } from '../../../../context';
import {
  hasPendingRemoteSegmentStoreProvider,
  isPendingRemoteSegmentRecord,
  pendingRemoteSegmentKeyMaterialForOperationContext,
  type PendingRemoteSegmentRecord,
} from '../../../../document/version-store/pending-remote-segment-store';
import { versionGraphNamespaceKey } from '../../../../document/version-store/object-store';
import type { VersionGraphRegistryReadResult } from '../../../../document/version-store/provider';
import {
  namespaceForRegistry,
  versionDocumentScopeKey,
  type VersionGraphRegistry,
} from '../../../../document/version-store/registry';
import { getAttachedVersionStoreProvider } from './provider-writes-provider';
import { providerDiagnosticsData } from './provider-writes-redaction';
import {
  diagnostic,
  failedPendingProviderWritesRead,
  noPendingProviderWrites,
} from './provider-writes-status';
import type {
  PendingRemoteSegmentListProjection,
  PublicDiagnosticData,
  RegistryProjection,
  VersionPendingProviderWritesStatus,
} from './provider-writes-types';
import { isRecord, utf8Length } from './provider-writes-utils';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const OBJECT_DIGEST_RE = /^[0-9a-f]{64}$/;

export async function readPersistedPendingRemoteProviderWrites(
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
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const listed = await store.listByState('pending');
    const projectedList = await projectPendingRemoteSegmentListResult(listed, registry);
    if (projectedList.status === 'failed') {
      return failedPendingProviderWritesRead(projectedList.message, projectedList.data);
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
    message: 'Version provider returned malformed graph registry evidence for checkout preflight.',
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
): Promise<PendingRemoteSegmentListProjection> {
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
): Extract<PendingRemoteSegmentListProjection, { status: 'failed' }> {
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
    ...(registry.principalScope === undefined ? {} : { principalScope: registry.principalScope }),
  };
}

function isVersionStoreString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && utf8Length(value) <= 256;
}

function optionalVersionStoreString(value: unknown): boolean {
  return value === undefined || isVersionStoreString(value);
}
