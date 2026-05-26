import type { VerifiedPrincipal } from './identity';
import type { HostCapabilityLookup } from './capabilities';
import type { HostDiagnosticsSink, SecurityEventRef } from './diagnostics';
import type { HostCanonicalFingerprint } from './fingerprints';
import type { HostExportFormat } from './operations';
import type {
  DocumentStorageConfig,
  DocumentOpenIntent,
  DocumentDurabilityMode,
  StorageProviderKind,
  StorageProviderRole,
} from './storage';
import type {
  HostRawDocumentBytesPolicy,
  HostSourceContentIdentity,
  HostSourceHandleIssuanceRef,
} from './source';
export type {
  HostRawDocumentBytesPolicy,
  HostSourceContentIdentity,
  HostSourceHandleIssuanceRef,
} from './source';

export type HostSessionMode = 'interactive' | 'automation' | 'service' | 'publish' | 'test';

export interface HostSession {
  readonly sessionId: string;
  readonly tenantId: string | { readonly kind: 'single-tenant' };
  readonly workspaceId: string | { readonly kind: 'no-workspace' };
  readonly locale: string;
  readonly userTimezone: string;
  readonly mode: HostSessionMode;
  readonly createdAt: number;
  readonly correlationRootId: string;
}

export interface HostClock {
  now(): number;
  dateNow(): number;
  performanceNow?(): number;
}

export interface HostTimezonePolicy {
  readonly userTimezone: string;
  readonly source:
    | 'browser-user-device'
    | 'trusted-session-metadata'
    | 'trusted-desktop-profile'
    | 'test-fixture';
  readonly processTimezoneMayBeUsed: false;
}

export type HostExportContentPolicy =
  | {
      readonly kind: 'redacted-view';
      readonly workbookAccessProof: WorkbookAccessDecisionRef;
      readonly redactionPath: 'rust-gated-redacted-export';
    }
  | {
      readonly kind: 'authorized-raw-snapshot';
      readonly rawMaterializationProof: WorkbookRawMaterializationDecisionRef;
    };

export type HostAuthorizedStorageConstraint = 'as-requested' | 'read-only' | 'ephemeral';

export type HostProviderRawByteExposure =
  | 'kernel-internal-only'
  | 'trusted-provider-boundary'
  | 'same-principal-local-raw'
  | 'redacted-protocol-only';

export interface HostDocumentResourceContext {
  readonly tenantId: string | { readonly kind: 'single-tenant' };
  readonly workspaceId: string | { readonly kind: 'no-workspace' };
  readonly documentId?: string;
  readonly resolutionSource: 'trusted-control-plane' | 'trusted-adapter' | 'test-fixture';
}

export type HostDocumentRef =
  | { readonly kind: 'document'; readonly documentId: string }
  | {
      readonly kind: 'source-handle';
      readonly sourceHandleId: string;
      readonly issuance: HostSourceHandleIssuanceRef;
      readonly sourceKind: 'file-url' | 'uploaded-bytes' | 'host-callback' | 'remote-object';
      readonly issuerHostId: string;
      readonly sourceHostId: string;
      readonly sourceSessionId: string;
      readonly principalFingerprint: HostCanonicalFingerprint;
      readonly resourceContext: HostDocumentResourceContext;
      readonly expiresAt: number;
      readonly singleUse: true;
      readonly origin?: string;
      readonly redactedFingerprint?: HostCanonicalFingerprint;
    };

export interface WorkbookAccessDecisionRef {
  readonly source: 'rust-policy-engine';
  readonly decisionId: string;
  readonly sessionId: string;
  readonly principalFingerprint: HostCanonicalFingerprint;
  readonly resourceContextFingerprint: HostCanonicalFingerprint;
  readonly target: 'workbook' | 'sheet' | 'range' | 'column';
  readonly effectiveLevel: 'read' | 'write' | 'admin';
  readonly correlationId: string;
  readonly issuedAt: number;
  readonly securityEventRef?: SecurityEventRef;
}

export interface WorkbookRawMaterializationDecisionRef {
  readonly source: 'rust-policy-engine';
  readonly decisionId: string;
  readonly sessionId: string;
  readonly principalFingerprint: HostCanonicalFingerprint;
  readonly resourceContextFingerprint: HostCanonicalFingerprint;
  readonly target: 'raw-document-materialization';
  readonly scope: 'entire-document';
  readonly effectiveLevel: 'raw-materialize';
  readonly childPolicyResolution: 'all-materialized-targets-raw-authorized';
  readonly correlationId: string;
  readonly issuedAt: number;
  readonly securityEventRef?: SecurityEventRef;
}

