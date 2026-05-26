/**
 * Deterministic document host factory.
 *
 * Creates a fully-wired `TrustedDocumentHostContext` and companion objects
 * for host-contract integration testing. Uses fixed clocks, fixed
 * timezones, deterministic IDs, and predictable behavior throughout.
 *
 * The branded `TrustedDocumentHostContext` cast is intentionally allowed
 * here — this is a trusted adapter factory module. No other test or
 * production code should construct the branded context directly.
 */

import type { TrustedDocumentHostContext } from '@mog-sdk/types-host/trusted';
import type {
  KernelHostContext,
  HostSession,
  HostClock,
  HostTimezonePolicy,
  HostAuthorizationDecision,
  HostDocumentAuthorizationRequest,
  AuthorizedDocumentStorageHandoff,
  HostDocumentAuthorizationService,
  HostDocumentResourceContext,
  AuthorizedDocumentManagementHandoff,
} from '@mog-sdk/types-host/kernel';
import type { RuntimeHostContext, KernelRuntimeConfig } from '@mog-sdk/types-host/runtime';
import type { VerifiedPrincipal } from '@mog-sdk/types-host/identity';
import type {
  HostCapabilityLookup,
  HostCapabilityRequest,
  HostCapabilityDecision,
} from '@mog-sdk/types-host/capabilities';
import type { HostTrustProfile } from '@mog-sdk/types-host/trust';
import type { HostKernelAdapterBindings } from '@mog-sdk/types-host/bindings';

import type {
  StorageProviderConfig,
  StorageProviderKind,
  StorageProviderRole,
  StorageScopeBinding,
} from '@mog-sdk/types-document/storage';

import { createDeterministicIds, type DeterministicIds } from './ids';
import { createDiagnosticsCapture, type DiagnosticsCapture } from './diagnostics';
import { createDeterministicAdapterBindings, type DeterministicReplayRegistry } from './storage';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_HOST_ID = 'test-host-deterministic';
const FIXED_TIMESTAMP = 1700000000000;

const TEST_SCOPE_BINDING: StorageScopeBinding = {
  kind: 'explicit-no-scope',
  reason: 'deterministic-test-fixture',
};

