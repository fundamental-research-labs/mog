import { DEFAULT_PROVENANCE_REDACTION_POLICY } from '@mog-sdk/types-document/storage';
import type { SyncUpdateProvenance } from '@mog-sdk/types-document/storage';
import { buildSidecarRawSyncProvenance } from '../sync-provenance';
import type { SidecarRawSyncClassification } from '../sync-provenance';
import { MSG, classifySyncUpdateWireSource } from '../wire-codec';

describe('sidecar raw sync provenance', () => {
  it.each([
    [MSG.JOIN_RESPONSE, 'JOIN_RESPONSE', 'joinResponseHydration'],
    [MSG.RESUME_RESPONSE, 'RESUME_RESPONSE', 'resumeResponseHydration'],
  ])(
    'classifies %s state as excluded collaboration hydration',
    (messageType, messageName, kind) => {
      const payloadHash = 'a'.repeat(64);
      const provenance = buildSidecarRawSyncProvenance(
        'room-1',
        payloadHash,
        classifySyncUpdateWireSource(messageType),
      );

      expect(provenance).toMatchObject({
        schemaVersion: 'sync-update-provenance-v1',
        sourceKind: 'collaborationHydration',
        updateIdentity: {
          originKind: 'room',
          roomId: 'room-1',
          updateId: `ws-sidecar-${kind}:${payloadHash}`,
          payloadHash,
        },
        trust: { status: 'trustedLocalSystem' },
        author: { kind: 'system', systemRef: 'collaboration-hydration' },
        replay: true,
        system: true,
        capturePolicy: 'excluded',
        exclusionDiagnostic: {
          reason: 'hydration',
          message: `Collaboration ${messageName} update bytes are classified as hydration.`,
        },
      });
    },
  );

  it.each([
    [MSG.PULL_RESPONSE, 'PULL_RESPONSE', 'pullResponseMixedRemote'],
    [MSG.PUSH_RESPONSE, 'PUSH_RESPONSE', 'pushResponseMixedRemote'],
  ])('classifies %s diffs as aggregate mixed remote', (messageType, messageName, kind) => {
    const payloadHash = 'b'.repeat(64);
    const provenance = buildSidecarRawSyncProvenance(
      'room-2',
      payloadHash,
      classifySyncUpdateWireSource(messageType),
    );

    expect(provenance).toMatchObject({
      schemaVersion: 'sync-update-provenance-v1',
      sourceKind: 'collaborationMixedRemote',
      updateIdentity: {
        originKind: 'room',
        roomId: 'room-2',
        updateId: `ws-sidecar-${kind}:${payloadHash}`,
        payloadHash,
      },
      trust: { status: 'unverified' },
      author: { kind: 'mixedRemote', reason: 'aggregateWithoutBoundaries' },
      replay: false,
      system: false,
      capturePolicy: 'excluded',
      exclusionDiagnostic: {
        reason: 'mixedAuthors',
        message: `Collaboration ${messageName} diff lacks per-update provenance boundaries.`,
      },
    });
  });

  it('falls back to legacy raw unknown when a raw sync frame has no classifier', () => {
    const payloadHash = 'c'.repeat(64);
    const provenance = buildSidecarRawSyncProvenance(
      'room-3',
      payloadHash,
      classifySyncUpdateWireSource(0x7f),
    );

    expect(provenance).toMatchObject({
      schemaVersion: 'sync-update-provenance-v1',
      sourceKind: 'legacyRawUnknown',
      updateIdentity: {
        originKind: 'legacyRaw',
        roomId: 'room-3',
        updateId: `ws-sidecar-legacyRawFallback:${payloadHash}`,
        payloadHash,
      },
      trust: { status: 'legacyRaw' },
      author: { kind: 'unknown', reason: 'legacyRaw' },
      replay: false,
      system: false,
      capturePolicy: 'excluded',
      exclusionDiagnostic: {
        reason: 'legacyRawUnknown',
        subreason: 'rawUnclassified',
        message:
          'Collaboration UNKNOWN_0x7f update bytes reached ws-sidecar without an explicit provenance classifier; admitted as legacy raw unknown.',
      },
    });
  });

  it.each(['hydration', 'mixedRemote'] as const)(
    'classifies V1 raw compatibility %s as legacy raw unknown',
    (classification) => {
      const payloadHash = 'd'.repeat(64);
      const provenance = buildSidecarRawSyncProvenance('room-4', payloadHash, classification);

      expect(provenance).toMatchObject({
        schemaVersion: 'sync-update-provenance-v1',
        sourceKind: 'legacyRawUnknown',
        updateIdentity: {
          originKind: 'legacyRaw',
          roomId: 'room-4',
          updateId: `ws-sidecar-v1RawCompatibility-${classification}:${payloadHash}`,
          payloadHash,
        },
        trust: { status: 'legacyRaw' },
        author: { kind: 'unknown', reason: 'legacyRaw' },
        replay: false,
        system: false,
        capturePolicy: 'excluded',
        exclusionDiagnostic: {
          reason: 'legacyRawUnknown',
          subreason: 'rawUnclassified',
          message: `Collaboration V1 raw ${classification} compatibility bytes do not carry VC-09 provenance; admitted as legacy raw unknown.`,
        },
      });
    },
  );

  it('projects V2 provenance source trust and author state without raw provider IDs', () => {
    const payloadHash = 'e'.repeat(64);
    const v2Provenance = makeProviderMixedV2Provenance(payloadHash);
    const classification = {
      schemaVersion: 'provider-inbound-update-v2',
      provenance: v2Provenance,
    } satisfies SidecarRawSyncClassification;

    const projected = buildSidecarRawSyncProvenance('room-v2', payloadHash, classification);

    expect(projected).toMatchObject({
      schemaVersion: 'sync-update-provenance-v1',
      sourceKind: 'providerMixedInbound',
      trust: v2Provenance.trust,
      author: v2Provenance.author,
      replay: false,
      system: false,
      capturePolicy: 'excluded',
      redaction: v2Provenance.redaction,
      exclusionDiagnostic: v2Provenance.exclusionDiagnostic,
      updateIdentity: {
        originKind: 'provider',
        stableOriginId: 'opaque-provider-ref:provider-1',
        providerKind: 'test-provider',
        roomId: 'room-v2',
        epoch: 'epoch-1',
        updateId: 'v2-remote-update-1',
        sequence: 7n,
        payloadHash,
        provenancePayloadHash: 'f'.repeat(64),
      },
    });
    expect(projected.updateIdentity).not.toHaveProperty('providerId');
    expect(projected.updateIdentity).not.toHaveProperty('providerRefId');
    expect(projected.updateIdentity).not.toHaveProperty('storageScope');
    expect(projected.updateIdentity).not.toHaveProperty('authorityRef');
  });
});