export interface HostRedactedExportCoverageProof {
  readonly source: 'kernel-export-preflight' | 'access-control-audit';
  readonly exportPathId: string;
  readonly format: HostExportFormat;
  readonly coverage: 'audited-export-path' | 'gap-surfaces-not-used';
  readonly issuedAt: number;
  readonly securityEventRef?: SecurityEventRef;
}

export type HostDocumentSessionOperation = 'create' | 'open' | 'import';
export type HostDocumentManagementOperation = 'share' | 'delete' | 'destroy';

export type HostDocumentAuthorizationDetails =
  | { readonly operation: 'create'; readonly templateId?: string }
  | { readonly operation: 'open' }
  | {
      readonly operation: 'import';
      readonly sourceKind: 'xlsx' | 'csv' | 'ooxml' | 'snapshot' | 'unknown';
    }
  | {
      readonly operation: 'share';
      readonly recipients: readonly string[];
      readonly accessLevel: 'read' | 'write' | 'admin';
    }
  | {
      readonly operation: 'export';
      readonly format: HostExportFormat;
      readonly exportPathId: string;
      readonly documentHighWaterMark: KernelDocumentHighWaterMarkProof;
      readonly destination: 'download' | 'host-callback' | 'remote-storage';
      readonly requestedExportSinkRefs: readonly HostAuthorizedExportSinkRef[];
      readonly contentPolicy: HostExportContentPolicy;
    }
  | { readonly operation: 'delete'; readonly permanence: 'trash' | 'permanent' }
  | { readonly operation: 'destroy'; readonly scope: 'local-session' | 'all-storage' };

export interface HostStorageAuthorizationIntent {
  readonly openIntent: DocumentOpenIntent;
  readonly durability: DocumentDurabilityMode;
  readonly rawBytesPolicy: HostRawDocumentBytesPolicy;
  readonly providers: readonly {
    readonly providerRefId: string;
    readonly providerId?: string;
    readonly kind: StorageProviderKind;
    readonly role: StorageProviderRole;
    readonly required: boolean;
    readonly rawByteExposure: HostProviderRawByteExposure;
    readonly authorityRef?: string;
    readonly storageScope?: {
      readonly tenantId: string | { readonly kind: 'single-tenant' };
      readonly workspaceId: string | { readonly kind: 'no-workspace' };
      readonly documentId?: string;
    };
    readonly redactedConfigFingerprint?: HostCanonicalFingerprint;
  }[];
  readonly requestedConstraint: HostAuthorizedStorageConstraint;
}

export interface HostAuthorizedExportSinkRef {
  readonly providerRefId: string;
  readonly role: 'exportSink';
  readonly destination: 'download' | 'host-callback' | 'remote-storage';
  readonly authorityRef?: string;
  readonly storageScope?: {
    readonly tenantId: string | { readonly kind: 'single-tenant' };
    readonly workspaceId: string | { readonly kind: 'no-workspace' };
    readonly documentId?: string;
  };
  readonly redactedConfigFingerprint?: HostCanonicalFingerprint;
}

export type KernelHighWaterProofField =
  | 'proofId'
  | 'registryId'
  | 'sessionId'
  | 'resourceContextFingerprint'
  | 'documentRefFingerprint'
  | 'mutationWatermark'
  | 'exportPathId'
  | 'format'
  | 'contentPolicyFingerprint'
  | 'destination'
  | 'requestedExportSinkRefs'
  | 'issuedAt'
  | 'expiresAt';

