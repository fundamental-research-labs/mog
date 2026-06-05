/**
 * Node headless SDK host adapter.
 *
 * Creates a fully-wired `TrustedDocumentHostContext` for headless SDK usage —
 * automation, ETL, CI, agents running in the same trusted process.
 *
 * This adapter is classified as cooperative local/trusted process, NOT a
 * security boundary for untrusted agents, HTTP clients, plugins, or
 * external API callers.
 *
 * The branded `TrustedDocumentHostContext` cast is intentionally allowed
 * here — this is a trusted adapter factory module. No other production code
 * should construct the branded context directly.
 *
 * NOT exported from @mog-sdk/node public surface.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import type { TrustedDocumentHostContext } from '@mog-sdk/types-host/trusted';
import type {
  KernelHostContext,
  HostSession,
  HostClock,
  HostTimezonePolicy,
  HostAuthorizationDecision,
  HostDocumentAuthorizationRequest,
  AuthorizedExportMaterializationHandoff,
  AuthorizedDocumentStorageHandoff,
  HostDocumentAuthorizationService,
  HostDocumentResourceContext,
} from '@mog-sdk/types-host/kernel';
import type { RuntimeHostContext, KernelRuntimeConfig } from '@mog-sdk/types-host/runtime';
import type { VerifiedPrincipal } from '@mog-sdk/types-host/identity';
import type {
  HostCapabilityLookup,
  HostCapabilityRequest,
  HostCapabilityDecision,
} from '@mog-sdk/types-host/capabilities';
import type { HostTrustProfile } from '@mog-sdk/types-host/trust';
import type { HostDiagnosticsSink, HostDiagnosticEvent } from '@mog-sdk/types-host/diagnostics';
import type {
  HostKernelAdapterBindings,
  HandoffReplayKey,
  HostHandoffReplayRegistry,
  HostTransportBindingRegistry,
  HostTransportBinding,
  HostProviderMaterializerRegistry,
  HostSourceHandleResolverRegistry,
  SourceHandleResolveRequest,
  SourceHandleResolveResult,
} from '@mog-sdk/types-host/bindings';
import type { HostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOST_ID = 'node-headless-sdk-host' as const;
const HANDOFF_TTL_MS = 3_600_000; // 1 hour

function getRequireFromHere(): NodeRequire {
  return createRequire(import.meta.url);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface NodeHeadlessHostConfig {
  /** Unique document identifier. */
  readonly documentId: string;

  /** Document operation. Defaults to 'create'. */
  readonly operation?: 'create' | 'open' | 'import';

  /** Native addon resolution strategy. Defaults to 'public-platform-package'. */
  readonly addonResolution?: 'public-platform-package' | 'host-provided-path';

  /** Worker thread policy. Defaults to 'main-thread'. */
  readonly workerPolicy?: 'main-thread' | 'worker-thread';

  /**
   * IANA timezone string. REQUIRED — the adapter does not read process.env.TZ
   * or Intl defaults. The caller must provide an explicit timezone.
   */
  readonly timezone: string;

  /** BCP-47 locale. Defaults to 'en-US'. */
  readonly locale?: string;

  /**
   * Trusted local XLSX import bytes. The adapter wraps these bytes in a
   * single-use source handle so kernel import exercises the host boundary
   * contract instead of falling back to raw public options.
   */
  readonly importBytes?: Uint8Array;

  /**
   * Cooperative process-owner metadata. NOT a VerifiedPrincipal — only
   * advisory fields for tracing. No security decisions are made from these.
   */
  readonly principal?: {
    readonly subjectId?: string;
    readonly tags?: readonly string[];
  };

  /**
   * Optional diagnostics logger for host/kernel events emitted while the SDK
   * constructs, imports, opens, exports, or disposes a workbook. Omit for the
   * default silent/noop behavior.
   */
  readonly logger?: MogSdkLogger | false;

  /**
   * Enable default console-backed diagnostics for local debugging. This is
   * also enabled by MOG_SDK_DEBUG=1/true/yes or MOG_DEBUG=1/true/yes.
   */
  readonly debug?: boolean;
}

