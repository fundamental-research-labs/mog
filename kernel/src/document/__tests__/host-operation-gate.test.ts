/**
 * HostDocumentOperationGate — unit tests.
 *
 * Verifies that export, share, delete, and destroy operations require explicit
 * authorization at call time, and that replay, expiry, and denial are enforced.
 */

import type {
  AuthorizedDocumentManagementHandoff,
  AuthorizedExportMaterializationHandoff,
  HostAuthorizationDecision,
  HostDocumentAuthorizationRequest,
  HostDocumentAuthorizationService,
} from '@mog-sdk/types-host/kernel';
import type { HostDiagnosticEvent, HostDiagnosticsSink } from '@mog-sdk/types-host/diagnostics';
import type { HostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';
import type { VerifiedPrincipal } from '@mog-sdk/types-host/identity';
import type { HostHandoffReplayRegistry, HandoffReplayKey } from '@mog/kernel-host-internal';

import {
  createHostDocumentOperationGate,
  OperationDeniedError,
  assertOperationGateInstalled,
  NO_HOST_OPERATION_GATE,
} from '../host-operation-gate';
import type {
  HostOperationGateConfig,
  ExportOperationRequest,
  ShareOperationRequest,
  DeleteOperationRequest,
  DestroyOperationRequest,
} from '../host-operation-gate';

// =============================================================================
// Test fixtures
// =============================================================================

const TEST_SESSION_ID = 'test-session-001';
const TEST_SOURCE_HOST_ID = 'test-host-001';
const TEST_PRINCIPAL_FP: HostCanonicalFingerprint = 'mog-host-fp:v1:sha256:principal-test-digest';
const TEST_RESOURCE_FP: HostCanonicalFingerprint = 'mog-host-fp:v1:sha256:resource-test-digest';

const TEST_PRINCIPAL: VerifiedPrincipal = {
  issuer: { issuerId: 'test-issuer', issuerKind: 'test' },
  subjectId: 'test-user-001',
  tenantId: 'test-tenant',
  workspaceId: 'test-workspace',
  actorKind: 'user',
  tags: [],
};

const TEST_RESOURCE_CONTEXT = {
  tenantId: 'test-tenant' as const,
  workspaceId: 'test-workspace' as const,
  documentId: 'test-doc-001',
  resolutionSource: 'test-fixture' as const,
};

function createMockDiagnostics(): HostDiagnosticsSink & { events: HostDiagnosticEvent[] } {
  const events: HostDiagnosticEvent[] = [];
  return {
    events,
    emit(event: HostDiagnosticEvent): void {
      events.push(event);
    },
  };
}

function createMockReplayRegistry(opts?: {
  rejectAll?: boolean;
}): HostHandoffReplayRegistry & { consumed: HandoffReplayKey[] } {
  const consumed: HandoffReplayKey[] = [];
  const consumedKeys = new Set<string>();

  return {
    consumed,
    consumeOnce(key: HandoffReplayKey): boolean {
      if (opts?.rejectAll) {
        return false;
      }
      const serialized = `${key.sourceHostId}:${key.sessionId}:${key.decisionId}:${key.operation}:${key.nonce}:${key.resourceFingerprint}`;
      if (consumedKeys.has(serialized)) {
        return false;
      }
      consumedKeys.add(serialized);
      consumed.push(key);
      return true;
    },
  };
}

function createMockClock(initialTime: number = 1000): { now(): number; advance(ms: number): void } {
  let currentTime = initialTime;
  return {
    now(): number {
      return currentTime;
    },
    advance(ms: number): void {
      currentTime += ms;
    },
  };
}

function createMockAuthorizationService(
  handler: (request: HostDocumentAuthorizationRequest) => HostAuthorizationDecision,
): HostDocumentAuthorizationService {
  return {
    async authorize(request: HostDocumentAuthorizationRequest): Promise<HostAuthorizationDecision> {
      return handler(request);
    },
  };
}

/**
 * Build a management handoff for share/delete/destroy.
 */
function makeManagementHandoff(
  operation: 'share' | 'delete' | 'destroy',
  overrides?: Partial<{
    decisionId: string;
    nonce: string;
    expiresAt: number;
    recipients: readonly string[];
    accessLevel: 'read' | 'write' | 'admin';
    permanence: 'trash' | 'permanent';
    scope: 'local-session' | 'all-storage';
  }>,
): AuthorizedDocumentManagementHandoff {
  const base = {
    decisionId: overrides?.decisionId ?? `decision-${operation}-001`,
    correlationId: `correlation-${operation}-001`,
    sessionId: TEST_SESSION_ID,
    nonce: overrides?.nonce ?? `nonce-${operation}-001`,
    expiresAt: overrides?.expiresAt ?? 9999999,
    principal: TEST_PRINCIPAL,
    resourceContext: TEST_RESOURCE_CONTEXT,
    sourceHostId: TEST_SOURCE_HOST_ID,
  };

  switch (operation) {
    case 'share':
      return {
        ...base,
        operation: 'share',
        share: {
          recipients: overrides?.recipients ?? ['user-a@example.com'],
          accessLevel: overrides?.accessLevel ?? 'read',
          liveCollaborationAccess: 'requires-recipient-open-authorization',
        },
      };
    case 'delete':
      return {
        ...base,
        operation: 'delete',
        delete: {
          permanence: overrides?.permanence ?? 'trash',
          providerRefs: [],
        },
      };
    case 'destroy':
      return {
        ...base,
        operation: 'destroy',
        destroy: {
          scope: overrides?.scope ?? 'all-storage',
          providerRefs: [],
        },
      };
  }
}

function makeAllowedDecision(
  handoff: AuthorizedDocumentManagementHandoff,
): HostAuthorizationDecision {
  return {
    allowed: true,
    decisionId: handoff.decisionId,
    correlationId: handoff.correlationId,
    authorizedAt: 1000,
    handoff,
  };
}

function makeExportRequest(overrides?: Partial<ExportOperationRequest>): ExportOperationRequest {
  const contentPolicy = {
    kind: 'authorized-raw-snapshot' as const,
    rawMaterializationProof: {
      source: 'rust-policy-engine' as const,
      decisionId: 'raw-export-decision',
      sessionId: TEST_SESSION_ID,
      principalFingerprint: TEST_PRINCIPAL_FP,
      resourceContextFingerprint: TEST_RESOURCE_FP,
      target: 'raw-document-materialization' as const,
      scope: 'entire-document' as const,
      effectiveLevel: 'raw-materialize' as const,
      childPolicyResolution: 'all-materialized-targets-raw-authorized' as const,
      correlationId: 'correlation-export-001',
      issuedAt: 1000,
    },
  };
  return {
    format: 'xlsx',
    destination: 'download',
    exportPathId: 'test-export-path',
    requestedExportSinkRefs: [],
    contentPolicy,
    documentHighWaterMark: {
      source: 'kernel-write-gate',
      proofId: 'proof-export-001',
      registryId: 'registry-export-001',
      sessionId: TEST_SESSION_ID,
      resourceContextFingerprint: TEST_RESOURCE_FP,
      mutationWatermark: '0',
      exportPathId: 'test-export-path',
      format: 'xlsx',
      contentPolicyFingerprint: TEST_RESOURCE_FP,
      destination: 'download',
      requestedExportSinkRefs: [],
      issuedAt: 1000,
      expiresAt: 9999999,
      coveredFields: [
        'proofId',
        'registryId',
        'sessionId',
        'resourceContextFingerprint',
        'mutationWatermark',
        'exportPathId',
        'format',
        'contentPolicyFingerprint',
        'destination',
        'requestedExportSinkRefs',
        'issuedAt',
        'expiresAt',
      ],
      canonicalPayloadHash: TEST_RESOURCE_FP,
      verification: { kind: 'live-kernel-write-gate-registry', registryId: 'registry-export-001' },
    },
    ...overrides,
  };
}

function makeExportHandoff(
  request: ExportOperationRequest,
): AuthorizedExportMaterializationHandoff {
  return {
    operation: 'export',
    decisionId: 'decision-export-001',
    correlationId: 'correlation-export-001',
    sessionId: TEST_SESSION_ID,
    nonce: 'nonce-export-001',
    expiresAt: 9999999,
    principal: TEST_PRINCIPAL,
    resourceContext: TEST_RESOURCE_CONTEXT,
    sourceHostId: TEST_SOURCE_HOST_ID,
    rawBytesPolicy: {
      kind: 'trusted-raw-provider-boundary',
      boundary: 'test-fixture',
      rawProviderBytesMayReachUntrustedClient: false,
    },
    exportMaterialization: {
      grantKind: 'export-byte-materialization',
      decisionId: 'decision-export-001',
      correlationId: 'correlation-export-001',
      format: request.format,
      exportPathId: request.exportPathId,
      documentHighWaterMark: request.documentHighWaterMark,
      contentPolicy: request.contentPolicy as Extract<
        typeof request.contentPolicy,
        { kind: 'authorized-raw-snapshot' }
      >,
      destination: request.destination,
      exportSinkRefs: request.requestedExportSinkRefs,
      materializationNonce: 'nonce-export-001',
      expiresAt: 9999999,
    },
  };
}

function makeDeniedDecision(operation: string): HostAuthorizationDecision {
  return {
    allowed: false,
    decisionId: `decision-denied-${operation}`,
    correlationId: `correlation-denied-${operation}`,
    decidedAt: 1000,
    code: `${operation.toUpperCase()}_DENIED_BY_POLICY`,
    reason: `Operation '${operation}' denied by host policy.`,
  };
}

function makeGateConfig(overrides?: Partial<HostOperationGateConfig>): HostOperationGateConfig {
  return {
    sessionId: TEST_SESSION_ID,
    sourceHostId: TEST_SOURCE_HOST_ID,
    principalFingerprint: TEST_PRINCIPAL_FP,
    resourceContextFingerprint: TEST_RESOURCE_FP,
    principal: TEST_PRINCIPAL,
    resourceContext: TEST_RESOURCE_CONTEXT,
    documentAuthorization: createMockAuthorizationService(() => {
      throw new Error('Authorization service not configured for this test');
    }),
    replayRegistry: createMockReplayRegistry(),
    diagnostics: createMockDiagnostics(),
    clock: createMockClock(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('HostDocumentOperationGate', () => {
  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  describe('authorizeExport', () => {
    it('authorizes export through the host authorization service with a high-water proof', async () => {
      const diagnostics = createMockDiagnostics();
      const request = makeExportRequest();
      const handoff = makeExportHandoff(request);
      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          diagnostics,
          documentAuthorization: createMockAuthorizationService((authRequest) => {
            expect(authRequest.details.operation).toBe('export');
            return {
              allowed: true,
              decisionId: handoff.decisionId,
              correlationId: handoff.correlationId,
              authorizedAt: 1000,
              handoff,
            };
          }),
        }),
      );

      await expect(gate.authorizeExport(request)).resolves.toBe(handoff);

      const exportDiagnostics = diagnostics.events.filter(
        (e) => e.kind === 'documentAuthorization.denied' && e.code === 'EXPORT_AUTHORIZED',
      );
      expect(exportDiagnostics).toHaveLength(1);
    });

    it('surfaces host export denials', async () => {
      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          documentAuthorization: createMockAuthorizationService(() => makeDeniedDecision('export')),
        }),
      );

      await expect(gate.authorizeExport(makeExportRequest())).rejects.toMatchObject({
        code: 'EXPORT_DENIED_BY_POLICY',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Share
  // -------------------------------------------------------------------------

  describe('authorizeShare', () => {
    it('succeeds with valid handoff', async () => {
      const diagnostics = createMockDiagnostics();
      const registry = createMockReplayRegistry();
      const handoff = makeManagementHandoff('share');

      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          diagnostics,
          replayRegistry: registry,
          documentAuthorization: createMockAuthorizationService(() => makeAllowedDecision(handoff)),
        }),
      );

      const result = await gate.authorizeShare({
        recipients: ['user-a@example.com'],
        accessLevel: 'read',
      });

      expect(result).toBe(handoff);
      expect(result.operation).toBe('share');

      // Nonce was consumed
      expect(registry.consumed).toHaveLength(1);
      expect(registry.consumed[0]!.operation).toBe('share');
      expect(registry.consumed[0]!.decisionId).toBe(handoff.decisionId);

      // Success diagnostic emitted
      const successDiagnostics = diagnostics.events.filter(
        (e) => e.kind === 'documentAuthorization.denied' && e.code === 'SHARE_AUTHORIZED',
      );
      expect(successDiagnostics).toHaveLength(1);
    });

    it('fails with denied decision', async () => {
      const diagnostics = createMockDiagnostics();
      const registry = createMockReplayRegistry();

      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          diagnostics,
          replayRegistry: registry,
          documentAuthorization: createMockAuthorizationService(() => makeDeniedDecision('share')),
        }),
      );

      await expect(
        gate.authorizeShare({ recipients: ['user-a@example.com'], accessLevel: 'read' }),
      ).rejects.toThrow(OperationDeniedError);

      await expect(
        gate.authorizeShare({ recipients: ['user-a@example.com'], accessLevel: 'read' }),
      ).rejects.toMatchObject({
        operation: 'share',
        code: 'SHARE_DENIED_BY_POLICY',
      });

      // No nonce consumed on denial
      expect(registry.consumed).toHaveLength(0);

      // Denial diagnostic emitted
      const denialDiags = diagnostics.events.filter(
        (e) => e.kind === 'documentAuthorization.denied' && e.code === 'SHARE_DENIED_BY_POLICY',
      );
      expect(denialDiags.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects replayed nonce', async () => {
      const diagnostics = createMockDiagnostics();
      const registry = createMockReplayRegistry();
      const handoff = makeManagementHandoff('share');

      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          diagnostics,
          replayRegistry: registry,
          documentAuthorization: createMockAuthorizationService(() => makeAllowedDecision(handoff)),
        }),
      );

      // First call succeeds
      await gate.authorizeShare({ recipients: ['user-a@example.com'], accessLevel: 'read' });

      // Second call with same nonce fails
      await expect(
        gate.authorizeShare({ recipients: ['user-a@example.com'], accessLevel: 'read' }),
      ).rejects.toThrow(OperationDeniedError);

      await expect(
        gate.authorizeShare({ recipients: ['user-a@example.com'], accessLevel: 'read' }),
      ).rejects.toMatchObject({
        code: 'NONCE_REPLAY_DETECTED',
      });

      // Replay diagnostic emitted
      const replayDiags = diagnostics.events.filter(
        (e) => e.kind === 'documentAuthorization.denied' && e.code === 'NONCE_REPLAY_DETECTED',
      );
      expect(replayDiags.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  describe('authorizeDelete', () => {
    it('succeeds with valid handoff', async () => {
      const diagnostics = createMockDiagnostics();
      const registry = createMockReplayRegistry();
      const handoff = makeManagementHandoff('delete', { permanence: 'trash' });

      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          diagnostics,
          replayRegistry: registry,
          documentAuthorization: createMockAuthorizationService(() => makeAllowedDecision(handoff)),
        }),
      );

      const result = await gate.authorizeDelete({ permanence: 'trash' });

      expect(result).toBe(handoff);
      expect(result.operation).toBe('delete');
      expect(registry.consumed).toHaveLength(1);
      expect(registry.consumed[0]!.operation).toBe('delete');
    });

    it('rejects replayed nonce', async () => {
      const registry = createMockReplayRegistry();
      const handoff = makeManagementHandoff('delete');

      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          replayRegistry: registry,
          documentAuthorization: createMockAuthorizationService(() => makeAllowedDecision(handoff)),
        }),
      );

      // First call succeeds
      await gate.authorizeDelete({ permanence: 'trash' });

      // Second call fails — same nonce
      await expect(gate.authorizeDelete({ permanence: 'trash' })).rejects.toMatchObject({
        code: 'NONCE_REPLAY_DETECTED',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Destroy
  // -------------------------------------------------------------------------

  describe('authorizeDestroy', () => {
    it('authorizes all-storage destroy with valid handoff', async () => {
      const diagnostics = createMockDiagnostics();
      const registry = createMockReplayRegistry();
      const handoff = makeManagementHandoff('destroy', { scope: 'all-storage' });

      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          diagnostics,
          replayRegistry: registry,
          documentAuthorization: createMockAuthorizationService(() => makeAllowedDecision(handoff)),
        }),
      );

      const result = await gate.authorizeDestroy({ scope: 'all-storage' });
      expect(result).toBe(handoff);
      expect(result.operation).toBe('destroy');
      expect(registry.consumed).toHaveLength(1);
    });

    it('authorizes local-session destroy (different from dispose)', async () => {
      const registry = createMockReplayRegistry();
      const handoff = makeManagementHandoff('destroy', { scope: 'local-session' });

      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          replayRegistry: registry,
          documentAuthorization: createMockAuthorizationService(() => makeAllowedDecision(handoff)),
        }),
      );

      // local-session destroy still requires authorization — it's not the same as dispose()
      const result = await gate.authorizeDestroy({ scope: 'local-session' });
      expect(result).toBe(handoff);
      expect(result.operation).toBe('destroy');
      expect(registry.consumed).toHaveLength(1);
    });

    it('denies all-storage destroy when authorization is denied', async () => {
      const diagnostics = createMockDiagnostics();
      const registry = createMockReplayRegistry();

      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          diagnostics,
          replayRegistry: registry,
          documentAuthorization: createMockAuthorizationService(() =>
            makeDeniedDecision('destroy'),
          ),
        }),
      );

      await expect(gate.authorizeDestroy({ scope: 'all-storage' })).rejects.toThrow(
        OperationDeniedError,
      );

      // No nonce consumed on denial
      expect(registry.consumed).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Expiry
  // -------------------------------------------------------------------------

  describe('expired handoff rejection', () => {
    it('rejects expired handoff', async () => {
      const diagnostics = createMockDiagnostics();
      const clock = createMockClock(5000);
      const handoff = makeManagementHandoff('share', { expiresAt: 4000 }); // Already expired

      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          diagnostics,
          clock,
          documentAuthorization: createMockAuthorizationService(() => makeAllowedDecision(handoff)),
        }),
      );

      await expect(
        gate.authorizeShare({ recipients: ['user-a@example.com'], accessLevel: 'read' }),
      ).rejects.toThrow(OperationDeniedError);

      await expect(
        gate.authorizeShare({ recipients: ['user-a@example.com'], accessLevel: 'read' }),
      ).rejects.toMatchObject({
        code: 'HANDOFF_EXPIRED',
      });

      const expiryDiags = diagnostics.events.filter(
        (e) => e.kind === 'documentAuthorization.denied' && e.code === 'HANDOFF_EXPIRED',
      );
      expect(expiryDiags.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects handoff that expires between check and use for delete', async () => {
      const clock = createMockClock(3999);
      const handoff = makeManagementHandoff('delete', { expiresAt: 4000 });

      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          clock,
          documentAuthorization: createMockAuthorizationService(() => {
            // Advance clock past expiry during authorization call
            clock.advance(2);
            return makeAllowedDecision(handoff);
          }),
        }),
      );

      // Clock is now 4001, which is past expiresAt of 4000
      await expect(gate.authorizeDelete({ permanence: 'permanent' })).rejects.toMatchObject({
        code: 'HANDOFF_EXPIRED',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  describe('diagnostics emission', () => {
    it('emits diagnostics for export denial', async () => {
      const diagnostics = createMockDiagnostics();
      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          diagnostics,
          documentAuthorization: createMockAuthorizationService(() => makeDeniedDecision('export')),
        }),
      );

      await gate.authorizeExport(makeExportRequest({ exportPathId: 'path-1' })).catch(() => {});

      expect(diagnostics.events).toHaveLength(1);
      expect(diagnostics.events[0]!.kind).toBe('documentAuthorization.denied');
      expect(diagnostics.events[0]!.code).toBe('EXPORT_DENIED_BY_POLICY');
    });

    it('emits diagnostics for share success', async () => {
      const diagnostics = createMockDiagnostics();
      const handoff = makeManagementHandoff('share');

      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          diagnostics,
          documentAuthorization: createMockAuthorizationService(() => makeAllowedDecision(handoff)),
        }),
      );

      await gate.authorizeShare({ recipients: ['user-a@example.com'], accessLevel: 'read' });

      const successDiags = diagnostics.events.filter((e) => e.code === 'SHARE_AUTHORIZED');
      expect(successDiags).toHaveLength(1);
    });

    it('emits diagnostics for denied authorization', async () => {
      const diagnostics = createMockDiagnostics();

      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          diagnostics,
          documentAuthorization: createMockAuthorizationService(() => makeDeniedDecision('delete')),
        }),
      );

      await gate.authorizeDelete({ permanence: 'trash' }).catch(() => {});

      const denialDiags = diagnostics.events.filter((e) => e.code === 'DELETE_DENIED_BY_POLICY');
      expect(denialDiags).toHaveLength(1);
    });

    it('emits diagnostics for nonce replay', async () => {
      const diagnostics = createMockDiagnostics();
      const handoff = makeManagementHandoff('destroy');

      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          diagnostics,
          documentAuthorization: createMockAuthorizationService(() => makeAllowedDecision(handoff)),
        }),
      );

      await gate.authorizeDestroy({ scope: 'all-storage' });
      await gate.authorizeDestroy({ scope: 'all-storage' }).catch(() => {});

      const replayDiags = diagnostics.events.filter((e) => e.code === 'NONCE_REPLAY_DETECTED');
      expect(replayDiags).toHaveLength(1);
    });

    it('emits diagnostics for expired handoff', async () => {
      const diagnostics = createMockDiagnostics();
      const clock = createMockClock(10000);
      const handoff = makeManagementHandoff('share', { expiresAt: 5000 });

      const gate = createHostDocumentOperationGate(
        makeGateConfig({
          diagnostics,
          clock,
          documentAuthorization: createMockAuthorizationService(() => makeAllowedDecision(handoff)),
        }),
      );

      await gate
        .authorizeShare({ recipients: ['user@test.com'], accessLevel: 'write' })
        .catch(() => {});

      const expiryDiags = diagnostics.events.filter((e) => e.code === 'HANDOFF_EXPIRED');
      expect(expiryDiags).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // assertOperationGateInstalled
  // -------------------------------------------------------------------------

  describe('assertOperationGateInstalled', () => {
    it('throws OperationDeniedError for NO_HOST_OPERATION_GATE', () => {
      expect(() => assertOperationGateInstalled(NO_HOST_OPERATION_GATE, 'export')).toThrow(
        OperationDeniedError,
      );

      expect(() => assertOperationGateInstalled(NO_HOST_OPERATION_GATE, 'export')).toThrow(
        /requires a HostDocumentOperationGate but none is installed/,
      );
    });

    it('throws with correct operation and code', () => {
      try {
        assertOperationGateInstalled(NO_HOST_OPERATION_GATE, 'share');
        fail('Expected OperationDeniedError');
      } catch (err) {
        expect(err).toBeInstanceOf(OperationDeniedError);
        const denied = err as OperationDeniedError;
        expect(denied.operation).toBe('share');
        expect(denied.code).toBe('NO_OPERATION_GATE');
      }
    });

    it('does not throw for an installed gate', () => {
      const gate = createHostDocumentOperationGate(makeGateConfig());
      expect(() => assertOperationGateInstalled(gate, 'export')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Gate properties
  // -------------------------------------------------------------------------

  describe('gate properties', () => {
    it('has installed: true', () => {
      const gate = createHostDocumentOperationGate(makeGateConfig());
      expect(gate.installed).toBe(true);
    });
  });
});
