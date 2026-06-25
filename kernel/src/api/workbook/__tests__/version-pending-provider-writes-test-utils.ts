import { jest } from '@jest/globals';

import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  type PendingRemoteSegmentRecord,
} from '../../../document/version-store/pending-remote-segment-store';
import { versionGraphNamespaceKey } from '../../../document/version-store/object-store';
import {
  namespaceForRegistry,
  versionDocumentScopeKey,
} from '../../../document/version-store/registry';

export const ROOT_COMMIT_ID = `commit:sha256:${'0'.repeat(64)}`;
export const RAW_CURSOR = 'mog-pending-remote-v1.pending.cursor-secret';
export const RAW_BATCH_STATUS_ID = `sync-batch-status:sha256:${'9'.repeat(64)}`;
export const RAW_SEGMENT_ID = `pending-remote-segment:sha256:${'8'.repeat(64)}`;
export const GRAPH_REGISTRY = Object.freeze({
  schemaVersion: 1,
  documentId: 'document-1',
  currentGraphId: 'graph-1',
  headRefName: 'refs/heads/main',
  rootCommitId: ROOT_COMMIT_ID,
  registryRevision: { kind: 'counter', value: '0' },
  registryChecksum: { algorithm: 'sha256', digest: '1'.repeat(64) },
  createdAt: '2026-06-22T00:00:00.000Z',
});

export function createCtx(versioning: Record<string, unknown>) {
  return { versioning } as any;
}

export function cleanSurfaceDirtyStatus(overrides: Record<string, unknown> = {}) {
  return {
    statusRevision: 'dirty-revision-clean',
    checkoutPreflightToken: 'checkout-preflight-token-clean',
    hasUncommittedLocalChanges: false,
    commitEligibleChanges: false,
    unsupportedDirtyDomains: [],
    pendingProviderWrites: false,
    pendingRecalc: false,
    checkoutSafe: true,
    unsafeReasons: [],
    source: 'VC-05' as const,
    diagnostics: [],
    ...overrides,
  };
}

export function createProviderWithPendingListResult(listResult: unknown) {
  const pendingStore = {
    listByState: jest.fn(async () => listResult),
  };
  const provider = {
    readGraphRegistry: jest.fn(async () => ({
      status: 'ok',
      registry: GRAPH_REGISTRY,
      diagnostics: [],
    })),
    openGraph: jest.fn(),
    openPendingRemoteSegmentStore: jest.fn(async () => pendingStore),
  };
  return { provider, pendingStore };
}

export async function pendingRemoteSegmentRecord(): Promise<PendingRemoteSegmentRecord> {
  const operationContext = {
    operationId: 'operation-1',
    kind: 'remoteSyncApply',
    author: { actorKind: 'user', displayName: 'User One', redacted: true },
    createdAt: '2026-06-22T00:00:01.000Z',
    domainIds: [],
    capturePolicy: 'semantic',
    writeAdmissionMode: 'provider',
    collaboration: {
      sourceKind: 'provider',
      originKind: 'remote',
      stableOriginId: 'stable-origin-1',
      providerId: 'provider-1',
      authorityRef: 'authority-1',
      roomId: 'room-1',
      epoch: 'epoch-1',
      updateId: 'update-1',
      sequence: 'sequence-1',
      payloadHash: 'payload-hash-1',
    },
  } as any;
  const keyMaterial = await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext);
  return {
    schemaVersion: 1,
    recordKind: 'pendingRemoteSegment',
    pendingRemoteSegmentId: keyMaterial.pendingRemoteSegmentId,
    idempotencyKey: keyMaterial.idempotencyKey,
    namespaceKey: versionGraphNamespaceKey(namespaceForRegistry(GRAPH_REGISTRY as any)),
    documentScopeKey: versionDocumentScopeKey({ documentId: 'document-1' }),
    syncIdentity: keyMaterial.syncIdentity,
    operationContext,
    mutationSegmentDigest: {
      algorithm: 'sha256',
      digest: '2'.repeat(64),
    },
    state: 'pending',
    createdAt: '2026-06-22T00:00:01.000Z',
    updatedAt: '2026-06-22T00:00:01.000Z',
  };
}