export interface MogSdkLogger {
  debug?(...args: unknown[]): void;
  info?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface NodeHeadlessHostResult {
  /** The branded trusted document host context. */
  readonly context: TrustedDocumentHostContext;

  /** The kernel host context (extracted from context.kernel for convenience). */
  readonly kernelContext: KernelHostContext;

  /** The adapter bindings (HostKernelAdapterBindings). */
  readonly bindings: HostKernelAdapterBindings;

  /** Tear down the host and release resources. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function createReplayRegistry(): HostHandoffReplayRegistry {
  const consumed = new Set<string>();

  function serializeKey(key: HandoffReplayKey): string {
    return `${key.sourceHostId}:${key.sessionId}:${key.decisionId}:${key.operation}:${key.nonce}:${key.resourceFingerprint}`;
  }

  return {
    consumeOnce(key: HandoffReplayKey): boolean {
      const serialized = serializeKey(key);
      if (consumed.has(serialized)) {
        return false;
      }
      consumed.add(serialized);
      return true;
    },
  };
}

function isDebugEnabled(config: Pick<NodeHeadlessHostConfig, 'debug'>): boolean {
  if (config.debug !== undefined) return config.debug;
  const value = process.env.MOG_SDK_DEBUG ?? process.env.MOG_DEBUG;
  return value === '1' || value === 'true' || value === 'yes';
}

function createDiagnosticsSink(config: NodeHeadlessHostConfig): HostDiagnosticsSink {
  const logger =
    config.logger === false
      ? undefined
      : (config.logger ?? (isDebugEnabled(config) ? console : undefined));

  return {
    emit(event: HostDiagnosticEvent): void {
      if (!logger) return;

      const kind = event.kind;
      if (
        kind === 'identity.denied' ||
        kind === 'documentAuthorization.denied' ||
        kind === 'capability.denied' ||
        kind === 'hostConstruction.invalid' ||
        kind === 'access.denied' ||
        kind === 'access.ambiguity'
      ) {
        logger.warn?.(`[mog:host:${kind}]`, event);
      } else {
        logger.debug?.(`[mog:host:${kind}]`, event);
      }
    },
  };
}

function canonicalJsonStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJsonStringify(v)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(obj[key])}`)
      .join(',')}}`;
  }

  return 'null';
}

function computeCanonicalFingerprint(value: unknown): HostCanonicalFingerprint {
  const canonical = canonicalJsonStringify(value);
  const digest = createHash('sha256').update(canonical).digest('hex');
  return `mog-host-fp:v1:sha256:${digest}` as HostCanonicalFingerprint;
}

function computeByteContentIdentity(bytes: Uint8Array) {
  return {
    kind: 'immutable-byte-handle' as const,
    handleFingerprint: computeCanonicalFingerprint({
      bytes: Array.from(bytes),
      sizeBytes: bytes.byteLength,
    }),
    sizeBytes: bytes.byteLength,
  };
}

function getPlatformPackageName(): string {
  if (process.platform === 'darwin') return `@mog-sdk/darwin-${process.arch}`;
  if (process.platform === 'win32' && process.arch === 'x64') return '@mog-sdk/win32-x64-msvc';
  if (process.platform === 'linux') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const report = process.report?.getReport?.() as
      | { readonly header?: { readonly glibcVersionRuntime?: string } }
      | undefined;
    const libc = report?.header?.glibcVersionRuntime ? 'gnu' : 'musl';
    return `@mog-sdk/linux-${arch}-${libc}`;
  }
  throw new Error(
    `Unsupported platform for @mog-sdk/node native runtime: ${process.platform}/${process.arch}`,
  );
}

export function loadNodeSdkNapiAddon(): Record<string, (...args: unknown[]) => unknown> {
  return getRequireFromHere()(getPlatformPackageName()) as Record<
    string,
    (...args: unknown[]) => unknown
  >;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createNodeHeadlessHost(config: NodeHeadlessHostConfig): NodeHeadlessHostResult {
  const now = Date.now();
  const sessionId = randomUUID();
  const operation = config.operation ?? 'create';
  const addonResolution = config.addonResolution ?? 'public-platform-package';
  const workerPolicy = config.workerPolicy ?? 'main-thread';
  const locale = config.locale ?? 'en-US';
  const subjectId = config.principal?.subjectId ?? `node-process-${process.pid}`;
  const tags = config.principal?.tags ? [...config.principal.tags].sort() : [];

  // --- Diagnostics ---

  const diagnosticsSink = createDiagnosticsSink(config);

  // --- Clock ---

  const clock: HostClock = {
    now: () => Date.now(),
    dateNow: () => Date.now(),
    performanceNow: () => performance.now(),
  };

  // --- Session ---

  const session: HostSession = {
    sessionId,
    tenantId: { kind: 'single-tenant' },
    workspaceId: { kind: 'no-workspace' },
    locale,
    userTimezone: config.timezone,
    mode: 'automation',
    createdAt: now,
    correlationRootId: `corr-${sessionId}`,
  };

  // --- Principal ---

  const principal: VerifiedPrincipal = {
    issuer: {
      issuerId: 'node-headless-sdk',
      issuerKind: 'trusted-node-process',
    },
    subjectId,
    tenantId: { kind: 'single-tenant' },
    workspaceId: { kind: 'no-workspace' },
    actorKind: 'user',
    tags,
  };

  // --- Timezone ---

  const timezone: HostTimezonePolicy = {
    userTimezone: config.timezone,
    source: 'trusted-session-metadata',
    processTimezoneMayBeUsed: false,
  };

  // --- Trust Profile ---

  const trustProfile: HostTrustProfile = {
    mode: 'cooperative-local',
    identityAssertion: 'trusted-process',
    enforcement: {
      identity: 'none-cooperative',
      protocol: 'none-cooperative',
      capability: 'none-cooperative',
      workbookAccess: 'rust-policy-engine',
      storage: 'none-cooperative',
    },
    isolation: 'trusted-same-process',
  };

  // --- Document Resource Context ---

  const resourceContext: HostDocumentResourceContext = {
    tenantId: { kind: 'single-tenant' },
    workspaceId: { kind: 'no-workspace' },
    documentId: config.documentId,
    resolutionSource: 'trusted-adapter',
  };
  const principalFingerprint = computeCanonicalFingerprint(principal);
  const resourceContextFingerprint = computeCanonicalFingerprint(resourceContext);
  const handoffExpiry = now + HANDOFF_TTL_MS;

  const importSourceHandleId = config.importBytes ? randomUUID() : null;
  const importSourceIssuanceId = config.importBytes ? randomUUID() : null;
  const importContentIdentity = config.importBytes
    ? computeByteContentIdentity(config.importBytes)
    : null;
  const importDocumentRef =
    config.importBytes && importSourceHandleId && importSourceIssuanceId
      ? {
          kind: 'source-handle' as const,
          sourceHandleId: importSourceHandleId,
          issuance: {
            source: 'trusted-source-handle-registry' as const,
            issuanceId: importSourceIssuanceId,
            issuerHostId: HOST_ID,
            contentIdentity: importContentIdentity!,
            issuedAt: now,
            expiresAt: handoffExpiry,
          },
          sourceKind: 'uploaded-bytes' as const,
          issuerHostId: HOST_ID,
          sourceHostId: HOST_ID,
          sourceSessionId: sessionId,
          principalFingerprint,
          resourceContext,
          expiresAt: handoffExpiry,
          singleUse: true as const,
        }
      : undefined;

  // --- Storage Handoff ---

  const decisionId = randomUUID();
  const nonce = randomUUID();

  const intent =
    operation === 'create' ? 'create' : operation === 'import' ? 'importInitialize' : 'open';
  const storageIntentFingerprint = computeCanonicalFingerprint({
    openIntent: intent,
    durability: 'ephemeral',
    rawBytesPolicy: {
      kind: 'trusted-raw-provider-boundary',
      boundary: 'same-principal-local',
      rawProviderBytesMayReachUntrustedClient: false,
    },
    requestedConstraint: 'ephemeral',
    providers: [],
  });

  const storageHandoff: AuthorizedDocumentStorageHandoff = {
    operation,
    decisionId,
    correlationId: session.correlationRootId,
    sessionId,
    nonce,
    expiresAt: handoffExpiry,
    storageConstraint: 'ephemeral',
    principal,
    resourceContext,
    documentRef: importDocumentRef,
    sourceHostId: HOST_ID,
    storageIntentFingerprint,
    rawBytesPolicy: {
      kind: 'trusted-raw-provider-boundary',
      boundary: 'same-principal-local',
      rawProviderBytesMayReachUntrustedClient: false,
    },
    authorizedProviders: [],
    storage: {
      intent,
      durability: 'ephemeral',
      providers: [],
      requireDurabilityBeforeReady: false,
      allowReadOnlyFallback: false,
    },
  };

  // --- Document Authorization Service ---

  const documentAuthorization: HostDocumentAuthorizationService = {
    async authorize(request: HostDocumentAuthorizationRequest): Promise<HostAuthorizationDecision> {
      const reqDecisionId = randomUUID();
      const reqNonce = randomUUID();
      const reqOperation = request.details.operation;

      // Session operations: create/open/import — always allow with ephemeral handoff.
      if (reqOperation === 'create' || reqOperation === 'open' || reqOperation === 'import') {
        const reqIntent =
          reqOperation === 'create'
            ? 'create'
            : reqOperation === 'import'
              ? 'importInitialize'
              : 'open';
        const reqStorageIntentFingerprint = computeCanonicalFingerprint({
          openIntent: reqIntent,
          durability: 'ephemeral',
          rawBytesPolicy: {
            kind: 'trusted-raw-provider-boundary',
            boundary: 'same-principal-local',
            rawProviderBytesMayReachUntrustedClient: false,
          },
          requestedConstraint: 'ephemeral',
          providers: [],
        });
        const sessionHandoff: AuthorizedDocumentStorageHandoff = {
          operation: reqOperation,
          decisionId: reqDecisionId,
          correlationId: request.correlationId,
          sessionId,
          nonce: reqNonce,
          expiresAt: Date.now() + HANDOFF_TTL_MS,
          storageConstraint: 'ephemeral',
          principal,
          resourceContext: request.resourceContext,
          documentRef:
            request.documentRef ?? (reqOperation === 'import' ? importDocumentRef : undefined),
          sourceHostId: HOST_ID,
          storageIntentFingerprint: reqStorageIntentFingerprint,
          rawBytesPolicy: {
            kind: 'trusted-raw-provider-boundary',
            boundary: 'same-principal-local',
            rawProviderBytesMayReachUntrustedClient: false,
          },
          authorizedProviders: [],
          storage: {
            intent: reqIntent,
            durability: 'ephemeral',
            providers: [],
            requireDurabilityBeforeReady: false,
            allowReadOnlyFallback: false,
          },
        };

        return {
          allowed: true,
          decisionId: reqDecisionId,
          correlationId: request.correlationId,
          authorizedAt: Date.now(),
          storageConstraint: 'ephemeral',
          handoff: sessionHandoff,
        };
      }

      // Export: allow for the trusted same-process headless SDK path when the
      // kernel supplies a fresh write-gate high-water proof.
      if (reqOperation === 'export') {
        const details = request.details;
        if (details.operation !== 'export') {
          return {
            allowed: false,
            decisionId: reqDecisionId,
            correlationId: request.correlationId,
            decidedAt: Date.now(),
            code: 'INVALID_EXPORT_REQUEST',
            reason: 'Export request details were not present on export authorization request',
          };
        }
        if (details.contentPolicy.kind !== 'authorized-raw-snapshot') {
          return {
            allowed: false,
            decisionId: reqDecisionId,
            correlationId: request.correlationId,
            decidedAt: Date.now(),
            code: 'UNSUPPORTED_EXPORT_CONTENT_POLICY',
            reason: `Node headless export does not support content policy '${details.contentPolicy.kind}'`,
          };
        }

        const exportHandoff: AuthorizedExportMaterializationHandoff = {
          operation: 'export',
          decisionId: reqDecisionId,
          correlationId: request.correlationId,
          sessionId,
          nonce: reqNonce,
          expiresAt: Date.now() + HANDOFF_TTL_MS,
          principal,
          resourceContext: request.resourceContext,
          documentRef: request.documentRef,
          sourceHostId: HOST_ID,
          rawBytesPolicy: {
            kind: 'trusted-raw-provider-boundary',
            boundary: 'same-principal-local',
            rawProviderBytesMayReachUntrustedClient: false,
          },
          exportMaterialization: {
            grantKind: 'export-byte-materialization',
            decisionId: reqDecisionId,
            correlationId: request.correlationId,
            format: details.format,
            exportPathId: details.exportPathId,
            documentHighWaterMark: details.documentHighWaterMark,
            contentPolicy: details.contentPolicy,
            destination: details.destination,
            exportSinkRefs: details.requestedExportSinkRefs,
            materializationNonce: reqNonce,
            expiresAt: Date.now() + HANDOFF_TTL_MS,
          },
        };

        return {
          allowed: true,
          decisionId: reqDecisionId,
          correlationId: request.correlationId,
          authorizedAt: Date.now(),
          handoff: exportHandoff,
        };
      }

      // Management operations (share/delete/destroy): deny for headless.
      return {
        allowed: false,
        decisionId: reqDecisionId,
        correlationId: request.correlationId,
        decidedAt: Date.now(),
        code: 'MANAGEMENT_NOT_AVAILABLE',
        reason: `Management operation '${reqOperation}' is not available in the Node headless SDK host adapter`,
      };
    },
  };

  // --- Capability Lookup ---

  const capabilities: HostCapabilityLookup = {
    async decide(request: HostCapabilityRequest): Promise<HostCapabilityDecision> {
      // Cooperative local: always allow all capabilities.
      return {
        allowed: true,
        decisionId: randomUUID(),
        correlationId: request.correlationId,
        decidedAt: Date.now(),
        operation: request.operation,
        subject: request.subject,
        enforcement: trustProfile.enforcement,
      };
    },
  };

  // --- Runtime Config ---

  const runtimeConfig: KernelRuntimeConfig = {
    kind: 'node-napi',
    addonResolution,
    workerPolicy,
  };

  // --- KernelHostContext ---

  const kernelHostContext: KernelHostContext = {
    session,
    principal,
    documentAuthorization,
    storage: storageHandoff,
    runtime: runtimeConfig,
    capabilities,
    diagnostics: diagnosticsSink,
    clock,
    timezone,
  };

  // --- RuntimeHostContext ---

  const runtimeHostContext: RuntimeHostContext = {
    kernel: runtimeConfig,
    assetPolicy: {
      assetIntegrityPolicy: 'same-origin',
    },
    disposalPolicy: {
      onTrap: 'surface-error',
      onProviderFailure: 'fail-closed',
    },
    diagnostics: diagnosticsSink,
  };

  // --- Adapter Bindings ---

  const replayRegistry = createReplayRegistry();

  const transportBindings: HostTransportBindingRegistry = {
    has(runtimeKind: string): boolean {
      return runtimeKind === 'node-napi';
    },
    resolve(runtimeKind: string): HostTransportBinding {
      return {
        runtimeKind,
        createTransportConfig(): unknown {
          return {
            kind: 'headless',
            explicitRuntime: 'napi',
            addonResolution,
            workerPolicy,
            napiAddon: loadNodeSdkNapiAddon(),
          };
        },
      };
    },
  };

  const providerMaterializers: HostProviderMaterializerRegistry = {
    has(_providerRefId: string): boolean {
      return false; // Ephemeral mode — no provider materializers.
    },
    async resolve(_request) {
      throw new Error(
        'Node headless SDK host: provider materializers are not available in ephemeral mode',
      );
    },
  };

  const sourceHandleResolvers: HostSourceHandleResolverRegistry = {
    has(sourceKind: string): boolean {
      return sourceKind === 'uploaded-bytes' && Boolean(config.importBytes && importSourceHandleId);
    },
    async resolve(request: SourceHandleResolveRequest): Promise<SourceHandleResolveResult> {
      if (
        request.sourceKind !== 'uploaded-bytes' ||
        !config.importBytes ||
        !importSourceHandleId ||
        !importContentIdentity ||
        request.sourceHandleId !== importSourceHandleId ||
        request.issuerHostId !== HOST_ID ||
        request.sourceHostId !== HOST_ID ||
        request.sourceSessionId !== sessionId ||
        request.sessionId !== sessionId ||
        request.expiresAt !== handoffExpiry ||
        request.singleUse !== true ||
        request.principalFingerprint !== principalFingerprint ||
        request.resourceContextFingerprint !== resourceContextFingerprint ||
        computeCanonicalFingerprint(request.resourceContext) !== resourceContextFingerprint ||
        request.expectedContentIdentity.kind !== 'immutable-byte-handle' ||
        request.expectedContentIdentity.handleFingerprint !==
          importContentIdentity.handleFingerprint
      ) {
        throw new Error(
          'Node headless SDK host: source handle resolver rejected unauthorized request',
        );
      }
      return {
        bytes: config.importBytes,
        contentIdentity: importContentIdentity,
        contentIdentityVerified: true,
        sourceHandleId: request.sourceHandleId,
      };
    },
  };

  const bindings: HostKernelAdapterBindings = {
    providerMaterializers,
    sourceHandleResolvers,
    replayRegistry,
    transportBindings,
  };

  // --- TrustedDocumentHostContext (branded cast) ---

  const context = {
    hostSurface: 'document-host',
    hostId: HOST_ID,
    kind: 'node-sdk',
    trust: trustProfile,
    diagnostics: diagnosticsSink,
    kernel: kernelHostContext,
    runtime: runtimeHostContext,
    view: undefined,
    shell: undefined,
    dispose(): void {
      // Cleanup — currently no external resources to release.
    },
  } as unknown as TrustedDocumentHostContext;

  return {
    context,
    kernelContext: kernelHostContext,
    bindings,
    dispose(): void {
      // Tear down — currently no external resources to release.
    },
  };
}