export interface KernelDocumentHighWaterMarkProof {
  readonly source: 'kernel-write-gate';
  readonly proofId: string;
  readonly registryId: string;
  readonly sessionId: string;
  readonly resourceContextFingerprint: HostCanonicalFingerprint;
  readonly documentRefFingerprint?: HostCanonicalFingerprint;
  readonly mutationWatermark: string;
  readonly exportPathId: string;
  readonly format: HostExportFormat;
  readonly contentPolicyFingerprint: HostCanonicalFingerprint;
  readonly destination: 'download' | 'host-callback' | 'remote-storage';
  readonly requestedExportSinkRefs: readonly HostAuthorizedExportSinkRef[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly coveredFields: readonly KernelHighWaterProofField[];
  readonly canonicalPayloadHash: HostCanonicalFingerprint;
  readonly verification:
    | {
        readonly kind: 'live-kernel-write-gate-registry';
        readonly registryId: string;
      }
    | {
        readonly kind: 'mac-or-signature';
        readonly algorithm: 'hmac-sha256' | 'ed25519';
        readonly signatureOrMacRef: string;
      };
}

export type HostExportMaterializationGrant =
  | {
      readonly grantKind: 'export-byte-materialization';
      readonly decisionId: string;
      readonly correlationId: string;
      readonly format: HostExportFormat;
      readonly exportPathId: string;
      readonly documentHighWaterMark: KernelDocumentHighWaterMarkProof;
      readonly contentPolicy: Extract<HostExportContentPolicy, { readonly kind: 'redacted-view' }>;
      readonly redactedExportCoverageProof: HostRedactedExportCoverageProof;
      readonly destination: 'download' | 'host-callback' | 'remote-storage';
      readonly exportSinkRefs: readonly HostAuthorizedExportSinkRef[];
      readonly materializationNonce: string;
      readonly expiresAt: number;
    }
  | {
      readonly grantKind: 'export-byte-materialization';
      readonly decisionId: string;
      readonly correlationId: string;
      readonly format: HostExportFormat;
      readonly exportPathId: string;
      readonly documentHighWaterMark: KernelDocumentHighWaterMarkProof;
      readonly contentPolicy: Extract<
        HostExportContentPolicy,
        { readonly kind: 'authorized-raw-snapshot' }
      >;
      readonly destination: 'download' | 'host-callback' | 'remote-storage';
      readonly exportSinkRefs: readonly HostAuthorizedExportSinkRef[];
      readonly materializationNonce: string;
      readonly expiresAt: number;
    };

// --- Storage handoff types ---

export interface AuthorizedDocumentStorageHandoffBase {
  readonly decisionId: string;
  readonly correlationId: string;
  readonly sessionId: string;
  readonly nonce: string;
  readonly expiresAt: number;
  readonly storageConstraint: HostAuthorizedStorageConstraint;
  readonly principal: VerifiedPrincipal;
  readonly resourceContext: HostDocumentResourceContext;
  readonly documentRef?: HostDocumentRef;
  readonly sourceHostId: string;
  readonly storageIntentFingerprint: HostCanonicalFingerprint;
  readonly rawBytesPolicy: HostRawDocumentBytesPolicy;
  readonly authorizedProviders: readonly {
    readonly providerRefId: string;
    readonly providerId?: string;
    readonly kind: StorageProviderKind;
    readonly role: StorageProviderRole;
    readonly required: boolean;
    readonly rawByteExposure: HostProviderRawByteExposure;
    readonly authorityRef?: string;
    readonly storageScope?: {
      readonly tenantId: string | { readonly kind: 'single-tenant' };
      readonly workspaceId: string | { readonly kind: 'no-workspace' };
      readonly documentId?: string;
    };
    readonly redactedConfigFingerprint?: HostCanonicalFingerprint;
  }[];
  readonly storage: DocumentStorageConfig;
}

export type AuthorizedDocumentStorageHandoff = AuthorizedDocumentStorageHandoffBase & {
  readonly operation: HostDocumentSessionOperation;
  readonly exportMaterialization?: never;
};

export interface AuthorizedExportMaterializationHandoff {
  readonly operation: 'export';
  readonly decisionId: string;
  readonly correlationId: string;
  readonly sessionId: string;
  readonly nonce: string;
  readonly expiresAt: number;
  readonly principal: VerifiedPrincipal;
  readonly resourceContext: HostDocumentResourceContext;
  readonly documentRef?: HostDocumentRef;
  readonly sourceHostId: string;
  readonly rawBytesPolicy: HostRawDocumentBytesPolicy;
  readonly exportMaterialization: HostExportMaterializationGrant;
}

export interface HostAuthorizedStorageActionProviderRef {
  readonly providerRefId: string;
  readonly role: StorageProviderRole;
  readonly authorityRef?: string;
  readonly storageScope?: {
    readonly tenantId: string | { readonly kind: 'single-tenant' };
    readonly workspaceId: string | { readonly kind: 'no-workspace' };
    readonly documentId?: string;
  };
  readonly redactedConfigFingerprint?: HostCanonicalFingerprint;
}

export interface AuthorizedDocumentManagementHandoffBase {
  readonly decisionId: string;
  readonly correlationId: string;
  readonly sessionId: string;
  readonly nonce: string;
  readonly expiresAt: number;
  readonly principal: VerifiedPrincipal;
  readonly resourceContext: HostDocumentResourceContext;
  readonly documentRef?: HostDocumentRef;
  readonly sourceHostId: string;
}

export type AuthorizedDocumentManagementHandoff =
  | (AuthorizedDocumentManagementHandoffBase & {
      readonly operation: 'share';
      readonly share: {
        readonly recipients: readonly string[];
        readonly accessLevel: 'read' | 'write' | 'admin';
        readonly liveCollaborationAccess: 'requires-recipient-open-authorization';
      };
    })
  | (AuthorizedDocumentManagementHandoffBase & {
      readonly operation: 'delete';
      readonly delete: {
        readonly permanence: 'trash' | 'permanent';
        readonly providerRefs: readonly HostAuthorizedStorageActionProviderRef[];
      };
    })
  | (AuthorizedDocumentManagementHandoffBase & {
      readonly operation: 'destroy';
      readonly destroy: {
        readonly scope: 'local-session' | 'all-storage';
        readonly providerRefs: readonly HostAuthorizedStorageActionProviderRef[];
      };
    });

export type AuthorizedDocumentOperationHandoff =
  | AuthorizedDocumentStorageHandoff
  | AuthorizedExportMaterializationHandoff
  | AuthorizedDocumentManagementHandoff;

// --- Authorization service ---

export interface HostDocumentAuthorizationRequestBase {
  readonly correlationId: string;
  readonly principal: VerifiedPrincipal;
  readonly resourceContext: HostDocumentResourceContext;
  readonly documentRef?: HostDocumentRef;
  readonly sourceHostId: string;
}

export type HostDocumentAuthorizationRequest =
  | (HostDocumentAuthorizationRequestBase & {
      readonly details: Extract<
        HostDocumentAuthorizationDetails,
        { readonly operation: HostDocumentSessionOperation }
      >;
      readonly storageIntent: HostStorageAuthorizationIntent;
    })
  | (HostDocumentAuthorizationRequestBase & {
      readonly details: Extract<
        HostDocumentAuthorizationDetails,
        { readonly operation: 'export' | HostDocumentManagementOperation }
      >;
      readonly storageIntent?: never;
    });

export type HostAuthorizationDecision =
  | {
      readonly allowed: true;
      readonly decisionId: string;
      readonly correlationId: string;
      readonly authorizedAt: number;
      readonly storageConstraint?: HostAuthorizedStorageConstraint;
      readonly handoff: AuthorizedDocumentOperationHandoff;
    }
  | {
      readonly allowed: false;
      readonly decisionId: string;
      readonly correlationId: string;
      readonly decidedAt: number;
      readonly code: string;
      readonly reason: string;
    };

export interface HostDocumentAuthorizationService {
  authorize(request: HostDocumentAuthorizationRequest): Promise<HostAuthorizationDecision>;
}

// --- KernelHostContext ---

import type { KernelRuntimeConfig } from './runtime';
export type { KernelRuntimeConfig } from './runtime';

export interface KernelHostContext {
  readonly session: HostSession;
  readonly principal: VerifiedPrincipal;
  readonly documentAuthorization: HostDocumentAuthorizationService;
  readonly storage: AuthorizedDocumentStorageHandoff;
  readonly runtime: KernelRuntimeConfig;
  readonly capabilities: HostCapabilityLookup;
  readonly diagnostics: HostDiagnosticsSink;
  readonly clock: HostClock;
  readonly timezone: HostTimezonePolicy;
  readonly workbookLinkResolver?: HostWorkbookLinkResolver;
}

export type HostWorkbookLinkStatus =
  | 'unresolved'
  | 'loading'
  | 'ready'
  | 'stale'
  | 'denied'
  | 'broken'
  | 'ambiguous';

export type HostWorkbookLinkStatusReason =
  | 'wrongWorkbookId'
  | 'missingTarget'
  | 'unsupportedLinkKind'
  | 'permissionDenied'
  | 'sourceUnavailable';

export type HostPersistedLinkTarget =
  | { readonly kind: 'document-ref'; readonly documentId: string }
  | { readonly kind: 'open-session'; readonly sessionId: string }
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'excel-external-path'; readonly target: string }
  | { readonly kind: 'opaque-host-ref'; readonly provider: string; readonly ref: string };

