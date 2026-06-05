/**
 * Standalone browser shell host adapter.
 *
 * Creates a fully-wired `TrustedDocumentHostContext` for the standalone
 * browser shell. This is the production adapter for running Mog as a
 * standalone web application (no workspace host, no Tauri).
 *
 * The branded `TrustedDocumentHostContext` cast is intentionally allowed
 * here — this is a trusted adapter factory module. No other production
 * code should construct the branded context directly.
 *
 * This file is NOT exported from @mog/shell's public surface.
 */

import type { TrustedDocumentHostContext, TrustedHostKind } from '@mog-sdk/types-host/trusted';
import type {
  KernelHostContext,
  HostWorkbookLinkResolver,
  HostSession,
  HostClock,
  HostTimezonePolicy,
  HostAuthorizationDecision,
  HostDocumentAuthorizationRequest,
  AuthorizedDocumentStorageHandoff,
  AuthorizedExportMaterializationHandoff,
  HostDocumentAuthorizationService,
  HostDocumentResourceContext,
  AuthorizedDocumentManagementHandoff,
  HostDocumentSessionOperation,
} from '@mog-sdk/types-host/kernel';
import type { RuntimeHostContext, KernelRuntimeConfig } from '@mog-sdk/types-host/runtime';
import type { ViewHostContext } from '@mog-sdk/types-host/view';
import type { ShellHostContext } from '@mog-sdk/types-host/shell';
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
  ProviderMaterializerAttachOptions,
  ProviderMaterializerRequest,
  SourceHandleResolveRequest,
  SourceHandleResolveResult,
} from '@mog-sdk/types-host/bindings';
import type { HostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';
import { createHostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';
import type { IndexedDbProviderConfig } from '@mog-sdk/types-document/storage/provider-configs';
import type { CollaborationSidecar, DocumentHandle } from '@mog-sdk/kernel';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOST_ID = 'standalone-browser-shell-host';
const HOST_KIND: TrustedHostKind = 'standalone-shell';
const HANDOFF_TTL_MS = 3600000; // 1 hour
const INDEXEDDB_DATABASE_NAME = 'shortcut-rust-docs';
const INDEXEDDB_STORE_NAME = 'snapshots';
const INDEXEDDB_SCHEMA_VERSION = 2;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface StandaloneBrowserShellConfig {
  /** Document ID for this session. */
  readonly documentId: string;
  /** WASM module base URL. */
  readonly wasmBaseUrl: string;
  /** Worker script URL. */
  readonly workerUrl: string;
  /** Operation mode — defaults to 'create'. */
  readonly operation?: 'create' | 'open' | 'import';
  /** Trusted same-realm import bytes, wrapped as a single-use source handle. */
  readonly importBytes?: Uint8Array;
  /** Locale override — defaults to navigator.language. */
  readonly locale?: string;
  /** Chrome theme override. */
  readonly chromeTheme?: {
    readonly colorScheme: 'light' | 'dark' | 'system';
    readonly density: 'compact' | 'comfortable';
  };
  /** CSS/font base URL. */
  readonly staticAssetBase?: string;
  /** Trusted resolver for cross-workbook links opened by this document. */
  readonly workbookLinkResolver?: HostWorkbookLinkResolver;
  /**
   * When true, the storage handoff uses `durability: 'ephemeral'` with no
   * providers — no IndexedDB, no Web Locks, no local persistence.
   * Use when the host owns persistence (e.g., `persistenceMode: 'host-owned-ephemeral'`).
   */
  readonly skipLocalPersistence?: boolean;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface StandaloneBrowserShellResult {
  /** The branded trusted document host context. */
  readonly context: TrustedDocumentHostContext;
  /** The kernel host context (extracted for convenience). */
  readonly kernelContext: KernelHostContext;
  /** The adapter bindings. */
  readonly bindings: HostKernelAdapterBindings;
  /** Tear down the host. */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Replay Registry (in-memory, Set-based)
// ---------------------------------------------------------------------------

function serializeReplayKey(key: HandoffReplayKey): string {
  return `${key.sourceHostId}:${key.sessionId}:${key.decisionId}:${key.operation}:${key.nonce}:${key.resourceFingerprint}`;
}

function createBrowserReplayRegistry(): HostHandoffReplayRegistry {
  const consumed = new Set<string>();
  return {
    consumeOnce(key: HandoffReplayKey): boolean {
      const serialized = serializeReplayKey(key);
      if (consumed.has(serialized)) {
        return false;
      }
      consumed.add(serialized);
      return true;
    },
  };
}

function computeByteContentIdentity(bytes: Uint8Array) {
  return {
    kind: 'immutable-byte-handle' as const,
    handleFingerprint: createHostCanonicalFingerprint({
      bytes: Array.from(bytes),
      sizeBytes: bytes.byteLength,
    }),
    sizeBytes: bytes.byteLength,
  };
}

function providerRefIdForDocument(documentId: string): string {
  return `indexeddb:${documentId}`;
}

function createStandaloneIndexedDbProviderConfig(documentId: string): IndexedDbProviderConfig {
  const storageScope = {
    tenantId: { kind: 'single-tenant' as const },
    workspaceId: { kind: 'no-workspace' as const },
    documentId,
  };
  const redactedConfigFingerprint = createHostCanonicalFingerprint({
    kind: 'indexeddb',
    role: 'authority',
    providerRefId: providerRefIdForDocument(documentId),
    storageScope,
    databaseName: INDEXEDDB_DATABASE_NAME,
    storeName: INDEXEDDB_STORE_NAME,
    schemaVersion: INDEXEDDB_SCHEMA_VERSION,
  });

  return {
    kind: 'indexeddb',
    role: 'authority',
    required: true,
    providerRefId: providerRefIdForDocument(documentId),
    storageScope: {
      kind: 'scoped',
      scope: storageScope,
    },
    redactedConfigFingerprint,
    contractVersion: '03.1',
    providerProtocolVersion: '1.0',
    storageSchemaVersion: String(INDEXEDDB_SCHEMA_VERSION),
    databaseName: INDEXEDDB_DATABASE_NAME,
    storeName: INDEXEDDB_STORE_NAME,
    schemaVersion: INDEXEDDB_SCHEMA_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Diagnostics Sink (console-based)
// ---------------------------------------------------------------------------

function createBrowserDiagnosticsSink(): HostDiagnosticsSink {
  return {
    emit(event: HostDiagnosticEvent): void {
      const prefix = `[mog-host:${event.kind}] corr=${event.correlationId}`;
      if (
        event.kind === 'identity.denied' ||
        event.kind === 'documentAuthorization.denied' ||
        event.kind === 'capability.denied' ||
        event.kind === 'hostConstruction.invalid' ||
        event.kind === 'storage.failure' ||
        event.kind === 'access.denied' ||
        event.kind === 'access.ambiguity' ||
        event.kind === 'runtime.assetFailure'
      ) {
        // All current diagnostic event kinds are warning-level
        console.warn(prefix, event);
      } else {
        console.debug(prefix, event);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createStandaloneBrowserShellHost(
  config: StandaloneBrowserShellConfig,
): StandaloneBrowserShellResult {
  const diagnosticsSink = createBrowserDiagnosticsSink();

  const sessionId = crypto.randomUUID();
  const correlationRootId = `corr-${sessionId}`;
  const locale = config.locale ?? navigator.language;
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = Date.now();

  // --- Trust Profile ---

  const trustProfile: HostTrustProfile = {
    mode: 'trusted-first-party-browser',
    identityAssertion: 'cooperative-caller',
    enforcement: {
      identity: 'none-cooperative',
      protocol: 'none-cooperative',
      capability: 'none-cooperative',
      workbookAccess: 'rust-policy-engine',
      storage: 'none-cooperative',
    },
    isolation: 'cooperative-same-realm',
  };

  // --- Session ---

  const session: HostSession = {
    sessionId,
    tenantId: { kind: 'single-tenant' },
    workspaceId: { kind: 'no-workspace' },
    locale,
    userTimezone,
    mode: 'interactive',
    createdAt: now,
    correlationRootId,
  };

  // --- Principal ---

  const principal: VerifiedPrincipal = {
    issuer: {
      issuerId: 'standalone-browser-shell',
      issuerKind: 'mog-hosted',
    },
    subjectId: crypto.randomUUID(),
    tenantId: { kind: 'single-tenant' },
    workspaceId: { kind: 'no-workspace' },
    actorKind: 'user',
    tags: [],
  };

  // --- Timezone ---

  const timezone: HostTimezonePolicy = {
    userTimezone,
    source: 'browser-user-device',
    processTimezoneMayBeUsed: false,
  };

  // --- Clock ---

  const clock: HostClock = {
    now: () => Date.now(),
    dateNow: () => Date.now(),
    performanceNow: () => performance.now(),
  };

  // --- Runtime Config ---

  const runtimeConfig: KernelRuntimeConfig = {
    kind: 'browser-wasm-worker',
    wasmBaseUrl: config.wasmBaseUrl,
    workerUrl: config.workerUrl,
    cspPolicy: 'strict',
    memoryPolicy: 'default',
  };

  // --- Document Resource Context ---

  const resourceContext: HostDocumentResourceContext = {
    tenantId: { kind: 'single-tenant' },
    workspaceId: { kind: 'no-workspace' },
    documentId: config.documentId,
    resolutionSource: 'trusted-adapter',
  };
  const principalFingerprint = createHostCanonicalFingerprint(principal);
  const resourceContextFingerprint = createHostCanonicalFingerprint(resourceContext);

  // --- Storage Handoff ---

  const operation: HostDocumentSessionOperation = config.operation ?? 'create';
  const intent =
    operation === 'create' ? 'create' : operation === 'import' ? 'importInitialize' : 'open';

  const decisionId = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const handoffCorrelationId = crypto.randomUUID();
  const handoffExpiresAt = now + HANDOFF_TTL_MS;
  const issuedStorageHandoffs = new Map<
    string,
    {
      readonly nonce: string;
      readonly expiresAt: number;
      readonly principalFingerprint: HostCanonicalFingerprint;
      readonly resourceContextFingerprint: HostCanonicalFingerprint;
      readonly providerConfig: IndexedDbProviderConfig;
      readonly storageScope: {
        readonly tenantId: string | { readonly kind: 'single-tenant' };
        readonly workspaceId: string | { readonly kind: 'no-workspace' };
        readonly documentId?: string;
      };
    }
  >();

  const importSourceHandleId = config.importBytes ? crypto.randomUUID() : null;
  const importSourceIssuanceId = config.importBytes ? crypto.randomUUID() : null;
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
            expiresAt: handoffExpiresAt,
          },
          sourceKind: 'uploaded-bytes' as const,
          issuerHostId: HOST_ID,
          sourceHostId: HOST_ID,
          sourceSessionId: sessionId,
          principalFingerprint,
          resourceContext,
          expiresAt: handoffExpiresAt,
          singleUse: true as const,
        }
      : undefined;

  function createStorageHandoff(input: {
    readonly operation: HostDocumentSessionOperation;
    readonly intent: typeof intent;
    readonly decisionId: string;
    readonly correlationId: string;
    readonly nonce: string;
    readonly expiresAt: number;
    readonly resourceContext: HostDocumentResourceContext;
    readonly documentRef?: AuthorizedDocumentStorageHandoff['documentRef'];
  }): AuthorizedDocumentStorageHandoff {
    const documentId = input.resourceContext.documentId ?? config.documentId;
    const ephemeral = config.skipLocalPersistence === true;

    if (ephemeral) {
      const storageIntentFingerprint = createHostCanonicalFingerprint({
        openIntent: input.intent,
        durability: 'ephemeral',
        documentId,
      });
      return {
        operation: input.operation,
        decisionId: input.decisionId,
        correlationId: input.correlationId,
        sessionId,
        nonce: input.nonce,
        expiresAt: input.expiresAt,
        storageConstraint: 'as-requested',
        principal,
        resourceContext: input.resourceContext,
        documentRef: input.documentRef,
        sourceHostId: HOST_ID,
        storageIntentFingerprint,
        rawBytesPolicy: {
          kind: 'trusted-raw-provider-boundary',
          boundary: 'same-principal-local',
          rawProviderBytesMayReachUntrustedClient: false,
        },
        authorizedProviders: [],
        storage: {
          intent: input.intent,
          durability: 'ephemeral',
          providers: [],
          requireDurabilityBeforeReady: false,
          allowReadOnlyFallback: false,
        },
      };
    }

    const providerConfig = createStandaloneIndexedDbProviderConfig(documentId);
    const storageScope = {
      tenantId: { kind: 'single-tenant' as const },
      workspaceId: { kind: 'no-workspace' as const },
      documentId,
    };
    const storageIntentFingerprint = createHostCanonicalFingerprint({
      openIntent: input.intent,
      durability: 'durableLocal',
      providerKind: 'indexeddb',
      providerRole: 'authority',
      documentId,
    });
    const handoff: AuthorizedDocumentStorageHandoff = {
      operation: input.operation,
      decisionId: input.decisionId,
      correlationId: input.correlationId,
      sessionId,
      nonce: input.nonce,
      expiresAt: input.expiresAt,
      storageConstraint: 'as-requested',
      principal,
      resourceContext: input.resourceContext,
      documentRef: input.documentRef,
      sourceHostId: HOST_ID,
      storageIntentFingerprint,
      rawBytesPolicy: {
        kind: 'trusted-raw-provider-boundary',
        boundary: 'same-principal-local',
        rawProviderBytesMayReachUntrustedClient: false,
      },
      authorizedProviders: [
        {
          providerRefId: providerConfig.providerRefId,
          kind: providerConfig.kind,
          role: providerConfig.role,
          required: providerConfig.required,
          rawByteExposure: 'trusted-provider-boundary',
          storageScope,
          redactedConfigFingerprint:
            providerConfig.redactedConfigFingerprint as HostCanonicalFingerprint,
        },
      ],
      storage: {
        intent: input.intent,
        durability: 'durableLocal',
        providers: [providerConfig],
        requireDurabilityBeforeReady: true,
        allowReadOnlyFallback: false,
      },
    };

    issuedStorageHandoffs.set(input.decisionId, {
      nonce: input.nonce,
      expiresAt: input.expiresAt,
      principalFingerprint,
      resourceContextFingerprint: createHostCanonicalFingerprint(input.resourceContext),
      providerConfig,
      storageScope,
    });

    return handoff;
  }

  const storageHandoff: AuthorizedDocumentStorageHandoff = createStorageHandoff({
    operation,
    decisionId,
    correlationId: handoffCorrelationId,
    nonce,
    expiresAt: handoffExpiresAt,
    resourceContext,
    documentRef: importDocumentRef,
    intent,
  });

  // --- Document Authorization Service ---

  const documentAuthorization: HostDocumentAuthorizationService = {
    async authorize(request: HostDocumentAuthorizationRequest): Promise<HostAuthorizationDecision> {
      const reqDecisionId = crypto.randomUUID();
      const reqNonce = crypto.randomUUID();
      const reqNow = Date.now();
      const reqOperation = request.details.operation;

      // Session operations: create/open/import — always allow with durable
      // local storage bound to the requested document identity.
      if (reqOperation === 'create' || reqOperation === 'open' || reqOperation === 'import') {
        const reqIntent =
          reqOperation === 'create'
            ? 'create'
            : reqOperation === 'import'
              ? 'importInitialize'
              : 'open';
        const sessionHandoff = createStorageHandoff({
          operation: reqOperation,
          decisionId: reqDecisionId,
          correlationId: request.correlationId,
          nonce: reqNonce,
          expiresAt: reqNow + HANDOFF_TTL_MS,
          resourceContext: request.resourceContext,
          documentRef:
            request.documentRef ?? (reqOperation === 'import' ? importDocumentRef : undefined),
          intent: reqIntent,
        });

        return {
          allowed: true,
          decisionId: reqDecisionId,
          correlationId: request.correlationId,
          authorizedAt: reqNow,
          storageConstraint: 'as-requested',
          handoff: sessionHandoff,
        };
      }

      // Management operations: share/delete/destroy — always allow.
      if (reqOperation === 'share' || reqOperation === 'delete' || reqOperation === 'destroy') {
        const mgmtBase = {
          decisionId: reqDecisionId,
          correlationId: request.correlationId,
          sessionId,
          nonce: reqNonce,
          expiresAt: reqNow + HANDOFF_TTL_MS,
          principal,
          resourceContext: request.resourceContext,
          documentRef: request.documentRef,
          sourceHostId: HOST_ID,
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
          authorizedAt: reqNow,
          handoff,
        };
      }

      if (reqOperation === 'export') {
        const details = request.details as Extract<
          typeof request.details,
          { readonly operation: 'export' }
        >;

        if (details.destination !== 'download') {
          return {
            allowed: false,
            decisionId: reqDecisionId,
            correlationId: request.correlationId,
            decidedAt: reqNow,
            code: 'EXPORT_DESTINATION_UNSUPPORTED',
            reason:
              `Standalone browser export only supports local downloads; ` +
              `received destination '${details.destination}'.`,
          };
        }

        if (details.contentPolicy.kind !== 'authorized-raw-snapshot') {
          return {
            allowed: false,
            decisionId: reqDecisionId,
            correlationId: request.correlationId,
            decidedAt: reqNow,
            code: 'EXPORT_POLICY_UNSUPPORTED',
            reason:
              `Standalone browser export requires an authorized raw snapshot policy; ` +
              `received '${details.contentPolicy.kind}'.`,
          };
        }

        const handoff: AuthorizedExportMaterializationHandoff = {
          operation: 'export',
          decisionId: reqDecisionId,
          correlationId: request.correlationId,
          sessionId,
          nonce: reqNonce,
          expiresAt: reqNow + HANDOFF_TTL_MS,
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
            expiresAt: reqNow + HANDOFF_TTL_MS,
          },
        };

        return {
          allowed: true,
          decisionId: reqDecisionId,
          correlationId: request.correlationId,
          authorizedAt: reqNow,
          handoff,
        };
      }

      return {
        allowed: false,
        decisionId: reqDecisionId,
        correlationId: request.correlationId,
        decidedAt: reqNow,
        code: 'DOCUMENT_OPERATION_UNSUPPORTED',
        reason: `Unsupported document operation '${reqOperation}'.`,
      };
    },
  };

  // --- Capability Lookup ---

  const capabilities: HostCapabilityLookup = {
    async decide(request: HostCapabilityRequest): Promise<HostCapabilityDecision> {
      return {
        allowed: true,
        decisionId: crypto.randomUUID(),
        correlationId: request.correlationId,
        decidedAt: Date.now(),
        operation: request.operation,
        subject: request.subject,
        enforcement: trustProfile.enforcement,
      };
    },
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
    workbookLinkResolver: config.workbookLinkResolver,
  };

  // --- Adapter Bindings ---

  const replayRegistry = createBrowserReplayRegistry();

  const bindings: HostKernelAdapterBindings = {
    replayRegistry,
    transportBindings: {
      has(runtimeKind: string): boolean {
        return runtimeKind === 'browser-wasm-worker';
      },
      resolve(runtimeKind: string) {
        return {
          runtimeKind,
          createTransportConfig(): unknown {
            return {
              kind: 'browser',
              wasmBaseUrl: config.wasmBaseUrl,
              workerUrl: config.workerUrl,
            };
          },
        };
      },
    },
    providerMaterializers: {
      has(providerRefId: string): boolean {
        return Array.from(issuedStorageHandoffs.values()).some(
          (issued) => issued.providerConfig.providerRefId === providerRefId,
        );
      },
      async resolve(request: ProviderMaterializerRequest) {
        const issued = issuedStorageHandoffs.get(request.decisionId);
        if (!issued) {
          throw new Error(
            'Standalone browser host rejected unauthorized provider materializer request',
          );
        }
        const issuedRecord = issued;
        const providerFingerprint = issuedRecord.providerConfig
          .redactedConfigFingerprint as HostCanonicalFingerprint;
        if (
          request.nonce !== issuedRecord.nonce ||
          request.expiresAt !== issuedRecord.expiresAt ||
          request.expiresAt < Date.now() ||
          request.principalFingerprint !== issuedRecord.principalFingerprint ||
          request.resourceContextFingerprint !== issuedRecord.resourceContextFingerprint ||
          request.providerRefId !== issuedRecord.providerConfig.providerRefId ||
          request.kind !== 'indexeddb' ||
          request.role !== 'authority' ||
          request.redactedConfigFingerprint !== providerFingerprint ||
          request.rawBytesPolicy.kind !== 'trusted-raw-provider-boundary' ||
          request.rawBytesPolicy.boundary !== 'same-principal-local' ||
          request.rawBytesPolicy.rawProviderBytesMayReachUntrustedClient !== false ||
          request.storageScope?.documentId !== issuedRecord.storageScope.documentId ||
          createHostCanonicalFingerprint(request.storageScope) !==
            createHostCanonicalFingerprint(issuedRecord.storageScope)
        ) {
          throw new Error(
            'Standalone browser host rejected unauthorized provider materializer request',
          );
        }

        const documentId = issuedRecord.storageScope.documentId;
        if (!documentId) {
          throw new Error(
            'Standalone browser host rejected unauthorized provider materializer request',
          );
        }
        const providerDocumentId: string = documentId;

        let provider: { detach(): Promise<void> } | null = null;
        return {
          providerRefId: request.providerRefId,
          materialized: true as const,
          async attach(
            rustDocument: unknown,
            options?: ProviderMaterializerAttachOptions,
          ): Promise<void> {
            const target = rustDocument as {
              attachProvider(
                provider: unknown,
                options?: ProviderMaterializerAttachOptions,
              ): Promise<void>;
            };
            if (typeof target.attachProvider !== 'function') {
              throw new Error(
                'Standalone browser provider materializer expected a RustDocument-compatible attach target',
              );
            }
            const { IndexedDBProvider } = (await import('@mog-sdk/kernel/storage')) as unknown as {
              IndexedDBProvider: new (docId: string) => { detach(): Promise<void> };
            };
            provider = new IndexedDBProvider(providerDocumentId);
            await target.attachProvider(provider, options);
          },
          dispose(): void {
            void provider?.detach().catch((err: unknown) => {
              console.warn(
                '[standalone-browser-host] IndexedDB provider detach during dispose failed',
                err,
              );
            });
            provider = null;
          },
        };
      },
    },
    sourceHandleResolvers: {
      has(sourceKind: string): boolean {
        return (
          sourceKind === 'uploaded-bytes' && Boolean(config.importBytes && importSourceHandleId)
        );
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
          request.expiresAt !== handoffExpiresAt ||
          request.singleUse !== true ||
          request.principalFingerprint !== principalFingerprint ||
          request.resourceContextFingerprint !== resourceContextFingerprint ||
          createHostCanonicalFingerprint(request.resourceContext) !== resourceContextFingerprint ||
          request.expectedContentIdentity.kind !== 'immutable-byte-handle' ||
          request.expectedContentIdentity.handleFingerprint !==
            importContentIdentity.handleFingerprint
        ) {
          throw new Error('Standalone browser host rejected unauthorized source handle request');
        }
        return {
          bytes: config.importBytes,
          contentIdentity: importContentIdentity,
          contentIdentityVerified: true,
          sourceHandleId: request.sourceHandleId,
        };
      },
    },
  };

  // --- ViewHostContext ---

  const viewHostContext: ViewHostContext = {
    session,
    focus: {
      boundaryId: `focus-${sessionId}`,
      requestFocus(reason) {
        diagnosticsSink.emit({
          kind: 'access.denied',
          correlationId: correlationRootId,
          timestamp: Date.now(),
          code: 'FOCUS_STUB',
          operation: `focus.request:${reason}`,
        });
      },
      releaseFocus(reason) {
        diagnosticsSink.emit({
          kind: 'access.denied',
          correlationId: correlationRootId,
          timestamp: Date.now(),
          code: 'FOCUS_STUB',
          operation: `focus.release:${reason}`,
        });
      },
    },
    keyboard: {
      boundaryId: `keyboard-${sessionId}`,
      captureMode: 'view-local',
      shouldHandleKey: () => true,
    },
    sizing: {
      mode: 'fill-container',
      devicePixelRatioPolicy: 'browser',
    },
    chromeTheme: {
      themeId: 'standalone-browser-default',
      colorScheme: config.chromeTheme?.colorScheme ?? 'light',
      density: config.chromeTheme?.density ?? 'comfortable',
    },
    accessibility: {
      reduceMotion:
        typeof matchMedia !== 'undefined'
          ? matchMedia('(prefers-reduced-motion: reduce)').matches
          : false,
      highContrast:
        typeof matchMedia !== 'undefined' ? matchMedia('(prefers-contrast: more)').matches : false,
      screenReaderOptimized: false,
    },
    capabilities,
    diagnostics: diagnosticsSink,
  };

  // --- ShellHostContext ---

  const shellHostContext: ShellHostContext = {
    session,
    route: {
      tenantId: { kind: 'single-tenant' },
      workspaceId: { kind: 'no-workspace' },
      routeId: typeof location !== 'undefined' ? location.pathname : '/',
    },
    appLifecycle: {
      async launch(_appId, _options) {
        // Stub — standalone browser has no app lifecycle
      },
      async suspend(_appId, _options) {
        // Stub
      },
      async resume(_appId, _options) {
        // Stub
      },
      async close(_appId, _options) {
        // Stub
      },
    },
    contributions: {
      registerCommand(_commandId, _contribution) {
        return () => {}; // no-op disposer
      },
      registerPanel(_panelId, _contribution) {
        return () => {};
      },
      registerMenu(_menuId, _contribution) {
        return () => {};
      },
    },
    navigation: {
      navigate(target, options) {
        diagnosticsSink.emit({
          kind: 'access.denied',
          correlationId: options?.correlationId ?? correlationRootId,
          timestamp: Date.now(),
          code: 'NAVIGATION_STUB',
          operation: `navigation.navigate:${target}`,
        });
      },
    },
    globalClipboardPolicy: 'app-scoped',
    capabilityUx: {
      async requestCapabilityGrant(
        request: HostCapabilityRequest,
      ): Promise<HostCapabilityDecision> {
        // Cooperative local: always grant
        return {
          allowed: true,
          decisionId: crypto.randomUUID(),
          correlationId: request.correlationId,
          decidedAt: Date.now(),
          operation: request.operation,
          subject: request.subject,
          enforcement: trustProfile.enforcement,
        };
      },
    },
    diagnostics: diagnosticsSink,
  };

  // --- RuntimeHostContext ---

  const runtimeHostContext: RuntimeHostContext = {
    kernel: runtimeConfig,
    assetPolicy: {
      wasmBaseUrl: config.wasmBaseUrl,
      workerUrl: config.workerUrl,
      assetIntegrityPolicy: 'same-origin',
    },
    disposalPolicy: {
      onTrap: 'surface-error',
      onProviderFailure: 'fail-closed',
    },
    diagnostics: diagnosticsSink,
  };

  // --- TrustedDocumentHostContext (branded cast) ---

  const context = {
    hostSurface: 'document-host',
    hostId: HOST_ID,
    kind: HOST_KIND,
    trust: trustProfile,
    diagnostics: diagnosticsSink,
    kernel: kernelHostContext,
    runtime: runtimeHostContext,
    view: viewHostContext,
    shell: shellHostContext,
    dispose(): void {
      // Clean up — currently no persistent resources to release.
    },
  } as unknown as TrustedDocumentHostContext;

  return {
    context,
    kernelContext: kernelHostContext,
    bindings,
    async dispose(): Promise<void> {
      // Future: clean up workers, listeners, etc.
    },
  };
}

export async function createStandaloneBrowserHostBackedDocument(
  hostResult: StandaloneBrowserShellResult,
  options?: { readonly skipDefaultSheet?: boolean },
): Promise<DocumentHandle> {
  const { createHostBackedDocument } = await import('@mog/kernel-host-internal');
  return createHostBackedDocument(hostResult.kernelContext, hostResult.bindings, options);
}

export async function createStandaloneBrowserHostBackedCollaborationDocument(
  hostResult: StandaloneBrowserShellResult,
  options: {
    readonly baseUrl: string;
    readonly roomId: string;
    readonly documentId: string;
    readonly participantId: string;
    readonly timeouts?: {
      readonly snapshotMs?: number;
      readonly joinMs?: number;
      readonly finalFlushMs?: number;
    };
  },
): Promise<{
  readonly handle: DocumentHandle;
  readonly sidecar: CollaborationSidecar;
  readonly room: {
    readonly roomId: string;
    readonly roomUrl: string;
    readonly roomEpoch: number;
    readonly fullStateHash: string;
    readonly snapshotToken: string;
  };
}> {
  const { createHostBackedCollaborationDocument } = await import('@mog/kernel-host-internal');
  return createHostBackedCollaborationDocument(hostResult.kernelContext, hostResult.bindings, {
    room: {
      source: 'standalone-shell-trusted-room-link',
      baseUrl: options.baseUrl,
      roomId: options.roomId,
      documentId: options.documentId,
      participantId: options.participantId,
      issuedAt: Date.now(),
    },
    timeouts: options.timeouts,
  });
}

export async function importStandaloneBrowserHostBackedDocument(
  hostResult: StandaloneBrowserShellResult,
): Promise<DocumentHandle> {
  const { importHostBackedDocument } = await import('@mog/kernel-host-internal');
  const result = await importHostBackedDocument(hostResult.kernelContext, hostResult.bindings);
  return result.handle;
}