function toStorageProviderConfig(p: {
  readonly providerRefId: string;
  readonly kind: string;
  readonly role: string;
  readonly required: boolean;
}): StorageProviderConfig {
  const base = {
    providerRefId: p.providerRefId,
    kind: p.kind as StorageProviderKind,
    role: p.role as StorageProviderRole,
    required: p.required,
    storageScope: TEST_SCOPE_BINDING,
    contractVersion: '0.1.0',
    providerProtocolVersion: '0.1.0',
  };
  switch (p.kind) {
    case 'memory':
      return { ...base, kind: 'memory' };
    case 'test':
      return {
        ...base,
        kind: 'test',
        fixtureId: 'test-fixture',
        simulateFailures: false,
        simulatedLatencyMs: 0,
      };
    case 'indexeddb':
      return {
        ...base,
        kind: 'indexeddb',
        databaseName: 'test-db',
        storeName: 'test-store',
        schemaVersion: 1,
      };
    case 'filesystem':
      return {
        ...base,
        kind: 'filesystem',
        pathHandle: 'test-path',
        format: 'mog-binary',
        atomicWrite: true,
      };
    default:
      return {
        ...base,
        kind: 'test',
        fixtureId: 'test-fixture',
        simulateFailures: false,
        simulatedLatencyMs: 0,
      };
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DeterministicDocumentHostOptions {
  // Session
  readonly sessionId?: string;
  readonly tenantId?: string;
  readonly workspaceId?: string;

  // Principal
  readonly principalSubjectId?: string;
  readonly principalTags?: readonly string[];
  readonly actorKind?:
    | 'user'
    | 'service-account'
    | 'app'
    | 'plugin'
    | 'agent'
    | 'anonymous'
    | 'test';
  readonly issuerKind?:
    | 'mog-hosted'
    | 'self-hosted'
    | 'tauri-desktop'
    | 'trusted-node-process'
    | 'test';

  // Document
  readonly documentId?: string;
  readonly operation?: 'create' | 'open' | 'import';

  // Storage
  readonly storageConstraint?: 'as-requested' | 'read-only' | 'ephemeral';
  readonly durability?: 'ephemeral' | 'durableLocal' | 'localFirst' | 'remoteBacked' | 'readOnly';
  readonly providers?: readonly {
    readonly providerRefId: string;
    readonly kind: string;
    readonly role: string;
    readonly required: boolean;
  }[];

  // Capabilities
  readonly capabilityDecisions?: ReadonlyMap<string, boolean>;

  // Clock
  readonly fixedTimestamp?: number;

  // Failure injection
  readonly failReplayCheck?: boolean;
  readonly expireHandoffAfterMs?: number;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface DeterministicDocumentHost {
  /** The branded trusted document host context. */
  readonly context: TrustedDocumentHostContext;

  /** The kernel host context (extracted from context.kernel for convenience). */
  readonly kernelContext: KernelHostContext;

  /** The adapter bindings (HostKernelAdapterBindings). */
  readonly bindings: HostKernelAdapterBindings;

  /** In-memory diagnostics capture with query/assert helpers. */
  readonly diagnostics: DiagnosticsCapture;

  /** Deterministic ID generators. */
  readonly ids: DeterministicIds;

  /** Mutable deterministic clock. */
  readonly clock: { now: number };

  /** The replay registry from the adapter bindings. */
  readonly replayRegistry: DeterministicReplayRegistry;

  /** Tear down the host (no-op for deterministic fixture). */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDeterministicDocumentHost(
  options: DeterministicDocumentHostOptions = {},
): DeterministicDocumentHost {
  const ids = createDeterministicIds();
  const diagnostics = createDiagnosticsCapture();
  const baseTimestamp = options.fixedTimestamp ?? FIXED_TIMESTAMP;
  let clockNow = baseTimestamp;

  // Adapter bindings — compose deterministic registries.
  const adapterBindings = createDeterministicAdapterBindings();

  // If failure injection: pre-poison the replay registry so consumption fails.
  const replayRegistry = adapterBindings.replayRegistry as DeterministicReplayRegistry;
  if (options.failReplayCheck) {
    // Pre-consume the initial handoff key so the real consumption returns false.
    const initialDecisionId = ids.decisions.next();
    const initialNonce = ids.nonces.next();
    replayRegistry.consumeOnce({
      sourceHostId: TEST_HOST_ID,
      sessionId: options.sessionId ?? 'test-session-00000000',
      decisionId: initialDecisionId,
      operation: options.operation ?? 'create',
      nonce: initialNonce,
      resourceFingerprint: 'mog-host-fp:v1:sha256:test-storage-intent',
    });
    // Reset ID generators so the document host gets the same IDs.
    ids.decisions.reset();
    ids.nonces.reset();
  }

  // --- Clock ---

  const clock: HostClock = {
    now: () => clockNow,
    dateNow: () => clockNow,
    performanceNow: () => clockNow - baseTimestamp,
  };

  // --- Session ---

  const sessionId = options.sessionId ?? 'test-session-00000000';
  const tenantId = options.tenantId ?? 'test-tenant';
  const workspaceId = options.workspaceId ?? 'test-workspace';

  const session: HostSession = {
    sessionId,
    tenantId,
    workspaceId,
    locale: 'en-US',
    userTimezone: 'UTC',
    mode: 'test',
    createdAt: baseTimestamp,
    correlationRootId: `corr-${sessionId}`,
  };

  // --- Principal ---

  const principal: VerifiedPrincipal = {
    issuer: {
      issuerId: 'test-issuer',
      issuerKind: options.issuerKind ?? 'test',
    },
    subjectId: options.principalSubjectId ?? 'test-user-001',
    tenantId,
    workspaceId,
    actorKind: options.actorKind ?? 'test',
    tags: [...(options.principalTags ?? [])].sort(),
  };

  // --- Timezone ---

  const timezone: HostTimezonePolicy = {
    userTimezone: 'UTC',
    source: 'test-fixture',
    processTimezoneMayBeUsed: false,
  };

  // --- Trust Profile ---

  const trustProfile: HostTrustProfile = {
    mode: 'test',
    identityAssertion: 'test-fixture',
    enforcement: {
      identity: 'trusted-adapter-factory',
      protocol: 'not-applicable',
      capability: 'trusted-adapter-factory',
      workbookAccess: 'rust-policy-engine',
      storage: 'not-applicable',
    },
    isolation: 'test-fixture',
  };

  // --- Document ID and Resource Context ---

  const documentId = options.documentId ?? 'test-doc-001';

  const resourceContext: HostDocumentResourceContext = {
    tenantId,
    workspaceId,
    documentId,
    resolutionSource: 'test-fixture',
  };

  // --- Handoff expiry ---

  const handoffExpiry =
    options.expireHandoffAfterMs !== undefined
      ? baseTimestamp + options.expireHandoffAfterMs
      : baseTimestamp + 3600000; // 1 hour default

  // --- Storage Handoff ---

  const operation = options.operation ?? 'create';
  const intent =
    operation === 'create' ? 'create' : operation === 'import' ? 'importInitialize' : 'open';

  const durability = options.durability ?? 'ephemeral';
  const storageConstraint = options.storageConstraint ?? 'ephemeral';

  const decisionId = ids.decisions.next();
  const nonce = ids.nonces.next();

  const authorizedProviders =
    options.providers?.map((p) => ({
      providerRefId: p.providerRefId,
      kind: p.kind as StorageProviderKind,
      role: p.role as StorageProviderRole,
      required: p.required,
      rawByteExposure: 'kernel-internal-only' as const,
    })) ?? [];

  const storageProviders: StorageProviderConfig[] =
    options.providers?.map(toStorageProviderConfig) ?? [];

  const storageHandoff: AuthorizedDocumentStorageHandoff = {
    operation,
    decisionId,
    correlationId: session.correlationRootId,
    sessionId,
    nonce,
    expiresAt: handoffExpiry,
    storageConstraint,
    principal,
    resourceContext,
    sourceHostId: TEST_HOST_ID,
    storageIntentFingerprint: 'mog-host-fp:v1:sha256:test-storage-intent' as const,
    rawBytesPolicy: {
      kind: 'trusted-raw-provider-boundary',
      boundary: 'test-fixture',
      rawProviderBytesMayReachUntrustedClient: false,
    },
    authorizedProviders,
    storage: {
      intent,
      durability,
      providers: storageProviders,
      requireDurabilityBeforeReady: false,
      allowReadOnlyFallback: false,
    },
  };

  // --- Document Authorization Service ---

  const documentAuthorization: HostDocumentAuthorizationService = {
    async authorize(request: HostDocumentAuthorizationRequest): Promise<HostAuthorizationDecision> {
      const reqDecisionId = ids.decisions.next();
      const reqNonce = ids.nonces.next();

      const reqOperation = request.details.operation;

      // Check capability decisions for deny overrides on management operations.
      if (
        options.capabilityDecisions &&
        options.capabilityDecisions.has(reqOperation) &&
        options.capabilityDecisions.get(reqOperation) === false
      ) {
        return {
          allowed: false,
          decisionId: reqDecisionId,
          correlationId: request.correlationId,
          decidedAt: clockNow,
          code: 'TEST_DENIED',
          reason: `Operation '${reqOperation}' denied by test fixture capability map`,
        };
      }

      // Session operations: create/open/import return storage handoffs.
      if (reqOperation === 'create' || reqOperation === 'open' || reqOperation === 'import') {
        const sessionHandoff: AuthorizedDocumentStorageHandoff = {
          operation: reqOperation,
          decisionId: reqDecisionId,
          correlationId: request.correlationId,
          sessionId,
          nonce: reqNonce,
          expiresAt: handoffExpiry,
          storageConstraint,
          principal,
          resourceContext: request.resourceContext,
          documentRef: request.documentRef,
          sourceHostId: TEST_HOST_ID,
          storageIntentFingerprint: 'mog-host-fp:v1:sha256:test-storage-intent' as const,
          rawBytesPolicy: {
            kind: 'trusted-raw-provider-boundary',
            boundary: 'test-fixture',
            rawProviderBytesMayReachUntrustedClient: false,
          },
          authorizedProviders: [],
          storage: {
            intent:
              reqOperation === 'create'
                ? 'create'
                : reqOperation === 'import'
                  ? 'importInitialize'
                  : 'open',
            durability,
            providers: [],
            requireDurabilityBeforeReady: false,
            allowReadOnlyFallback: false,
          },
        };

        return {
          allowed: true,
          decisionId: reqDecisionId,
          correlationId: request.correlationId,
          authorizedAt: clockNow,
          storageConstraint,
          handoff: sessionHandoff,
        };
      }

      // Management operations: share, delete, destroy.
      if (reqOperation === 'share' || reqOperation === 'delete' || reqOperation === 'destroy') {
        const mgmtBase = {
          decisionId: reqDecisionId,
          correlationId: request.correlationId,
          sessionId,
          nonce: reqNonce,
          expiresAt: handoffExpiry,
          principal,
          resourceContext: request.resourceContext,
          documentRef: request.documentRef,
          sourceHostId: TEST_HOST_ID,
        };

        let handoff: AuthorizedDocumentManagementHandoff;
        if (reqOperation === 'share') {
          const details = request.details as Extract<
            typeof request.details,
            { readonly operation: 'share' }
          >;
          handoff = {
            ...mgmtBase,
            operation: 'share' as const,
            share: {
              recipients: details.recipients,
              accessLevel: details.accessLevel,
              liveCollaborationAccess: 'requires-recipient-open-authorization' as const,
            },
          };
        } else if (reqOperation === 'delete') {
          const details = request.details as Extract<
            typeof request.details,
            { readonly operation: 'delete' }
          >;
          handoff = {
            ...mgmtBase,
            operation: 'delete' as const,
            delete: {
              permanence: details.permanence,
              providerRefs: [],
            },
          };
        } else {
          const details = request.details as Extract<
            typeof request.details,
            { readonly operation: 'destroy' }
          >;
          handoff = {
            ...mgmtBase,
            operation: 'destroy' as const,
            destroy: {
              scope: details.scope,
              providerRefs: [],
            },
          };
        }

        return {
          allowed: true,
          decisionId: reqDecisionId,
          correlationId: request.correlationId,
          authorizedAt: clockNow,
          handoff,
        };
      }

      // Export operations: return export materialization handoff.
      // For the test fixture, deny by default since export requires
      // high-water proofs that the deterministic host does not mint.
      return {
        allowed: false,
        decisionId: reqDecisionId,
        correlationId: request.correlationId,
        decidedAt: clockNow,
        code: 'EXPORT_NOT_SUPPORTED_IN_TEST',
        reason:
          'Export authorization requires high-water proofs not yet available in the deterministic test host',
      };
    },
  };

  // --- Capability Lookup ---

  const capabilities: HostCapabilityLookup = {
    async decide(request: HostCapabilityRequest): Promise<HostCapabilityDecision> {
      const capDecisionId = ids.decisions.next();
      const allowed =
        options.capabilityDecisions?.get(request.subject.capability as string) ?? true;

      if (allowed) {
        return {
          allowed: true,
          decisionId: capDecisionId,
          correlationId: request.correlationId,
          decidedAt: clockNow,
          operation: request.operation,
          subject: request.subject,
          enforcement: trustProfile.enforcement,
        };
      }
      return {
        allowed: false,
        decisionId: capDecisionId,
        correlationId: request.correlationId,
        decidedAt: clockNow,
        operation: request.operation,
        code: 'TEST_DENIED',
        reason: 'Denied by test fixture capability map',
        subject: request.subject,
        enforcement: trustProfile.enforcement,
      };
    },
  };

  // --- Runtime Config ---

  const runtimeConfig: KernelRuntimeConfig = {
    kind: 'test',
    deterministic: true,
  };

  // --- KernelHostContext ---

  const kernelHostContext: KernelHostContext = {
    session,
    principal,
    documentAuthorization,
    storage: storageHandoff,
    runtime: runtimeConfig,
    capabilities,
    diagnostics: diagnostics.sink,
    clock,
    timezone,
  };

  // --- RuntimeHostContext ---

  const runtimeHostContext: RuntimeHostContext = {
    kernel: runtimeConfig,
    assetPolicy: {
      assetIntegrityPolicy: 'test-fixture',
    },
    disposalPolicy: {
      onTrap: 'surface-error',
      onProviderFailure: 'test-capture',
    },
    diagnostics: diagnostics.sink,
  };

  // --- TrustedDocumentHostContext (branded cast) ---

  // Branded construction: only allowed in trusted adapter factories and test
  // fixtures. The unique symbol brand prevents accidental construction by
  // external code.
  const context = {
    hostSurface: 'document-host',
    hostId: TEST_HOST_ID,
    kind: 'test',
    trust: trustProfile,
    diagnostics: diagnostics.sink,
    kernel: kernelHostContext,
    runtime: runtimeHostContext,
    view: undefined,
    shell: undefined,
    dispose(): void {
      // no-op for test fixture
    },
  } as unknown as TrustedDocumentHostContext;

  return {
    context,
    kernelContext: kernelHostContext,
    bindings: adapterBindings,
    diagnostics,
    ids,
    clock: {
      get now() {
        return clockNow;
      },
      set now(v: number) {
        clockNow = v;
      },
    },
    replayRegistry,
    dispose() {
      // no-op for deterministic fixture
    },
  };
}