export interface HostWorkbookLinkResolveRequest {
  readonly linkId: string;
  readonly requestingDocumentId: string;
  readonly requestingSessionId: string;
  readonly actor: string;
  readonly principal: { readonly tags: readonly string[] };
  readonly target: HostPersistedLinkTarget;
  readonly expectedWorkbookId: string | null;
}

export interface HostResolvedWorkbookLink {
  readonly linkId: string;
  readonly status: HostWorkbookLinkStatus;
  readonly statusReason?: HostWorkbookLinkStatusReason;
  readonly sourceSessionId?: string;
  readonly sourceDocumentRef?: HostPersistedLinkTarget;
  readonly sourceWorkbookId?: string;
  readonly sourceVersion?: string;
  readonly authorization: 'read' | 'redacted' | 'denied';
  readonly watch?: { dispose(): void };
}

export interface HostWorkbookLinkResolver {
  resolve(
    request: HostWorkbookLinkResolveRequest,
  ): Promise<HostResolvedWorkbookLink> | HostResolvedWorkbookLink;
}

// ---------------------------------------------------------------------------
// Host-backed kernel document lifecycle types
//
// These validated/narrowed types are the kernel's view of the host context
// after validation. `KernelHostDocumentInput` is the narrow entry accepted
// by the trusted adapter entry point. `KernelDocumentLifecycleInput` is the
// validated output from the validation gate, carrying only the fields the
// `DocumentLifecycleSystem` needs — never the raw full `KernelHostContext`.
// ---------------------------------------------------------------------------

