import { validatePendingRemoteProviderAuthority } from '../pending-remote-authority-gate';
import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  type PendingRemoteSegmentOperationContext,
  type PendingRemoteSegmentRecord,
} from '../pending-remote-segment-store';
import type { ObjectDigest } from '../object-digest';

const AUTHOR: PendingRemoteSegmentOperationContext['author'] = {
  authorId: 'subject-ref-1',
  actorKind: 'user',
  sessionId: 'remote-session-1',
};

describe('validatePendingRemoteProviderAuthority', () => {
  it('accepts a verified live single-author provider record with matching reserved identity', async () => {
    const record = await pendingRemoteRecord();

    expect(validatePendingRemoteProviderAuthority(record)).toEqual({ status: 'ok' });
  });

  it('blocks provider identity mismatches as structured stale authority diagnostics', async () => {
    const record = await pendingRemoteRecord({
      syncIdentity: { providerId: 'provider-rotated' },
    });

    expect(validatePendingRemoteProviderAuthority(record)).toMatchObject({
      status: 'blocked',
      reason: 'provider-authority-stale',
      details: {
        gate: 'provider-identity',
        field: 'providerId',
        reservedPresent: true,
        collaborationPresent: true,
      },
    });
  });

  it('blocks replay high-water mismatches with field-level diagnostics', async () => {
    const record = await pendingRemoteRecord({
      syncIdentity: { updateId: 'remote-update-previous' },
    });

    expect(validatePendingRemoteProviderAuthority(record)).toMatchObject({
      status: 'blocked',
      reason: 'provider-authority-stale',
      details: {
        gate: 'replay-high-water',
        field: 'updateId',
        reservedPresent: true,
        collaborationPresent: true,
      },
    });
  });

  it.each([
    [
      'replayed provider bytes',
      { replay: true },
      { field: 'replay', expected: false, actual: true, sourceKind: 'providerLiveInbound' },
    ],
    [
      'provider replay source',
      { sourceKind: 'providerReplay' },
      { field: 'sourceKind', expected: 'providerLiveInbound', actual: 'providerReplay' },
    ],
  ] as const)(
    'blocks %s as replay high-water authority',
    async (_label, collaboration, details) => {
      const record = await pendingRemoteRecord({ collaboration });

      expect(validatePendingRemoteProviderAuthority(record)).toMatchObject({
        status: 'blocked',
        reason: 'provider-authority-stale',
        details: {
          gate: 'replay-high-water',
          ...details,
        },
      });
    },
  );

  it('blocks author-session mismatches as structured stale authority diagnostics', async () => {
    const record = await pendingRemoteRecord({
      author: { ...AUTHOR, sessionId: 'remote-session-rotated' },
    });

    expect(validatePendingRemoteProviderAuthority(record)).toMatchObject({
      status: 'blocked',
      reason: 'provider-authority-stale',
      details: {
        gate: 'author-identity',
        field: 'remoteSessionId',
        authorPresent: true,
        collaborationPresent: true,
      },
    });
  });

  it('blocks mixed-author pending remote promotion as structured unknown authority', async () => {
    const record = await pendingRemoteRecord({
      author: {
        authorId: 'sync:mixed-remote',
        actorKind: 'system',
      },
      collaboration: {
        sourceKind: 'providerMixedInbound',
        authorState: 'mixedRemote',
        exclusionReason: 'mixedAuthors',
        exclusionSubreason: 'aggregateWithoutBoundaries',
      },
    });

    expect(validatePendingRemoteProviderAuthority(record)).toMatchObject({
      status: 'blocked',
      reason: 'provider-authority-unknown',
      details: {
        gate: 'author-identity',
        field: 'authorState',
        expected: 'singleRemote',
        actual: 'mixedRemote',
        exclusionReason: 'mixedAuthors',
        exclusionSubreason: 'aggregateWithoutBoundaries',
      },
    });
  });
});

async function pendingRemoteRecord(
  options: {
    readonly author?: PendingRemoteSegmentOperationContext['author'];
    readonly collaboration?: Partial<PendingRemoteSegmentOperationContext['collaboration']>;
    readonly syncIdentity?: Partial<PendingRemoteSegmentRecord['syncIdentity']>;
  } = {},
): Promise<PendingRemoteSegmentRecord> {
  const operationContext = pendingRemoteOperationContext(options);
  const keyMaterial = await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext);
  return {
    schemaVersion: 1,
    recordKind: 'pendingRemoteSegment',
    pendingRemoteSegmentId: keyMaterial.pendingRemoteSegmentId,
    idempotencyKey: keyMaterial.idempotencyKey,
    namespaceKey: 'workspace-1:document-1:principal-1:graph-1',
    documentScopeKey: 'workspace-1:document-1:principal-1',
    syncIdentity: {
      ...keyMaterial.syncIdentity,
      ...options.syncIdentity,
    },
    operationContext,
    mutationSegmentDigest: digest('1'),
    snapshotRootDigest: digest('2'),
    semanticChangeSetDigest: digest('3'),
    state: 'pending',
    createdAt: operationContext.createdAt,
    updatedAt: operationContext.createdAt,
  };
}

function pendingRemoteOperationContext(
  options: {
    readonly author?: PendingRemoteSegmentOperationContext['author'];
    readonly collaboration?: Partial<PendingRemoteSegmentOperationContext['collaboration']>;
  } = {},
): PendingRemoteSegmentOperationContext {
  return {
    operationId: 'sync:providerLiveInbound:remote-update-1',
    kind: 'sync-import',
    author: options.author ?? AUTHOR,
    createdAt: '2026-06-21T00:00:01.000Z',
    workbookId: 'document-1',
    domainIds: ['runtime-diagnostics'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    collaboration: {
      sourceKind: 'providerLiveInbound',
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-1',
      authorityRef: 'authority-1',
      roomId: 'room-1',
      epoch: 'epoch-1',
      updateId: 'remote-update-1',
      sequence: '7',
      payloadHash: '4'.repeat(64),
      trustStatus: 'verified',
      authorState: 'singleRemote',
      remoteSessionId: 'remote-session-1',
      replay: false,
      system: false,
      commitGrouping: 'pendingRemote',
      validationDiagnosticCount: 0,
      ...options.collaboration,
    },
  };
}

function digest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}
