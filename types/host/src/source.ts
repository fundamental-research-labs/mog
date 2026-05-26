import type { HostCanonicalFingerprint } from './fingerprints';

export type HostRawDocumentBytesPolicy =
  | {
      readonly kind: 'trusted-raw-provider-boundary';
      readonly boundary:
        | 'trusted-service'
        | 'trusted-desktop'
        | 'same-principal-local'
        | 'test-fixture';
      readonly rawProviderBytesMayReachUntrustedClient: false;
    }
  | {
      readonly kind: 'redacted-protocol-only';
      readonly protocolId: 'rust-gated-workbook-api' | 'future-redacted-collab-protocol';
      readonly rawProviderBytesMayReachUntrustedClient: false;
    };

export type HostSourceContentIdentity =
  | {
      readonly kind: 'content-hash';
      readonly algorithm: 'sha256' | 'blake3';
      readonly digest: string;
      readonly sizeBytes?: number;
    }
  | {
      readonly kind: 'versioned-object';
      readonly objectRef: string;
      readonly generation: string;
      readonly etag?: string;
      readonly sizeBytes?: number;
    }
  | {
      readonly kind: 'immutable-byte-handle';
      readonly handleFingerprint: HostCanonicalFingerprint;
      readonly sizeBytes?: number;
    };

export interface HostSourceHandleIssuanceRef {
  readonly source: 'trusted-source-handle-registry' | 'signed-source-capability';
  readonly issuanceId: string;
  readonly issuerHostId: string;
  readonly contentIdentity: HostSourceContentIdentity;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly signatureFingerprint?: HostCanonicalFingerprint;
}