import type { HostKernelAdapterBindings, HostHandoffReplayRegistry } from './bindings';

export interface KernelHostDocumentInput {
  readonly kind: 'host-backed-document';
  readonly host: KernelHostContext;
}

export interface KernelDocumentLifecycleInput {
  readonly kind: 'host-backed-document';
  readonly documentId: string;
  readonly operation: 'create' | 'open' | 'import';
  readonly session: HostSessionSnapshot;
  readonly resourceContext: HostDocumentResourceContext;
  readonly documentRef?: HostDocumentRef;
  readonly principal: VerifiedPrincipal;
  readonly storage: ValidatedAuthorizedStorageHandoff;
  readonly runtime: ValidatedKernelRuntimeConfig;
  readonly diagnostics: HostDiagnosticsSink;
  readonly clock: HostClock;
  readonly timezone: HostTimezonePolicy;
  readonly workbookLinkResolver?: HostWorkbookLinkResolver;
  readonly bindings: ValidatedHostKernelAdapterBindings;
  readonly operationAuthorization: BoundHostDocumentOperationAuthorization;
}

export type HostSessionSnapshot = Readonly<HostSession>;

export interface ValidatedAuthorizedStorageHandoff {
  readonly handoff: AuthorizedDocumentStorageHandoff;
  readonly validatedAt: number;
  readonly documentId: string;
}

export interface ValidatedKernelRuntimeConfig {
  readonly config: KernelRuntimeConfig;
  readonly transportBindingVerified: boolean;
  readonly transportBinding: {
    readonly runtimeKind: string;
    createTransportConfig(): unknown;
  };
  readonly transportConfig: unknown;
}

export interface ValidatedHostKernelAdapterBindings {
  readonly bindings: HostKernelAdapterBindings;
  readonly providerMaterializersAvailable: readonly string[];
  readonly sourceResolversAvailable: readonly string[];
}

export interface BoundHostDocumentOperationAuthorization {
  readonly sessionId: string;
  readonly principalFingerprint: HostCanonicalFingerprint;
  readonly resourceContextFingerprint: HostCanonicalFingerprint;
  readonly sourceHostId: string;
  readonly diagnostics: HostDiagnosticsSink;
  readonly replayRegistry: HostHandoffReplayRegistry;
  readonly documentAuthorization: KernelHostContext['documentAuthorization'];
}
