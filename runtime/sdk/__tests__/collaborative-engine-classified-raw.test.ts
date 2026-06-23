import { createHash, webcrypto } from 'node:crypto';
import type { DocumentByteSyncPort, DocumentByteSyncPortRawProvenance } from '../src/boot';
import { _applyCoordinatorRawUpdate } from '../src/collaborative-engine';
import { createClassifiedDocumentByteSyncPort } from '../src/document-byte-sync-port';

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
    const classifiedCalls: Array<readonly [Uint8Array, DocumentByteSyncPortRawProvenance]> = [];
    const rawUpdates: Uint8Array[] = [];
    const syncPort = createSyncPort({
      applyUpdate: async (rawUpdate) => {
        rawUpdates.push(rawUpdate);
      },
      applyClassifiedRawUpdate: async (classifiedUpdate, provenance) => {
        classifiedCalls.push([classifiedUpdate, provenance]);
      },
    });

    await _applyCoordinatorRawUpdate(syncPort, update, 'bootstrap');

    expect(rawUpdates).toEqual([]);
    expect(classifiedCalls).toHaveLength(1);
    expect(classifiedCalls[0]?.[0]).toBe(update);
    expect(classifiedCalls[0]?.[1]).toMatchObject({
      schemaVersion: 'sync-update-provenance-v1',
      sourceKind: 'collaborationHydration',
      sdkLifecycle: {
        schemaVersion: 'sdk-raw-sync-lifecycle-v1',
        source: 'collaborativeEngineBootstrap',
        capturePolicy: 'excluded',
      },
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
      updateId: `sdk-coordinator-bootstrap:${sha256Hex(update)}`,
      payloadHash: sha256Hex(update),
    });

    const expectedLifecycleSources = {
      flush: 'collaborativeEngineFlush',
      pull: 'collaborativeEnginePull',
      sync: 'collaborativeEngineSync',
    } as const;
    for (const classification of ['flush', 'pull', 'sync'] as const) {
      classifiedCalls.length = 0;
      await _applyCoordinatorRawUpdate(syncPort, update, classification);

      expect(rawUpdates).toEqual([]);
      expect(classifiedCalls).toHaveLength(1);
      expect(classifiedCalls[0]?.[1]).toMatchObject({
        sourceKind: 'collaborationMixedRemote',
        sdkLifecycle: {
          schemaVersion: 'sdk-raw-sync-lifecycle-v1',
          source: expectedLifecycleSources[classification],
          capturePolicy: 'excluded',
        },
        updateIdentity: {
          originKind: 'room',
          updateId: `sdk-coordinator-${classification}:${sha256Hex(update)}`,
          payloadHash: sha256Hex(update),
        },
        trust: { status: 'unverified' },
        author: { kind: 'mixedRemote', reason: 'aggregateWithoutBoundaries' },
        replay: false,
        system: false,
        capturePolicy: 'excluded',
        exclusionDiagnostic: {
          reason: 'mixedAuthors',
          message: `Coordinator ${classification} diff is classified as ${expectedLifecycleSources[classification]} with capturePolicy=excluded because it lacks per-update provenance boundaries.`,
        },
      });
    }
  });

  it('fails closed when classified raw is unavailable', async () => {
    const update = new Uint8Array([4, 5, 6]);
    const rawUpdates: Uint8Array[] = [];
    const syncPort = createSyncPort({
      applyUpdate: async (rawUpdate) => {
        rawUpdates.push(rawUpdate);
      },
    });

    await expect(_applyCoordinatorRawUpdate(syncPort, update, 'pull')).rejects.toThrow(
      'requires DocumentByteSyncPort.applyClassifiedRawUpdate',
    );

    expect(rawUpdates).toEqual([]);
  });

  it('does not accept sync metadata from raw fallback ports', async () => {
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

    await expect(_applyCoordinatorRawUpdate(syncPort, update, 'sync')).rejects.toThrow(
      'requires DocumentByteSyncPort.applyClassifiedRawUpdate',
    );

    expect(rawUpdates).toEqual([]);
  });

  it('fails closed for unknown coordinator lifecycle classifications', async () => {
    const update = new Uint8Array([17, 18, 19]);
    const classifiedCalls: Array<readonly [Uint8Array, DocumentByteSyncPortRawProvenance]> = [];
    const syncPort = createSyncPort({
      applyUpdate: async () => {
        throw new Error('raw apply should not run');
      },
      applyClassifiedRawUpdate: async (classifiedUpdate, provenance) => {
        classifiedCalls.push([classifiedUpdate, provenance]);
      },
    });

    await expect(_applyCoordinatorRawUpdate(syncPort, update, 'unknown' as never)).rejects.toThrow(
      'Unknown CollaborativeEngine coordinator raw update lifecycle: unknown',
    );

    expect(classifiedCalls).toEqual([]);
  });
});

describe('SDK document byte sync port classification wrapper', () => {
  it('classifies legacy applyUpdate bytes as legacyRawUnknown', async () => {
    const update = new Uint8Array([10, 11, 12]);
    const rawUpdates: Uint8Array[] = [];
    const classifiedCalls: Array<readonly [Uint8Array, DocumentByteSyncPortRawProvenance]> = [];
    const syncPort = createClassifiedDocumentByteSyncPort(
      createSyncPort({
        applyUpdate: async (rawUpdate) => {
          rawUpdates.push(rawUpdate);
        },
        applyClassifiedRawUpdate: async (classifiedUpdate, provenance) => {
          classifiedCalls.push([classifiedUpdate, provenance]);
        },
      }),
    );

    await syncPort.applyUpdate(update);

    expect(rawUpdates).toEqual([]);
    expect(classifiedCalls).toHaveLength(1);
    expect(classifiedCalls[0]?.[0]).toBe(update);
    expect(classifiedCalls[0]?.[1]).toMatchObject({
      schemaVersion: 'sync-update-provenance-v1',
      sourceKind: 'legacyRawUnknown',
      sdkLifecycle: {
        schemaVersion: 'sdk-raw-sync-lifecycle-v1',
        source: 'legacyApplyUpdate',
        capturePolicy: 'excluded',
      },
      updateIdentity: {
        originKind: 'legacyRaw',
        updateId: `legacy-raw:${sha256Hex(update)}`,
        payloadHash: sha256Hex(update),
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
          'DocumentByteSyncPort.applyUpdate raw sync bytes are classified as legacyApplyUpdate with capturePolicy=excluded and cannot claim authorship.',
      },
    });
  });

  it('rejects legacy raw fallback for ports without classified admission', async () => {
    const update = new Uint8Array([13, 14, 15]);
    const rawUpdates: Uint8Array[] = [];
    const syncPort = createClassifiedDocumentByteSyncPort(
      createSyncPort({
        applyUpdate: async (rawUpdate) => {
          rawUpdates.push(rawUpdate);
        },
      }),
    );

    await expect(syncPort.applyUpdate(update)).rejects.toThrow('requires applyClassifiedRawUpdate');

    expect(rawUpdates).toEqual([]);
    expect(syncPort.applyClassifiedRawUpdate).toBeUndefined();
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
