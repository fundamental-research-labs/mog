import { createHash, webcrypto } from 'node:crypto';
import type { DocumentByteSyncPort } from '../src/boot';
import { _applyCoordinatorRawUpdate } from '../src/collaborative-engine';
import type { DocumentByteSyncPortClassifiedRawProvenance } from '../src/document-sync-port-types';

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
let installedCrypto = false;

beforeAll(() => {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
    installedCrypto = true;
  }
});

afterAll(() => {
  if (originalCryptoDescriptor) {
    Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
  } else if (installedCrypto) {
    delete (globalThis as { crypto?: Crypto }).crypto;
  }
});

describe('collaborative engine classified raw coordinator updates', () => {
  it('prefers classified raw provenance for coordinator diffs', async () => {
    const update = new Uint8Array([1, 2, 3]);
    const classifiedCalls: Array<
      readonly [Uint8Array, DocumentByteSyncPortClassifiedRawProvenance]
    > = [];
    const rawUpdates: Uint8Array[] = [];
    const syncPort = createSyncPort({
      applyUpdate: async (rawUpdate) => {
        rawUpdates.push(rawUpdate);
      },
      applyClassifiedRawUpdate: async (classifiedUpdate, provenance) => {
        classifiedCalls.push([classifiedUpdate, provenance]);
      },
    });

    await _applyCoordinatorRawUpdate(syncPort, update, 'hydration');

    expect(rawUpdates).toEqual([]);
    expect(classifiedCalls).toHaveLength(1);
    expect(classifiedCalls[0]?.[0]).toBe(update);
    expect(classifiedCalls[0]?.[1]).toMatchObject({
      schemaVersion: 'sync-update-provenance-v1',
      sourceKind: 'collaborationHydration',
      trust: { status: 'trustedLocalSystem' },
      author: { kind: 'system', systemRef: 'collaboration-hydration' },
      replay: true,
      system: true,
      capturePolicy: 'excluded',
      redaction: {
        durableAuthorIdentity: 'unknown',
        durableProviderIdentity: 'unknown',
        proofMaterial: 'diagnostics-only',
      },
      exclusionDiagnostic: { reason: 'hydration' },
    });
    expect(classifiedCalls[0]?.[1].updateIdentity).toEqual({
      originKind: 'room',
      updateId: `sdk-coordinator-hydration:${sha256Hex(update)}`,
      payloadHash: sha256Hex(update),
    });

    classifiedCalls.length = 0;
    await _applyCoordinatorRawUpdate(syncPort, update, 'mixedRemote');

    expect(rawUpdates).toEqual([]);
    expect(classifiedCalls).toHaveLength(1);
    expect(classifiedCalls[0]?.[1]).toMatchObject({
      sourceKind: 'collaborationMixedRemote',
      trust: { status: 'unverified' },
      author: { kind: 'mixedRemote', reason: 'aggregateWithoutBoundaries' },
      replay: false,
      system: false,
      capturePolicy: 'excluded',
      exclusionDiagnostic: {
        reason: 'mixedAuthors',
        message: 'Aggregate coordinator diff lacks per-update provenance boundaries.',
      },
    });
  });

  it('falls back to raw applyUpdate when classified raw is unavailable', async () => {
    const update = new Uint8Array([4, 5, 6]);
    const rawUpdates: Uint8Array[] = [];
    const syncPort = createSyncPort({
      applyUpdate: async (rawUpdate) => {
        rawUpdates.push(rawUpdate);
      },
    });

    await _applyCoordinatorRawUpdate(syncPort, update, 'mixedRemote');

    expect(rawUpdates).toEqual([update]);
  });

  it('allows raw applyUpdate fallback to return ignored sync metadata', async () => {
    const update = new Uint8Array([7, 8, 9]);
    const rawUpdates: Uint8Array[] = [];
    const syncPort = createSyncPort({
      applyUpdate: async (rawUpdate) => {
        rawUpdates.push(rawUpdate);
        return {
          mutationResult: { applied: true },
          metadata: { provenanceReport: { status: 'notEvaluated' } },
        };
      },
    });

    await _applyCoordinatorRawUpdate(syncPort, update, 'mixedRemote');

    expect(rawUpdates).toEqual([update]);
  });
});

function createSyncPort(
  overrides: Pick<DocumentByteSyncPort, 'applyUpdate'> &
    Partial<Pick<DocumentByteSyncPort, 'applyClassifiedRawUpdate'>>,
): DocumentByteSyncPort {
  return {
    docId: 'collaborative-engine-classified-raw-test',
    encodeDiff: async () => new Uint8Array(),
    currentStateVector: async () => new Uint8Array(),
    ...overrides,
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
