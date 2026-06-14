/**
 * Host kernel adapter binding interfaces.
 *
 * These are trusted composition capabilities passed by trusted adapters
 * alongside `KernelHostContext`. They are NOT authority claims from untrusted
 * callers — every binding use is joined back to the authorized handoff by
 * decision ID, nonce, principal, resource context, provider/source refs,
 * fingerprints, and expiry before it can materialize bytes, providers,
 * transports, paths, callbacks, or secrets.
 *
 * These must NOT appear inside `DocumentStorageConfig`, public kernel
 * declarations, diagnostics payloads, or serialized host handoffs.
 */

import type { HostCanonicalFingerprint } from './fingerprints';
import type {
  HostRawDocumentBytesPolicy,
  HostSourceContentIdentity,
  HostSourceHandleIssuanceRef,
} from './source';

// ---------------------------------------------------------------------------
// Provider Materializer Registry
// ---------------------------------------------------------------------------

export interface HostProviderMaterializerRegistry {
  has(providerRefId: string): boolean;
  resolve(request: ProviderMaterializerRequest): Promise<ProviderMaterializerHandle>;
}

export interface ProviderMaterializerRequest {
  readonly providerRefId: string;
  readonly decisionId: string;
  readonly nonce: string;
  readonly expiresAt: number;
  readonly principalFingerprint: HostCanonicalFingerprint;
  readonly resourceContextFingerprint: HostCanonicalFingerprint;
  readonly storageScope?: {
    readonly tenantId: string | { readonly kind: 'single-tenant' };
    readonly workspaceId: string | { readonly kind: 'no-workspace' };
    readonly documentId?: string;
  };
  readonly authorityRef?: string;
  readonly redactedConfigFingerprint?: HostCanonicalFingerprint;
  readonly rawBytesPolicy: HostRawDocumentBytesPolicy;
  readonly kind: string;
  readonly role: string;
}

export interface ProviderMaterializerHandle {
  readonly providerRefId: string;
  readonly materialized: true;
  attach(rustDocument: unknown, options?: ProviderMaterializerAttachOptions): Promise<void>;
  dispose(): void;
}

export interface ProviderMaterializerAttachOptions {
  readonly mode?: {
    readonly kind: 'normal' | 'createFresh' | 'importInitialize';
    readonly replaceExisting?: boolean;
  };
  readonly suppressInitialBaseline?: boolean;
  readonly suppressQueuedUpdates?: boolean;
  readonly suppressTouch?: boolean;
}

// ---------------------------------------------------------------------------
// Source Handle Resolver Registry
// ---------------------------------------------------------------------------

export interface HostSourceHandleResolverRegistry {
  has(sourceKind: string): boolean;
  resolve(request: SourceHandleResolveRequest): Promise<SourceHandleResolveResult>;
}

export interface SourceHandleResolveRequest {
  readonly sourceHandleId: string;
  readonly issuance: HostSourceHandleIssuanceRef;
  readonly expectedContentIdentity: HostSourceContentIdentity;
  readonly sourceKind: string;
  readonly issuerHostId: string;
  readonly sourceHostId: string;
  readonly sourceSessionId: string;
  readonly resourceContext: {
    readonly tenantId: string | { readonly kind: 'single-tenant' };
    readonly workspaceId: string | { readonly kind: 'no-workspace' };
    readonly documentId?: string;
    readonly resolutionSource: 'trusted-control-plane' | 'trusted-adapter' | 'test-fixture';
  };
  readonly expiresAt: number;
  readonly singleUse: true;
  readonly redactedFingerprint?: HostCanonicalFingerprint;
  readonly principalFingerprint: HostCanonicalFingerprint;
  readonly resourceContextFingerprint: HostCanonicalFingerprint;
  readonly sessionId: string;
  readonly decisionId: string;
  readonly nonce: string;
}

export interface SourceHandleResolveResult {
  readonly bytes: Uint8Array;
  readonly contentIdentity: HostSourceContentIdentity;
  readonly contentIdentityVerified: true;
  readonly sourceHandleId: string;
}

// ---------------------------------------------------------------------------
// Handoff Replay Registry
// ---------------------------------------------------------------------------

export interface HostHandoffReplayRegistry {
  consumeOnce(key: HandoffReplayKey): boolean;
}

export interface HandoffReplayKey {
  readonly sourceHostId: string;
  readonly sessionId: string;
  readonly decisionId: string;
  readonly operation: string;
  readonly nonce: string;
  readonly resourceFingerprint: HostCanonicalFingerprint;
}

// ---------------------------------------------------------------------------
// Transport Binding Registry
// ---------------------------------------------------------------------------

export interface HostTransportBindingRegistry {
  has(runtimeKind: string): boolean;
  resolve(runtimeKind: string): HostTransportBinding;
}

export interface HostTransportBinding {
  readonly runtimeKind: string;
  createTransportConfig(): unknown;
}

// ---------------------------------------------------------------------------
// Composite Bindings
// ---------------------------------------------------------------------------

export interface HostKernelAdapterBindings {
  readonly providerMaterializers: HostProviderMaterializerRegistry;
  readonly sourceHandleResolvers: HostSourceHandleResolverRegistry;
  readonly replayRegistry: HostHandoffReplayRegistry;
  readonly transportBindings: HostTransportBindingRegistry;
}
