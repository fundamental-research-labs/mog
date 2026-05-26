import type { TrustedDocumentHostContext } from '../trusted';
import type {
  KernelHostContext,
  HostSession,
  HostClock,
  HostTimezonePolicy,
  HostAuthorizationDecision,
  HostDocumentAuthorizationRequest,
  AuthorizedDocumentStorageHandoff,
} from '../kernel';
import type { RuntimeHostContext, KernelRuntimeConfig } from '../runtime';
import type { VerifiedPrincipal } from '../identity';
import type { HostDiagnosticsSink, HostDiagnosticEvent } from '../diagnostics';
import type {
  HostCapabilityLookup,
  HostCapabilityRequest,
  HostCapabilityDecision,
} from '../capabilities';
import type { HostTrustProfile } from '../trust';
import { createHostCanonicalFingerprint } from '../fingerprints';

export interface DeterministicTestHostOptions {
  readonly sessionId?: string;
  readonly tenantId?: string;
  readonly workspaceId?: string;
  readonly principalSubjectId?: string;
  readonly principalTags?: readonly string[];
  readonly documentId?: string;
  readonly storageConstraint?: 'as-requested' | 'read-only' | 'ephemeral';
  readonly capabilityDecisions?: ReadonlyMap<string, boolean>;
}

export interface DeterministicTestHost {
  readonly context: TrustedDocumentHostContext;
  readonly diagnostics: readonly HostDiagnosticEvent[];
  readonly clock: { now: number };
  dispose(): void;
}

const TEST_SESSION_ID = 'test-session-00000000';
const TEST_TENANT_ID = 'test-tenant';
const TEST_WORKSPACE_ID = 'test-workspace';
const TEST_HOST_ID = 'test-host-deterministic';
const TEST_PRINCIPAL_SUBJECT = 'test-user-001';
const TEST_DOCUMENT_ID = 'test-doc-001';
const FIXED_TIMESTAMP = 1700000000000;

