import {
  validateProviderInboundUpdateEnvelope,
  validateSyncUpdateProvenance,
  type SyncUpdateProvenance,
} from '@mog-sdk/types-document/storage';
import {
  createAdmittedSyncApplyContext,
  type AdmittedSyncApplyContext,
} from '../../bridges/compute/sync-apply-admission';
import { slog } from '../../lib/slog';
import type {
  ClassifiedRawSyncUpdateProvenance,
  DocumentByteSyncPort,
  DocumentByteSyncPortApplyUpdateMetadata,
  SyncUpdateAdmissionMetadata,
} from '../../document/providers/provider';

interface DocumentSyncComputeBridge {
  syncApply(update: Uint8Array, syncApplyContext: AdmittedSyncApplyContext): Promise<unknown>;
  encodeDiff(remoteStateVector: Uint8Array): Promise<Uint8Array>;
  currentStateVector(): Promise<Uint8Array>;
}

interface CreateDocumentByteSyncPortOptions {
  readonly documentId: string;
  readonly getComputeBridge: () => DocumentSyncComputeBridge;
  readonly assertNotDisposed: (operation: string) => void;
}

type DocumentByteSyncAdmissionFailureCode = 'provenance.missingContext';
type DocumentByteSyncAdmissionFailureReason = 'missingClassification';
type DocumentByteSyncAdmissionFailureSubreason = 'rawUnclassified';
type DocumentByteSyncAdmissionFailureBin = 'document-byte-sync-port.raw-fallback-rejected';
type DocumentByteSyncAdmissionFailureSourceKind = 'legacyRawUnknown';
type DocumentByteSyncAdmissionRetryStrategy = 'retry-with-classified-provenance';
type DocumentByteSyncAdmissionByteMaterial = 'omitted';

interface DocumentByteSyncAdmissionFailurePayload {
  readonly bin: DocumentByteSyncAdmissionFailureBin;
  readonly sourceKind: DocumentByteSyncAdmissionFailureSourceKind;
  readonly byteMaterial: DocumentByteSyncAdmissionByteMaterial;
}

interface DocumentByteSyncAdmissionFailureDiagnostic {
  readonly code: DocumentByteSyncAdmissionFailureCode;
  readonly reason: DocumentByteSyncAdmissionFailureReason;
  readonly subreason: DocumentByteSyncAdmissionFailureSubreason;
  readonly retryable: true;
  readonly retryStrategy: DocumentByteSyncAdmissionRetryStrategy;
  readonly methodName: string;
  readonly message: string;
  readonly payload: DocumentByteSyncAdmissionFailurePayload;
}

class DocumentByteSyncAdmissionError extends Error {
  readonly code: DocumentByteSyncAdmissionFailureCode;
  readonly reason: DocumentByteSyncAdmissionFailureReason;
  readonly subreason: DocumentByteSyncAdmissionFailureSubreason;
  readonly retryable: true;
  readonly retryStrategy: DocumentByteSyncAdmissionRetryStrategy;
  readonly bin: DocumentByteSyncAdmissionFailureBin;
  readonly sourceKind: DocumentByteSyncAdmissionFailureSourceKind;
  readonly payload: DocumentByteSyncAdmissionFailurePayload;
  readonly diagnostic: DocumentByteSyncAdmissionFailureDiagnostic;
  readonly diagnostics: readonly DocumentByteSyncAdmissionFailureDiagnostic[];

  constructor(diagnostic: DocumentByteSyncAdmissionFailureDiagnostic) {
    super(formatDocumentByteSyncAdmissionErrorMessage(diagnostic));
    this.name = 'DocumentByteSyncAdmissionError';
    this.code = diagnostic.code;
    this.reason = diagnostic.reason;
    this.subreason = diagnostic.subreason;
    this.retryable = diagnostic.retryable;
    this.retryStrategy = diagnostic.retryStrategy;
    this.bin = diagnostic.payload.bin;
    this.sourceKind = diagnostic.payload.sourceKind;
    this.payload = diagnostic.payload;
    this.diagnostic = diagnostic;
    this.diagnostics = Object.freeze([diagnostic]);
  }
}

