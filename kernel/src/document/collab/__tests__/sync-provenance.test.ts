import { buildSidecarRawSyncProvenance } from '../sync-provenance';
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
});