function makeProviderMixedV2Provenance(payloadHash: string): SyncUpdateProvenance {
  return {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: 'providerMixedInbound',
    updateIdentity: {
      originKind: 'provider',
      stableOriginId: 'opaque-provider-ref:provider-1',
      providerId: 'raw-provider-id-1',
      providerKind: 'test-provider',
      providerRefId: 'raw-provider-ref-1',
      storageScope: {
        kind: 'scoped',
        scope: {
          tenantId: { kind: 'single-tenant' },
          workspaceId: { kind: 'no-workspace' },
          documentId: 'doc-1',
        },
      },
      authorityRef: 'authority-1',
      epoch: 'epoch-1',
      updateId: 'v2-remote-update-1',
      sequence: 7n,
      payloadHash,
      provenancePayloadHash: 'f'.repeat(64),
    },
    trust: {
      status: 'verified',
      authorityRef: 'authority-1',
      proofKind: 'signed-provider-message',
      proofCoverage: [
        'sourceKind',
        'originKind',
        'stableOriginId',
        'providerId',
        'providerRefId',
        'provenanceRedactionPolicy',
        'payloadHash',
        'updateId',
      ],
      issuer: 'issuer-1',
    },
    author: {
      kind: 'mixedRemote',
      participantCount: 2,
      reason: 'multipleProvenAuthors',
    },
    replay: false,
    system: false,
    capturePolicy: 'excluded',
    redaction: {
      ...DEFAULT_PROVENANCE_REDACTION_POLICY,
      mode: 'opaque-digest-only',
      durableAuthorIdentity: 'opaque-subject-ref',
      durableProviderIdentity: 'opaque-provider-ref',
    },
    exclusionDiagnostic: {
      reason: 'mixedAuthors',
      message: 'Provider V2 aggregate carries multiple proven remote authors.',
    },
  };
}
