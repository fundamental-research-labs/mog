import type {
  DocumentByteSyncPortApplyUpdateReturn,
  DocumentByteSyncPortClassifiedRawProvenance,
  DocumentByteSyncPortRawSyncLifecycle,
} from './document-sync-port-types';

/**
 * A compute engine instance. The SDK invokes methods by name through the
 * rust-bridge command protocol.
 *
 * @internal Not part of the public SDK API surface.
 */
export interface ComputeEngineInstance {
  [method: string]: (...args: unknown[]) => unknown;
}

/**
 * Package-local byte-sync capability exposed by the deprecated collaboration
 * helpers. Structurally matches the kernel provider port without publishing a
 * dependency on the kernel storage subpath.
 *
 * @internal
 */
export interface DocumentByteSyncPort {
  readonly docId: string;
  applyUpdate(update: Uint8Array): Promise<DocumentByteSyncPortApplyUpdateReturn>;
  applyClassifiedRawUpdate?(
    update: Uint8Array,
    provenance: DocumentByteSyncPortRawProvenance,
  ): Promise<void>;
  encodeDiff(remoteSv: Uint8Array): Promise<Uint8Array>;
  currentStateVector(): Promise<Uint8Array>;
}

export type DocumentByteSyncPortRawProvenance =
  | DocumentByteSyncPortClassifiedRawProvenance
  | DocumentByteSyncPortLegacyRawProvenance;

export interface DocumentByteSyncPortLegacyRawProvenance {
  readonly schemaVersion: 'sync-update-provenance-v1';
  readonly sourceKind: 'legacyRawUnknown';
  readonly sdkLifecycle: DocumentByteSyncPortRawSyncLifecycle & {
    readonly source: 'legacyApplyUpdate';
  };
  readonly updateIdentity: {
    readonly originKind: 'legacyRaw';
    readonly updateId?: string;
    readonly payloadHash: string;
  };
  readonly trust: { readonly status: 'legacyRaw' };
  readonly author: { readonly kind: 'unknown'; readonly reason: 'legacyRaw' };
  readonly replay: boolean;
  readonly system: boolean;
  readonly capturePolicy: 'excluded';
  readonly redaction: DocumentByteSyncPortClassifiedRawProvenance['redaction'];
  readonly exclusionDiagnostic: {
    readonly reason: 'legacyRawUnknown';
    readonly subreason: 'rawUnclassified';
    readonly message: string;
  };
}

const SDK_RAW_SYNC_REDACTION_POLICY = Object.freeze({
  schemaVersion: 'provenance-redaction-policy-v1',
  mode: 'diagnostic-only',
  durableAuthorIdentity: 'unknown',
  durableProviderIdentity: 'unknown',
  proofMaterial: 'diagnostics-only',
} satisfies DocumentByteSyncPortLegacyRawProvenance['redaction']);

const LEGACY_APPLY_UPDATE_LIFECYCLE = Object.freeze({
  schemaVersion: 'sdk-raw-sync-lifecycle-v1',
  source: 'legacyApplyUpdate',
  capturePolicy: 'excluded',
} satisfies DocumentByteSyncPortLegacyRawProvenance['sdkLifecycle']);

export function createClassifiedDocumentByteSyncPort(
  syncPort: DocumentByteSyncPort,
): DocumentByteSyncPort {
  const applyClassifiedRawUpdate = syncPort.applyClassifiedRawUpdate?.bind(syncPort);
  const wrapped: DocumentByteSyncPort = {
    docId: syncPort.docId,
    async applyUpdate(update) {
      if (!applyClassifiedRawUpdate) {
        throw new Error(
          'DocumentByteSyncPort.applyUpdate requires applyClassifiedRawUpdate for raw sync provenance admission',
        );
      }
      const payloadHash = await sha256Hex(update, 'DocumentByteSyncPort.applyUpdate');
      await applyClassifiedRawUpdate(update, legacyRawUpdateProvenance(payloadHash));
    },
    encodeDiff: (remoteSv) => syncPort.encodeDiff(remoteSv),
    currentStateVector: () => syncPort.currentStateVector(),
  };

  if (applyClassifiedRawUpdate) {
    wrapped.applyClassifiedRawUpdate = (update, provenance) =>
      applyClassifiedRawUpdate(update, provenance);
  }

  return wrapped;
}

function legacyRawUpdateProvenance(payloadHash: string): DocumentByteSyncPortLegacyRawProvenance {
  return {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: 'legacyRawUnknown',
    sdkLifecycle: LEGACY_APPLY_UPDATE_LIFECYCLE,
    updateIdentity: { originKind: 'legacyRaw', updateId: `legacy-raw:${payloadHash}`, payloadHash },
    trust: { status: 'legacyRaw' },
    author: { kind: 'unknown', reason: 'legacyRaw' },
    replay: false,
    system: false,
    capturePolicy: 'excluded',
    redaction: SDK_RAW_SYNC_REDACTION_POLICY,
    exclusionDiagnostic: {
      reason: 'legacyRawUnknown',
      subreason: 'rawUnclassified',
      message:
        'DocumentByteSyncPort.applyUpdate raw sync bytes are classified as legacyApplyUpdate with capturePolicy=excluded and cannot claim authorship.',
    },
  };
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