function formatDocumentByteSyncAdmissionErrorMessage(
  diagnostic: DocumentByteSyncAdmissionFailureDiagnostic,
): string {
  return [
    `${diagnostic.methodName}: ${diagnostic.message}`,
    `diagnostic=${diagnostic.code}`,
    `reason=${diagnostic.reason}`,
    `subreason=${diagnostic.subreason}`,
    `retryable=${diagnostic.retryable}`,
    `retryStrategy=${diagnostic.retryStrategy}`,
    `bin=${diagnostic.payload.bin}`,
    `sourceKind=${diagnostic.payload.sourceKind}`,
    'use applyClassifiedRawUpdate, applyUpdateWithProvenance, or applyProviderEnvelope',
  ].join('; ');
}

export function createDocumentByteSyncPort(
  options: CreateDocumentByteSyncPortOptions,
): DocumentByteSyncPort {
  const { documentId, getComputeBridge, assertNotDisposed } = options;

  return {
    docId: documentId,
    async applyUpdate(_update: Uint8Array): Promise<void> {
      assertNotDisposed('syncPort.applyUpdate');
      throw rawSyncFallbackAdmissionError('DocumentHandle.syncPort.applyUpdate');
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
      const metadata: DocumentByteSyncPortApplyUpdateMetadata = {
        source: 'document-sync-port',
        docId: documentId,
        envelopeVersion: 'provenance-only',
        updateId: provenance.updateIdentity.updateId,
        payloadHash,
        provenance,
        validationDiagnostics: validation.diagnostics,
      };
      const bridge = getComputeBridge();
      await bridge.syncApply(update, admitDocumentSyncUpdate(bridge, metadata));
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
      const metadata: DocumentByteSyncPortApplyUpdateMetadata = {
        source: 'document-sync-port',
        docId: documentId,
        envelopeVersion: 'provider-inbound-update-v2',
        providerRefId: envelope.providerRefId,
        providerEpoch: envelope.providerEpoch,
        updateId: envelope.updateId,
        payloadHash,
        provenance: envelope.provenance,
        validationDiagnostics: validation.diagnostics,
      };
      const bridge = getComputeBridge();
      await bridge.syncApply(envelope.payload, admitDocumentSyncUpdate(bridge, metadata));
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
      const metadata: DocumentByteSyncPortApplyUpdateMetadata = {
        source: 'document-sync-port',
        docId: documentId,
        envelopeVersion: 'classified-raw',
        updateId: provenance.updateIdentity.updateId,
        payloadHash,
        provenance,
        validationDiagnostics: validation.diagnostics,
      };
      const bridge = getComputeBridge();
      await bridge.syncApply(update, admitDocumentSyncUpdate(bridge, metadata));
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

function rawSyncFallbackAdmissionError(methodName: string): DocumentByteSyncAdmissionError {
  return new DocumentByteSyncAdmissionError({
    code: 'provenance.missingContext',
    reason: 'missingClassification',
    subreason: 'rawUnclassified',
    retryable: true,
    retryStrategy: 'retry-with-classified-provenance',
    methodName,
    message: 'raw sync bytes require classified provenance',
    payload: {
      bin: 'document-byte-sync-port.raw-fallback-rejected',
      sourceKind: 'legacyRawUnknown',
      byteMaterial: 'omitted',
    },
  });
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

function admitDocumentSyncUpdate(
  bridge: unknown,
  metadata: DocumentByteSyncPortApplyUpdateMetadata,
): AdmittedSyncApplyContext {
  emitDocumentSyncAdmission(bridge, metadata);
  return createAdmittedSyncApplyContext(metadata);
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
