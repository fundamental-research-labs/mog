/**
 * HostDocumentOperationGate — kernel operation gate for export, share, delete, and destroy.
 *
 * This gate ensures that operations which materialize, share, remove, or destroy
 * document content require an explicit authorization decision at call time.
 *
 * The gate is installed ONCE before the DocumentHandle/Workbook is returned to the caller.
 *
 * IMPORTANT: Local `dispose()` does NOT go through this gate. `dispose()` is local
 * resource cleanup — it tears down the local session (bridge, transport, in-memory state)
 * without deleting persisted document authority or remote provider state. Similarly,
 * `RustDocument.destroy()` is an internal cleanup method for the Rust-side engine
 * resources, not an all-storage destroy operation.
 */

import type { HostDiagnosticsSink } from '@mog-sdk/types-host/diagnostics';
import type { HostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';
import type { HostDocumentOperation } from '@mog-sdk/types-host/operations';
import type {
  AuthorizedExportMaterializationHandoff,
  AuthorizedDocumentManagementHandoff,
  HostAuthorizedExportSinkRef,
  HostDocumentAuthorizationService,
  HostDocumentAuthorizationRequest,
  HostDocumentAuthorizationRequestBase,
  HostAuthorizationDecision,
  HostExportContentPolicy,
  KernelDocumentHighWaterMarkProof,
} from '@mog-sdk/types-host/kernel';
import type { HostHandoffReplayRegistry, HandoffReplayKey } from '@mog-sdk/types-host/bindings';
import type { VerifiedPrincipal } from '@mog-sdk/types-host/identity';

// ---------------------------------------------------------------------------
// Request types for each operation
// ---------------------------------------------------------------------------

export interface ExportOperationRequest {
  readonly format: 'xlsx' | 'csv' | 'pdf' | 'snapshot';
  readonly destination: 'download' | 'host-callback' | 'remote-storage';
  readonly exportPathId: string;
  readonly documentHighWaterMark: KernelDocumentHighWaterMarkProof;
  readonly requestedExportSinkRefs: readonly HostAuthorizedExportSinkRef[];
  readonly contentPolicy: HostExportContentPolicy;
}

export interface ShareOperationRequest {
  readonly recipients: readonly string[];
  readonly accessLevel: 'read' | 'write' | 'admin';
}

export interface DeleteOperationRequest {
  readonly permanence: 'trash' | 'permanent';
}

export interface DestroyOperationRequest {
  readonly scope: 'local-session' | 'all-storage';
}

// ---------------------------------------------------------------------------
// The gate interface
// ---------------------------------------------------------------------------

export interface HostDocumentOperationGate {
  readonly installed: true;

  authorizeExport(request: ExportOperationRequest): Promise<AuthorizedExportMaterializationHandoff>;
  authorizeShare(request: ShareOperationRequest): Promise<AuthorizedDocumentManagementHandoff>;
  authorizeDelete(request: DeleteOperationRequest): Promise<AuthorizedDocumentManagementHandoff>;
  authorizeDestroy(request: DestroyOperationRequest): Promise<AuthorizedDocumentManagementHandoff>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OperationDeniedError extends Error {
  constructor(
    public readonly operation: string,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OperationDeniedError';
  }
}

// ---------------------------------------------------------------------------
// No-gate sentinel for legacy path
// ---------------------------------------------------------------------------

export const NO_HOST_OPERATION_GATE: unique symbol = Symbol('NO_HOST_OPERATION_GATE');

export type MaybeHostOperationGate = HostDocumentOperationGate | typeof NO_HOST_OPERATION_GATE;

export function assertOperationGateInstalled(
  gate: MaybeHostOperationGate,
  operation: string,
): asserts gate is HostDocumentOperationGate {
  if (gate === NO_HOST_OPERATION_GATE) {
    throw new OperationDeniedError(
      operation,
      'NO_OPERATION_GATE',
      `Operation '${operation}' requires a HostDocumentOperationGate but none is installed. ` +
        `This document was not created through the host-compliant path.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Gate configuration
// ---------------------------------------------------------------------------

export interface HostOperationGateConfig {
  readonly sessionId: string;
  readonly sourceHostId: string;
  readonly principalFingerprint: HostCanonicalFingerprint;
  readonly resourceContextFingerprint: HostCanonicalFingerprint;
  readonly principal: VerifiedPrincipal;
  readonly resourceContext: {
    readonly tenantId: string | { readonly kind: 'single-tenant' };
    readonly workspaceId: string | { readonly kind: 'no-workspace' };
    readonly documentId?: string;
    readonly resolutionSource: 'trusted-control-plane' | 'trusted-adapter' | 'test-fixture';
  };
  readonly documentAuthorization: HostDocumentAuthorizationService;
  readonly replayRegistry: HostHandoffReplayRegistry;
  readonly diagnostics: HostDiagnosticsSink;
  readonly clock: { now(): number };
}

// ---------------------------------------------------------------------------
// Gate factory
// ---------------------------------------------------------------------------

export function createHostDocumentOperationGate(
  config: HostOperationGateConfig,
): HostDocumentOperationGate {
  const {
    sessionId,
    sourceHostId,
    // principalFingerprint reserved for future authorization request enrichment
    resourceContextFingerprint,
    principal,
    resourceContext,
    documentAuthorization,
    replayRegistry,
    diagnostics,
    clock,
  } = config;

  /**
   * Build the common base fields for every authorization request.
   */
  function buildRequestBase(correlationId: string): HostDocumentAuthorizationRequestBase {
    return {
      correlationId,
      principal,
      resourceContext,
      sourceHostId,
    };
  }

  /**
   * Consume a handoff nonce through the replay registry. Throws if the nonce
   * was already consumed (replay attack prevention).
   */
  function consumeNonce(operation: HostDocumentOperation, decisionId: string, nonce: string): void {
    const key: HandoffReplayKey = {
      sourceHostId,
      sessionId,
      decisionId,
      operation,
      nonce,
      resourceFingerprint: resourceContextFingerprint,
    };

    const consumed = replayRegistry.consumeOnce(key);
    if (!consumed) {
      diagnostics.emit({
        kind: 'documentAuthorization.denied',
        code: 'NONCE_REPLAY_DETECTED',
        correlationId: decisionId,
        operation,
        reason: `Handoff nonce for operation '${operation}' with decisionId '${decisionId}' has already been consumed. This may indicate a replay attack.`,
        timestamp: clock.now(),
      });
      throw new OperationDeniedError(
        operation,
        'NONCE_REPLAY_DETECTED',
        `Handoff nonce for operation '${operation}' has already been consumed.`,
      );
    }
  }

  /**
   * Validate that a handoff has not expired.
   */
  function checkExpiry(
    operation: HostDocumentOperation,
    expiresAt: number,
    decisionId: string,
  ): void {
    const now = clock.now();
    if (now >= expiresAt) {
      diagnostics.emit({
        kind: 'documentAuthorization.denied',
        code: 'HANDOFF_EXPIRED',
        correlationId: decisionId,
        operation,
        reason: `Handoff for operation '${operation}' expired at ${expiresAt}, current time is ${now}.`,
        timestamp: now,
      });
      throw new OperationDeniedError(
        operation,
        'HANDOFF_EXPIRED',
        `Handoff for operation '${operation}' has expired.`,
      );
    }
  }

  /**
   * Handle a denied authorization decision.
   */
  function handleDenied(
    decision: Extract<HostAuthorizationDecision, { allowed: false }>,
    operation: HostDocumentOperation,
  ): never {
    diagnostics.emit({
      kind: 'documentAuthorization.denied',
      code: decision.code,
      correlationId: decision.correlationId,
      operation,
      reason: decision.reason,
      timestamp: clock.now(),
    });
    throw new OperationDeniedError(operation, decision.code, decision.reason);
  }

  return {
    installed: true as const,

    // -----------------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------------

    async authorizeExport(
      request: ExportOperationRequest,
    ): Promise<AuthorizedExportMaterializationHandoff> {
      const correlationId = `export-${sessionId}-${clock.now()}`;
      const base = buildRequestBase(correlationId);

      const authRequest: HostDocumentAuthorizationRequest = {
        ...base,
        details: {
          operation: 'export',
          format: request.format,
          exportPathId: request.exportPathId,
          documentHighWaterMark: request.documentHighWaterMark,
          destination: request.destination,
          requestedExportSinkRefs: request.requestedExportSinkRefs,
          contentPolicy: request.contentPolicy,
        },
      };

      const decision = await documentAuthorization.authorize(authRequest);

      if (!decision.allowed) {
        handleDenied(decision, 'export');
      }

      const handoff = decision.handoff as AuthorizedExportMaterializationHandoff;
      if (handoff.operation !== 'export') {
        throw new OperationDeniedError(
          'export',
          'INVALID_EXPORT_HANDOFF',
          `Authorization service returned '${handoff.operation}' handoff for export operation.`,
        );
      }

      checkExpiry('export', handoff.expiresAt, handoff.decisionId);
      consumeNonce('export', handoff.decisionId, handoff.nonce);

      diagnostics.emit({
        kind: 'documentAuthorization.denied',
        code: 'EXPORT_AUTHORIZED',
        correlationId: handoff.correlationId,
        operation: 'export',
        reason:
          `Export authorized for format=${request.format}, destination=${request.destination}, ` +
          `exportPathId=${request.exportPathId}.`,
        timestamp: clock.now(),
      });

      return handoff;
    },

    // -----------------------------------------------------------------------
    // Share
    // -----------------------------------------------------------------------

    async authorizeShare(
      request: ShareOperationRequest,
    ): Promise<AuthorizedDocumentManagementHandoff> {
      const correlationId = `share-${sessionId}-${clock.now()}`;
      const base = buildRequestBase(correlationId);

      const authRequest: HostDocumentAuthorizationRequest = {
        ...base,
        details: {
          operation: 'share',
          recipients: request.recipients,
          accessLevel: request.accessLevel,
        },
      };

      const decision = await documentAuthorization.authorize(authRequest);

      if (!decision.allowed) {
        handleDenied(decision, 'share');
      }

      const handoff = decision.handoff as AuthorizedDocumentManagementHandoff;

      // Check expiry before consuming the nonce
      checkExpiry('share', handoff.expiresAt, handoff.decisionId);

      // Consume nonce through replay registry BEFORE the operation executes
      consumeNonce('share', handoff.decisionId, handoff.nonce);

      diagnostics.emit({
        kind: 'documentAuthorization.denied', // Re-using the closest event kind for success logging
        code: 'SHARE_AUTHORIZED',
        correlationId: handoff.correlationId,
        operation: 'share',
        reason: `Share authorized for ${request.recipients.length} recipient(s) at access level '${request.accessLevel}'.`,
        timestamp: clock.now(),
      });

      return handoff;
    },

    // -----------------------------------------------------------------------
    // Delete
    // -----------------------------------------------------------------------

    async authorizeDelete(
      request: DeleteOperationRequest,
    ): Promise<AuthorizedDocumentManagementHandoff> {
      const correlationId = `delete-${sessionId}-${clock.now()}`;
      const base = buildRequestBase(correlationId);

      const authRequest: HostDocumentAuthorizationRequest = {
        ...base,
        details: {
          operation: 'delete',
          permanence: request.permanence,
        },
      };

      const decision = await documentAuthorization.authorize(authRequest);

      if (!decision.allowed) {
        handleDenied(decision, 'delete');
      }

      const handoff = decision.handoff as AuthorizedDocumentManagementHandoff;

      // Check expiry before consuming the nonce
      checkExpiry('delete', handoff.expiresAt, handoff.decisionId);

      // Consume nonce through replay registry BEFORE the operation executes
      consumeNonce('delete', handoff.decisionId, handoff.nonce);

      diagnostics.emit({
        kind: 'documentAuthorization.denied',
        code: 'DELETE_AUTHORIZED',
        correlationId: handoff.correlationId,
        operation: 'delete',
        reason: `Delete authorized with permanence '${request.permanence}'.`,
        timestamp: clock.now(),
      });

      return handoff;
    },

    // -----------------------------------------------------------------------
    // Destroy
    //
    // `scope: 'local-session'` is a management handoff for host-visible session
    // invalidation — it is NOT the same as local `dispose()`.
    //
    // `scope: 'all-storage'` requires full authorization and touches all
    // provider state.
    //
    // Both scopes consume nonces through the replay registry.
    // -----------------------------------------------------------------------

    async authorizeDestroy(
      request: DestroyOperationRequest,
    ): Promise<AuthorizedDocumentManagementHandoff> {
      const correlationId = `destroy-${sessionId}-${clock.now()}`;
      const base = buildRequestBase(correlationId);

      const authRequest: HostDocumentAuthorizationRequest = {
        ...base,
        details: {
          operation: 'destroy',
          scope: request.scope,
        },
      };

      const decision = await documentAuthorization.authorize(authRequest);

      if (!decision.allowed) {
        handleDenied(decision, 'destroy');
      }

      const handoff = decision.handoff as AuthorizedDocumentManagementHandoff;

      // Check expiry before consuming the nonce
      checkExpiry('destroy', handoff.expiresAt, handoff.decisionId);

      // Consume nonce through replay registry BEFORE the operation executes
      consumeNonce('destroy', handoff.decisionId, handoff.nonce);

      diagnostics.emit({
        kind: 'documentAuthorization.denied',
        code: 'DESTROY_AUTHORIZED',
        correlationId: handoff.correlationId,
        operation: 'destroy',
        reason: `Destroy authorized with scope '${request.scope}'.`,
        timestamp: clock.now(),
      });

      return handoff;
    },
  };
}

// =============================================================================
// HostOperationGate — High-water-mark proof-based export authorization
// =============================================================================

import type { HighWaterMarkSnapshot, ProofValidationError } from '@mog-sdk/contracts/storage';
import type { HighWaterMarkProofRegistry } from './high-water-mark-registry';
import type { WriteGate } from './write-gate';

export interface ExportAuthorizationRequest {
  proofId: string;
  sessionId: string;
}

export interface ExportAuthorizationResult {
  authorized: boolean;
  error?: ProofValidationError;
}

export class HostOperationGate {
  private readonly registry: HighWaterMarkProofRegistry;
  private readonly writeGate: WriteGate;

  constructor(registry: HighWaterMarkProofRegistry, writeGate: WriteGate) {
    this.registry = registry;
    this.writeGate = writeGate;
  }

  authorizeExport(request: ExportAuthorizationRequest): ExportAuthorizationResult {
    if (!request.proofId) {
      return {
        authorized: false,
        error: { code: 'EXPORT_BLOCKED_NO_PROOF' },
      };
    }

    const currentSnapshot: HighWaterMarkSnapshot = this.writeGate.captureHighWaterMark();
    const result = this.registry.consumeProof(request.proofId, request.sessionId);

    if (!result.valid) {
      return { authorized: false, error: result.error };
    }

    return { authorized: true };
  }

  /**
   * Convenience: issue a proof and immediately authorize, for callers that
   * own the full pipeline (e.g. headless `save()`). The proof is consumed
   * in the same call so it cannot be replayed.
   */
  async authorizeExportImmediate(sessionId: string): Promise<ExportAuthorizationResult> {
    const proof = await this.registry.issueProof({ sessionId });
    return this.authorizeExport({ proofId: proof.proofId, sessionId });
  }
}