export function createDeterministicTestHost(
  options: DeterministicTestHostOptions = {},
): DeterministicTestHost {
  const capturedDiagnostics: HostDiagnosticEvent[] = [];
  let clockNow = FIXED_TIMESTAMP;

  const diagnosticsSink: HostDiagnosticsSink = {
    emit(event: HostDiagnosticEvent): void {
      capturedDiagnostics.push(event);
    },
  };

  const clock: HostClock = {
    now: () => clockNow,
    dateNow: () => clockNow,
    performanceNow: () => clockNow - FIXED_TIMESTAMP,
  };

  const session: HostSession = {
    sessionId: options.sessionId ?? TEST_SESSION_ID,
    tenantId: options.tenantId ?? TEST_TENANT_ID,
    workspaceId: options.workspaceId ?? TEST_WORKSPACE_ID,
    locale: 'en-US',
    userTimezone: 'UTC',
    mode: 'test',
    createdAt: FIXED_TIMESTAMP,
    correlationRootId: `corr-${options.sessionId ?? TEST_SESSION_ID}`,
  };

  const principal: VerifiedPrincipal = {
    issuer: { issuerId: 'test-issuer', issuerKind: 'test' },
    subjectId: options.principalSubjectId ?? TEST_PRINCIPAL_SUBJECT,
    tenantId: options.tenantId ?? TEST_TENANT_ID,
    workspaceId: options.workspaceId ?? TEST_WORKSPACE_ID,
    actorKind: 'test',
    tags: [...(options.principalTags ?? [])].sort(),
  };

  const timezone: HostTimezonePolicy = {
    userTimezone: 'UTC',
    source: 'test-fixture',
    processTimezoneMayBeUsed: false,
  };

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

  const documentAuthorization = {
    async authorize(request: HostDocumentAuthorizationRequest): Promise<HostAuthorizationDecision> {
      const storageHandoff: AuthorizedDocumentStorageHandoff = {
        operation: 'create' as const,
        decisionId: `decision-${Date.now()}`,
        correlationId: request.correlationId,
        sessionId: session.sessionId,
        nonce: `nonce-${Date.now()}`,
        expiresAt: FIXED_TIMESTAMP + 3600000,
        storageConstraint: options.storageConstraint ?? 'ephemeral',
        principal,
        resourceContext: request.resourceContext,
        documentRef: request.documentRef,
        sourceHostId: TEST_HOST_ID,
        storageIntentFingerprint,
        rawBytesPolicy: {
          kind: 'trusted-raw-provider-boundary',
          boundary: 'test-fixture',
          rawProviderBytesMayReachUntrustedClient: false,
        },
        authorizedProviders: [],
        storage: {
          intent: 'create',
          durability: 'ephemeral',
          providers: [],
          requireDurabilityBeforeReady: false,
          allowReadOnlyFallback: false,
        },
      };

      return {
        allowed: true,
        decisionId: storageHandoff.decisionId,
        correlationId: request.correlationId,
        authorizedAt: clockNow,
        storageConstraint: storageHandoff.storageConstraint,
        handoff: storageHandoff,
      };
    },
  };

  const capabilities: HostCapabilityLookup = {
    async decide(request: HostCapabilityRequest): Promise<HostCapabilityDecision> {
      const allowed =
        options.capabilityDecisions?.get(request.subject.capability as string) ?? true;
      if (allowed) {
        return {
          allowed: true,
          decisionId: `cap-decision-${Date.now()}`,
          correlationId: request.correlationId,
          decidedAt: clockNow,
          operation: request.operation,
          subject: request.subject,
          enforcement: trustProfile.enforcement,
        };
      }
      return {
        allowed: false,
        decisionId: `cap-decision-${Date.now()}`,
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

  const runtimeConfig: KernelRuntimeConfig = {
    kind: 'test',
    deterministic: true,
  };
  const storageIntentFingerprint = createHostCanonicalFingerprint({
    openIntent: 'create',
    durability: 'ephemeral',
    rawBytesPolicy: {
      kind: 'trusted-raw-provider-boundary',
      boundary: 'test-fixture',
      rawProviderBytesMayReachUntrustedClient: false,
    },
    requestedConstraint: options.storageConstraint ?? 'ephemeral',
    providers: [],
  });

  const kernelHostContext: KernelHostContext = {
    session,
    principal,
    documentAuthorization,
    storage: {
      operation: 'create',
      decisionId: 'initial-decision',
      correlationId: session.correlationRootId,
      sessionId: session.sessionId,
      nonce: 'initial-nonce',
      expiresAt: FIXED_TIMESTAMP + 3600000,
      storageConstraint: options.storageConstraint ?? 'ephemeral',
      principal,
      resourceContext: {
        tenantId: session.tenantId,
        workspaceId: session.workspaceId,
        documentId: options.documentId ?? TEST_DOCUMENT_ID,
        resolutionSource: 'test-fixture',
      },
      sourceHostId: TEST_HOST_ID,
      storageIntentFingerprint,
      rawBytesPolicy: {
        kind: 'trusted-raw-provider-boundary',
        boundary: 'test-fixture',
        rawProviderBytesMayReachUntrustedClient: false,
      },
      authorizedProviders: [],
      storage: {
        intent: 'create',
        durability: 'ephemeral',
        providers: [],
        requireDurabilityBeforeReady: false,
        allowReadOnlyFallback: false,
      },
    },
    runtime: runtimeConfig,
    capabilities,
    diagnostics: diagnosticsSink,
    clock,
    timezone,
  };

  const runtimeHostContext: RuntimeHostContext = {
    kernel: runtimeConfig,
    assetPolicy: {
      assetIntegrityPolicy: 'test-fixture',
    },
    disposalPolicy: {
      onTrap: 'surface-error',
      onProviderFailure: 'test-capture',
    },
    diagnostics: diagnosticsSink,
  };

  // Branded construction — only allowed in trusted adapter factories and test fixtures.
  // The unique symbol brand prevents accidental construction by external code.
  const context = {
    hostSurface: 'document-host',
    hostId: TEST_HOST_ID,
    kind: 'test',
    trust: trustProfile,
    diagnostics: diagnosticsSink,
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
    get diagnostics() {
      return capturedDiagnostics;
    },
    clock: {
      get now() {
        return clockNow;
      },
      set now(v: number) {
        clockNow = v;
      },
    },
    dispose() {
      // no-op
    },
  };
}
