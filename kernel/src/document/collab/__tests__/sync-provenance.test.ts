import { buildSidecarRawSyncProvenance } from '../sync-provenance';

describe('sidecar raw sync provenance', () => {
  it('classifies join and resume state as excluded collaboration hydration', () => {
    const provenance = buildSidecarRawSyncProvenance('room-1', 'a'.repeat(64), 'hydration');

    expect(provenance).toMatchObject({
      schemaVersion: 'sync-update-provenance-v1',
      sourceKind: 'collaborationHydration',
      updateIdentity: {
        originKind: 'room',
        roomId: 'room-1',
        updateId: `ws-sidecar-hydration:${'a'.repeat(64)}`,
        payloadHash: 'a'.repeat(64),
      },
      trust: { status: 'trustedLocalSystem' },
      author: { kind: 'system', systemRef: 'collaboration-hydration' },
      replay: true,
      system: true,
      capturePolicy: 'excluded',
      exclusionDiagnostic: { reason: 'hydration' },
    });
  });

  it('classifies pull and push response diffs as aggregate mixed remote', () => {
    const provenance = buildSidecarRawSyncProvenance('room-2', 'b'.repeat(64), 'mixedRemote');

    expect(provenance).toMatchObject({
      schemaVersion: 'sync-update-provenance-v1',
      sourceKind: 'collaborationMixedRemote',
      updateIdentity: {
        originKind: 'room',
        roomId: 'room-2',
        updateId: `ws-sidecar-mixedRemote:${'b'.repeat(64)}`,
        payloadHash: 'b'.repeat(64),
      },
      trust: { status: 'unverified' },
      author: { kind: 'mixedRemote', reason: 'aggregateWithoutBoundaries' },
      replay: false,
      system: false,
      capturePolicy: 'excluded',
      exclusionDiagnostic: { reason: 'mixedAuthors' },
    });
  });
});
