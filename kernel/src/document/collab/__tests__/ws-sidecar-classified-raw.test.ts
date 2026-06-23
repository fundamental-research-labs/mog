import { jest } from '@jest/globals';
import { createHash, webcrypto } from 'node:crypto';
import { createDocumentByteSyncPort } from '../../../api/document/document-sync-port';
import type { AdmittedSyncApplyContext } from '../../../bridges/compute/sync-apply-admission';
import type { SyncUpdateAdmissionMetadata } from '../../providers/provider';
import { applySidecarClassifiedRawSyncUpdate } from '../ws-sidecar';
import { MSG, classifySyncUpdateWireSource } from '../wire-codec';

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

describe('WsSidecar classified raw sync admission', () => {
  it('applies JOIN/RESUME hydration through the document classified raw port', async () => {
    const fixture = createSyncPortFixture();
    const update = new Uint8Array([1, 2, 3]);
    const payloadHash = sha256Hex(update);

    await applySidecarClassifiedRawSyncUpdate({
      syncPort: fixture.port,
      roomId: 'room-hydration',
      update,
      classification: classifySyncUpdateWireSource(MSG.JOIN_RESPONSE),
    });

    expect(fixture.bridge.syncApply).toHaveBeenCalledWith(update, expect.any(Object));
    expect(fixture.admissions).toHaveLength(1);
    expect(fixture.admissions[0]).toMatchObject({
      source: 'document-sync-port',
      envelopeVersion: 'classified-raw',
      updateId: `ws-sidecar-joinResponseHydration:${payloadHash}`,
      payloadHash,
      validationDiagnostics: [],
      provenance: expect.objectContaining({
        sourceKind: 'collaborationHydration',
        replay: true,
        system: true,
        capturePolicy: 'excluded',
        author: { kind: 'system', systemRef: 'collaboration-hydration' },
        exclusionDiagnostic: expect.objectContaining({ reason: 'hydration' }),
      }),
    });
    expect(fixture.contexts[0]?.operationContext).toMatchObject({
      kind: 'sync-import',
      author: {
        authorId: 'sync:collaboration-hydration',
        actorKind: 'system',
      },
      capturePolicy: 'excluded',
      writeAdmissionMode: 'captureDisabledNoHistory',
      collaboration: {
        sourceKind: 'collaborationHydration',
        originKind: 'room',
        roomId: 'room-hydration',
        updateId: `ws-sidecar-joinResponseHydration:${payloadHash}`,
        payloadHash,
        trustStatus: 'trustedLocalSystem',
        authorState: 'system',
        replay: true,
        system: true,
        commitGrouping: 'excludedLifecycle',
        validationDiagnosticCount: 0,
        exclusionReason: 'hydration',
      },
    });
  });

  it('applies aggregate live diffs as mixed remote with truthful exclusion diagnostics', async () => {
    const fixture = createSyncPortFixture();
    const update = new Uint8Array([4, 5, 6]);
    const payloadHash = sha256Hex(update);

    await applySidecarClassifiedRawSyncUpdate({
      syncPort: fixture.port,
      roomId: 'room-mixed',
      update,
      classification: classifySyncUpdateWireSource(MSG.PULL_RESPONSE),
    });

    expect(fixture.bridge.syncApply).toHaveBeenCalledWith(update, expect.any(Object));
    expect(fixture.admissions[0]).toMatchObject({
      envelopeVersion: 'classified-raw',
      updateId: `ws-sidecar-pullResponseMixedRemote:${payloadHash}`,
      payloadHash,
      validationDiagnostics: [],
      provenance: expect.objectContaining({
        sourceKind: 'collaborationMixedRemote',
        trust: { status: 'unverified' },
        author: { kind: 'mixedRemote', reason: 'aggregateWithoutBoundaries' },
        replay: false,
        system: false,
        capturePolicy: 'excluded',
        exclusionDiagnostic: {
          reason: 'mixedAuthors',
          message: 'Collaboration PULL_RESPONSE diff lacks per-update provenance boundaries.',
        },
      }),
    });
    expect(fixture.contexts[0]?.operationContext).toMatchObject({
      author: {
        authorId: 'sync:mixed-remote',
        actorKind: 'system',
      },
      capturePolicy: 'excluded',
      writeAdmissionMode: 'captureDisabledNoHistory',
      collaboration: {
        sourceKind: 'collaborationMixedRemote',
        originKind: 'room',
        roomId: 'room-mixed',
        updateId: `ws-sidecar-pullResponseMixedRemote:${payloadHash}`,
        payloadHash,
        trustStatus: 'unverified',
        authorState: 'mixedRemote',
        replay: false,
        system: false,
        commitGrouping: 'excludedLifecycle',
        validationDiagnosticCount: 0,
        exclusionReason: 'mixedAuthors',
      },
    });
    expect(fixture.contexts[0]?.operationContext.collaboration ?? {}).not.toHaveProperty(
      'remoteSessionId',
    );
  });
});

function createSyncPortFixture() {
  const admissions: SyncUpdateAdmissionMetadata[] = [];
  const contexts: AdmittedSyncApplyContext[] = [];
  const bridge = {
    recordProviderDocApplyUpdateAdmission: jest.fn((metadata: SyncUpdateAdmissionMetadata) => {
      admissions.push(metadata);
    }),
    syncApply: jest.fn(async (_update: Uint8Array, context: AdmittedSyncApplyContext) => {
      contexts.push(context);
      return undefined;
    }),
    encodeDiff: jest.fn(async () => new Uint8Array()),
    currentStateVector: jest.fn(async () => new Uint8Array()),
  };
  const port = createDocumentByteSyncPort({
    documentId: 'doc-sidecar-classified-raw',
    getComputeBridge: () => bridge,
    assertNotDisposed: () => undefined,
  });
  return { admissions, bridge, contexts, port };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
