import {
  validateProviderInboundUpdateEnvelope,
  validateSyncUpdateProvenance,
  type SyncUpdateProvenance,
} from '@mog-sdk/types-document/storage';
import { slog } from '../../lib/slog';
import type {
  ClassifiedRawSyncUpdateProvenance,
  DocumentByteSyncPort,
  DocumentByteSyncPortApplyUpdateMetadata,
  SyncUpdateAdmissionMetadata,
} from '../../document/providers/provider';

interface DocumentSyncComputeBridge {
  syncApply(update: Uint8Array): Promise<unknown>;
  encodeDiff(remoteStateVector: Uint8Array): Promise<Uint8Array>;
  currentStateVector(): Promise<Uint8Array>;
}

interface CreateDocumentByteSyncPortOptions {
  readonly documentId: string;
  readonly getComputeBridge: () => DocumentSyncComputeBridge;
  readonly assertNotDisposed: (operation: string) => void;
}

export function createDocumentByteSyncPort(
  options: CreateDocumentByteSyncPortOptions,
): DocumentByteSyncPort {
  const { documentId, getComputeBridge, assertNotDisposed } = options;

  return {
    docId: documentId,
    async applyUpdate(update: Uint8Array): Promise<void> {
      assertNotDisposed('syncPort.applyUpdate');
      await getComputeBridge().syncApply(update);
    },
    async applyUpdateWithProvenance(
      update: Uint8Array,
      provenance: SyncUpdateProvenance,
    ): Promise<void> {
      assertNotDisposed('syncPort.applyUpdateWithProvenance');
      const payloadHash = await sha256Hex(
        update,
        'DocumentHandle.syncPort.applyUpdateWithProvenance',
      );
      const validation = validateSyncUpdateProvenance(provenance, {
        expectedPayloadHash: payloadHash,
      });
      if (!validation.ok) {
        throw new Error(
          formatSyncAdmissionError(
            'DocumentHandle.syncPort.applyUpdateWithProvenance',
            validation.diagnostics,
          ),
        );
      }
      emitDocumentSyncAdmission(getComputeBridge(), {
        source: 'document-sync-port',
        docId: documentId,
        envelopeVersion: 'provenance-only',
        updateId: provenance.updateIdentity.updateId,
        payloadHash,
        provenance,
        validationDiagnostics: validation.diagnostics,
      });
      await getComputeBridge().syncApply(update);
    },
    async applyProviderEnvelope(envelope): Promise<void> {
      assertNotDisposed('syncPort.applyProviderEnvelope');
      const payloadHash = await sha256Hex(
        envelope.payload,
        'DocumentHandle.syncPort.applyProviderEnvelope',
      );
      const validation = validateProviderInboundUpdateEnvelope(envelope, {
        expectedPayloadHash: payloadHash,
      });
      if (!validation.ok) {
        throw new Error(
          formatSyncAdmissionError(
            'DocumentHandle.syncPort.applyProviderEnvelope',
            validation.diagnostics,
          ),
        );
      }
      emitDocumentSyncAdmission(getComputeBridge(), {
        source: 'document-sync-port',
        docId: documentId,
        envelopeVersion: 'provider-inbound-update-v2',
        providerRefId: envelope.providerRefId,
        providerEpoch: envelope.providerEpoch,
        updateId: envelope.updateId,
        payloadHash,
        provenance: envelope.provenance,
        validationDiagnostics: validation.diagnostics,
      });
      await getComputeBridge().syncApply(envelope.payload);
    },
    async applyClassifiedRawUpdate(
      update: Uint8Array,
      provenance: ClassifiedRawSyncUpdateProvenance,
    ): Promise<void> {
      assertNotDisposed('syncPort.applyClassifiedRawUpdate');
      assertClassifiedRawSyncProvenance(
        provenance,
        'DocumentHandle.syncPort.applyClassifiedRawUpdate',
      );
      const payloadHash = await sha256Hex(
        update,
        'DocumentHandle.syncPort.applyClassifiedRawUpdate',
      );
      const validation = validateSyncUpdateProvenance(provenance, {
        expectedPayloadHash: payloadHash,
      });
      if (!validation.ok) {
        throw new Error(
          formatSyncAdmissionError(
            'DocumentHandle.syncPort.applyClassifiedRawUpdate',
            validation.diagnostics,
          ),
        );
      }
      emitDocumentSyncAdmission(getComputeBridge(), {
        source: 'document-sync-port',
        docId: documentId,
        envelopeVersion: 'classified-raw',
        updateId: provenance.updateIdentity.updateId,
        payloadHash,
        provenance,
        validationDiagnostics: validation.diagnostics,
      });
      await getComputeBridge().syncApply(update);
    },
    encodeDiff(remoteStateVector: Uint8Array): Promise<Uint8Array> {
      assertNotDisposed('syncPort.encodeDiff');
      return getComputeBridge().encodeDiff(remoteStateVector);
    },
    currentStateVector(): Promise<Uint8Array> {
      assertNotDisposed('syncPort.currentStateVector');
      return getComputeBridge().currentStateVector();
    },
  };
}

type ComputeBridgeSyncAdmissionHooks = {
  recordProviderDocApplyUpdateAdmission?: (metadata: SyncUpdateAdmissionMetadata) => void;
};

function emitDocumentSyncAdmission(
  bridge: unknown,
  metadata: DocumentByteSyncPortApplyUpdateMetadata,
): void {
  try {
    (bridge as ComputeBridgeSyncAdmissionHooks).recordProviderDocApplyUpdateAdmission?.(metadata);
  } catch (err) {
    slog('documentSyncPort.applyUpdateAdmissionSinkFailed', { error: err });
  }
}

function assertClassifiedRawSyncProvenance(
  provenance: SyncUpdateProvenance,
  methodName: string,
): asserts provenance is ClassifiedRawSyncUpdateProvenance {
  if (
    provenance.capturePolicy === 'commitEligible' ||
    provenance.sourceKind === 'providerLiveInbound' ||
    provenance.sourceKind === 'collaborationLiveRemote'
  ) {
    throw new Error(
      `${methodName}: classified raw sync updates cannot be commit eligible or live-authored`,
    );
  }
}

function formatSyncAdmissionError(
  methodName: string,
  diagnostics: readonly { readonly reason: string; readonly subreason?: string }[],
): string {
  const reasonList = diagnostics
    .map((diagnostic) =>
      diagnostic.subreason === undefined
        ? diagnostic.reason
        : `${diagnostic.reason}/${diagnostic.subreason}`,
    )
    .join(', ');
  return `${methodName}: provenance validation failed${reasonList.length === 0 ? '' : `: ${reasonList}`}`;
}

async function sha256Hex(bytes: Uint8Array, methodName: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error(`${methodName}: SHA-256 digest is unavailable`);
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
