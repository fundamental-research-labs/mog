/**
 * Host-backed import source-handle validation — unit tests.
 *
 * Verifies that import source bytes are only obtained through validated
 * source-handle resolvers. Covers positive resolution, expiry, principal
 * mismatch, session mismatch, missing resolver, replay protection, and
 * content identity verification.
 */

import type { HostDiagnosticEvent, HostDiagnosticsSink } from '@mog-sdk/types-host/diagnostics';
import type { HostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';
import type { HostDocumentRef, AuthorizedDocumentStorageHandoff } from '@mog-sdk/types-host/kernel';
import type {
  HostSourceHandleResolverRegistry,
  SourceHandleResolveResult,
  HostHandoffReplayRegistry,
  HandoffReplayKey,
} from '@mog/kernel-host-internal';

import { validateAndResolveImportSource, ImportSourceError } from '../host-import-source';
import type { ImportSourceValidationConfig } from '../host-import-source';

// =============================================================================
// Test fixtures
// =============================================================================

const TEST_PRINCIPAL_FP: HostCanonicalFingerprint = 'mog-host-fp:v1:sha256:test-principal-fp';
const TEST_RESOURCE_FP: HostCanonicalFingerprint = 'mog-host-fp:v1:sha256:test-resource-fp';
const TEST_SESSION_ID = 'test-session';
const TEST_STORAGE_INTENT_FP: HostCanonicalFingerprint = 'mog-host-fp:v1:sha256:storage-intent-fp';
const XLSX_MAGIC_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

function createMockDiagnostics(): HostDiagnosticsSink & { events: HostDiagnosticEvent[] } {
  const events: HostDiagnosticEvent[] = [];
  return {
    events,
    emit(event: HostDiagnosticEvent): void {
      events.push(event);
    },
  };
}

function createMockReplayRegistry(): HostHandoffReplayRegistry & { consumed: Set<string> } {
  const consumed = new Set<string>();
  return {
    consumed,
    consumeOnce(key: HandoffReplayKey): boolean {
      const serialized = `${key.sourceHostId}:${key.sessionId}:${key.decisionId}:${key.operation}:${key.nonce}:${key.resourceFingerprint}`;
      if (consumed.has(serialized)) return false;
      consumed.add(serialized);
      return true;
    },
  };
}

function createMockSourceResolver(opts?: {
  bytes?: Uint8Array;
  contentIdentityVerified?: boolean;
  supportedKinds?: string[];
}): HostSourceHandleResolverRegistry {
  const supported = new Set(opts?.supportedKinds ?? ['file-url', 'uploaded-bytes']);
  return {
    has(sourceKind: string): boolean {
      return supported.has(sourceKind);
    },
    async resolve(request): Promise<SourceHandleResolveResult> {
      return {
        bytes: opts?.bytes ?? XLSX_MAGIC_BYTES,
        contentIdentity: request.expectedContentIdentity,
        contentIdentityVerified: (opts?.contentIdentityVerified ?? true) as true,
        sourceHandleId: request.sourceHandleId,
      };
    },
  };
}

function createMockClock(now: number = 1700000000000): { now(): number } {
  return { now: () => now };
}

const validSourceHandleRef: HostDocumentRef = {
  kind: 'source-handle',
  sourceHandleId: 'sh-001',
  issuance: {
    source: 'trusted-source-handle-registry',
    issuanceId: 'issuance-001',
    issuerHostId: 'test-host',
    contentIdentity: { kind: 'content-hash', algorithm: 'sha256', digest: 'abc123' },
    issuedAt: 1700000000000,
    expiresAt: 1700003600000,
  },
  sourceKind: 'file-url',
  issuerHostId: 'test-host',
  sourceHostId: 'test-host',
  sourceSessionId: TEST_SESSION_ID,
  principalFingerprint: TEST_PRINCIPAL_FP,
  resourceContext: {
    tenantId: 'test-tenant',
    workspaceId: 'test-workspace',
    documentId: 'doc-001',
    resolutionSource: 'test-fixture',
  },
  expiresAt: 1700003600000,
  singleUse: true,
};

/**
 * Minimal mock storage handoff that carries sessionId for session checks.
 */
function createMockStorage(sessionId: string = TEST_SESSION_ID): AuthorizedDocumentStorageHandoff {
  return {
    operation: 'import',
    decisionId: 'decision-import-001',
    correlationId: 'correlation-import-001',
    sessionId,
    nonce: 'nonce-import-001',
    expiresAt: 1700003600000,
    storageConstraint: 'as-requested',
    principal: {
      issuer: { issuerId: 'test-issuer', issuerKind: 'test' },
      subjectId: 'test-user-001',
      tenantId: 'test-tenant',
      workspaceId: 'test-workspace',
      actorKind: 'user',
      tags: [],
    },
    resourceContext: {
      tenantId: 'test-tenant',
      workspaceId: 'test-workspace',
      documentId: 'doc-001',
      resolutionSource: 'test-fixture',
    },
    sourceHostId: 'test-host',
    storageIntentFingerprint: TEST_STORAGE_INTENT_FP,
    rawBytesPolicy: {
      kind: 'trusted-raw-provider-boundary',
      boundary: 'test-fixture',
      rawProviderBytesMayReachUntrustedClient: false,
    },
    authorizedProviders: [],
    storage: { providers: [] } as any,
  };
}

function makeConfig(
  overrides?: Partial<ImportSourceValidationConfig>,
): ImportSourceValidationConfig {
  return {
    documentRef: validSourceHandleRef,
    storage: createMockStorage(),
    sourceHandleResolvers: createMockSourceResolver(),
    replayRegistry: createMockReplayRegistry(),
    principalFingerprint: TEST_PRINCIPAL_FP,
    resourceContextFingerprint: TEST_RESOURCE_FP,
    diagnostics: createMockDiagnostics(),
    clock: createMockClock(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('validateAndResolveImportSource', () => {
  // ---------------------------------------------------------------------------
  // Positive test
  // ---------------------------------------------------------------------------

  describe('valid source-handle resolution', () => {
    it('returns validated import source with resolved bytes', async () => {
      const diagnostics = createMockDiagnostics();
      const replayRegistry = createMockReplayRegistry();
      const customBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe]);

      const result = await validateAndResolveImportSource(
        makeConfig({
          diagnostics,
          replayRegistry,
          sourceHandleResolvers: createMockSourceResolver({ bytes: customBytes }),
        }),
      );

      expect(result.bytes).toBe(customBytes);
      expect(result.sourceHandleId).toBe('sh-001');
      expect(result.sourceKind).toBe('file-url');
      expect(result.contentIdentityVerified).toBe(true);

      // Replay nonce was consumed
      expect(replayRegistry.consumed.size).toBe(1);

      // Success diagnostic emitted
      const successEvents = diagnostics.events.filter(
        (e) => e.kind === 'documentAuthorization.denied' && e.code === 'IMPORT_SOURCE_RESOLVED',
      );
      expect(successEvents).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Negative tests
  // ---------------------------------------------------------------------------

  describe('NOT_SOURCE_HANDLE_REF', () => {
    it('rejects documentRef with kind !== source-handle', async () => {
      const diagnostics = createMockDiagnostics();
      const documentRef: HostDocumentRef = {
        kind: 'document',
        documentId: 'doc-001',
      };

      await expect(
        validateAndResolveImportSource(makeConfig({ documentRef, diagnostics })),
      ).rejects.toThrow(ImportSourceError);

      await expect(
        validateAndResolveImportSource(makeConfig({ documentRef, diagnostics })),
      ).rejects.toMatchObject({
        code: 'NOT_SOURCE_HANDLE_REF',
      });

      const diags = diagnostics.events.filter(
        (e) => e.kind === 'hostConstruction.invalid' && e.code === 'NOT_SOURCE_HANDLE_REF',
      );
      expect(diags.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('SOURCE_HANDLE_EXPIRED', () => {
    it('rejects expired source handle', async () => {
      const diagnostics = createMockDiagnostics();
      // Clock is AFTER expiresAt
      const clock = createMockClock(1700003700000);

      await expect(
        validateAndResolveImportSource(makeConfig({ clock, diagnostics })),
      ).rejects.toThrow(ImportSourceError);

      await expect(
        validateAndResolveImportSource(makeConfig({ clock, diagnostics })),
      ).rejects.toMatchObject({
        code: 'SOURCE_HANDLE_EXPIRED',
      });

      const diags = diagnostics.events.filter(
        (e) => e.kind === 'hostConstruction.invalid' && e.code === 'SOURCE_HANDLE_EXPIRED',
      );
      expect(diags.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects when expiresAt equals current time (not strictly greater)', async () => {
      // expiresAt is 1700003600000, clock is exactly that
      const clock = createMockClock(1700003600000);

      await expect(validateAndResolveImportSource(makeConfig({ clock }))).rejects.toMatchObject({
        code: 'SOURCE_HANDLE_EXPIRED',
      });
    });
  });

  describe('SOURCE_HANDLE_WRONG_PRINCIPAL', () => {
    it('rejects when principal fingerprint does not match', async () => {
      const diagnostics = createMockDiagnostics();
      const wrongPrincipalFp: HostCanonicalFingerprint = 'mog-host-fp:v1:sha256:wrong-principal-fp';

      await expect(
        validateAndResolveImportSource(
          makeConfig({ principalFingerprint: wrongPrincipalFp, diagnostics }),
        ),
      ).rejects.toThrow(ImportSourceError);

      await expect(
        validateAndResolveImportSource(
          makeConfig({ principalFingerprint: wrongPrincipalFp, diagnostics }),
        ),
      ).rejects.toMatchObject({
        code: 'SOURCE_HANDLE_WRONG_PRINCIPAL',
      });

      const diags = diagnostics.events.filter(
        (e) => e.kind === 'hostConstruction.invalid' && e.code === 'SOURCE_HANDLE_WRONG_PRINCIPAL',
      );
      expect(diags.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('SOURCE_HANDLE_WRONG_SESSION', () => {
    it('rejects when source session does not match storage session', async () => {
      const diagnostics = createMockDiagnostics();
      // Storage has a different sessionId than the source handle
      const storage = createMockStorage('different-session-id');

      await expect(
        validateAndResolveImportSource(makeConfig({ storage, diagnostics })),
      ).rejects.toThrow(ImportSourceError);

      await expect(
        validateAndResolveImportSource(makeConfig({ storage, diagnostics })),
      ).rejects.toMatchObject({
        code: 'SOURCE_HANDLE_WRONG_SESSION',
      });

      const diags = diagnostics.events.filter(
        (e) => e.kind === 'hostConstruction.invalid' && e.code === 'SOURCE_HANDLE_WRONG_SESSION',
      );
      expect(diags.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('SOURCE_HANDLE_WRONG_SOURCE_HOST', () => {
    it('rejects when source host does not match storage handoff source host', async () => {
      const diagnostics = createMockDiagnostics();
      const storage = {
        ...createMockStorage(),
        sourceHostId: 'different-host',
      };

      await expect(
        validateAndResolveImportSource(makeConfig({ storage, diagnostics })),
      ).rejects.toMatchObject({
        code: 'SOURCE_HANDLE_WRONG_SOURCE_HOST',
      });

      expect(diagnostics.events).toContainEqual(
        expect.objectContaining({
          kind: 'hostConstruction.invalid',
          code: 'SOURCE_HANDLE_WRONG_SOURCE_HOST',
        }),
      );
    });
  });

  describe('SOURCE_HANDLE_ISSUER_MISMATCH', () => {
    it('rejects when issuerHostId does not match the issuance issuer', async () => {
      const diagnostics = createMockDiagnostics();
      const documentRef: HostDocumentRef = {
        ...validSourceHandleRef,
        issuerHostId: 'other-issuer',
      };

      await expect(
        validateAndResolveImportSource(makeConfig({ documentRef, diagnostics })),
      ).rejects.toMatchObject({
        code: 'SOURCE_HANDLE_ISSUER_MISMATCH',
      });
    });
  });

  describe('SOURCE_HANDLE_RESOURCE_CONTEXT_MISMATCH', () => {
    it('rejects when the source handle resource context is not the authorized storage resource', async () => {
      const documentRef: HostDocumentRef = {
        ...validSourceHandleRef,
        resourceContext: {
          ...validSourceHandleRef.resourceContext,
          documentId: 'different-doc',
        },
      };

      await expect(
        validateAndResolveImportSource(makeConfig({ documentRef })),
      ).rejects.toMatchObject({
        code: 'SOURCE_HANDLE_RESOURCE_CONTEXT_MISMATCH',
      });
    });
  });

  describe('NO_RESOLVER_FOR_SOURCE_KIND', () => {
    it('rejects when no resolver is registered for the source kind', async () => {
      const diagnostics = createMockDiagnostics();
      // Resolver only supports 'objectStore', not 'file-url'
      const sourceHandleResolvers = createMockSourceResolver({
        supportedKinds: ['objectStore'],
      });

      await expect(
        validateAndResolveImportSource(makeConfig({ sourceHandleResolvers, diagnostics })),
      ).rejects.toThrow(ImportSourceError);

      await expect(
        validateAndResolveImportSource(makeConfig({ sourceHandleResolvers, diagnostics })),
      ).rejects.toMatchObject({
        code: 'NO_RESOLVER_FOR_SOURCE_KIND',
      });

      const diags = diagnostics.events.filter(
        (e) => e.kind === 'hostConstruction.invalid' && e.code === 'NO_RESOLVER_FOR_SOURCE_KIND',
      );
      expect(diags.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('SOURCE_HANDLE_REUSED', () => {
    it('rejects when the same source handle is used twice', async () => {
      const diagnostics = createMockDiagnostics();
      const replayRegistry = createMockReplayRegistry();

      const config = makeConfig({ replayRegistry, diagnostics });

      // First call succeeds
      await validateAndResolveImportSource(config);

      // Second call with same source handle fails — replay detected
      await expect(validateAndResolveImportSource(config)).rejects.toThrow(ImportSourceError);

      await expect(
        validateAndResolveImportSource(makeConfig({ replayRegistry, diagnostics })),
      ).rejects.toMatchObject({
        code: 'SOURCE_HANDLE_REUSED',
      });

      const diags = diagnostics.events.filter(
        (e) => e.kind === 'hostConstruction.invalid' && e.code === 'SOURCE_HANDLE_REUSED',
      );
      expect(diags.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('CONTENT_IDENTITY_NOT_VERIFIED', () => {
    it('rejects when resolver returns contentIdentityVerified: false', async () => {
      const diagnostics = createMockDiagnostics();
      // Misbehaving resolver that returns false at runtime
      const sourceHandleResolvers = createMockSourceResolver({
        contentIdentityVerified: false,
      });

      await expect(
        validateAndResolveImportSource(makeConfig({ sourceHandleResolvers, diagnostics })),
      ).rejects.toThrow(ImportSourceError);

      await expect(
        validateAndResolveImportSource(makeConfig({ sourceHandleResolvers, diagnostics })),
      ).rejects.toMatchObject({
        code: 'CONTENT_IDENTITY_NOT_VERIFIED',
      });

      const diags = diagnostics.events.filter(
        (e) => e.kind === 'hostConstruction.invalid' && e.code === 'CONTENT_IDENTITY_NOT_VERIFIED',
      );
      expect(diags.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('SOURCE_HANDLE_RESULT_MISMATCH', () => {
    it('rejects when resolver returns bytes for a different source handle', async () => {
      const sourceHandleResolvers: HostSourceHandleResolverRegistry = {
        has: () => true,
        async resolve(request): Promise<SourceHandleResolveResult> {
          return {
            bytes: XLSX_MAGIC_BYTES,
            contentIdentity: request.expectedContentIdentity,
            contentIdentityVerified: true,
            sourceHandleId: 'different-source-handle',
          };
        },
      };

      await expect(
        validateAndResolveImportSource(makeConfig({ sourceHandleResolvers })),
      ).rejects.toMatchObject({
        code: 'SOURCE_HANDLE_RESULT_MISMATCH',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Ordering guarantees
  // ---------------------------------------------------------------------------

  describe('ordering guarantees', () => {
    it('consumes replay nonce BEFORE calling resolver', async () => {
      const replayRegistry = createMockReplayRegistry();
      let resolverCalledWhenNonceSize = -1;

      const sourceHandleResolvers: HostSourceHandleResolverRegistry = {
        has: () => true,
        async resolve(request): Promise<SourceHandleResolveResult> {
          resolverCalledWhenNonceSize = replayRegistry.consumed.size;
          return {
            bytes: XLSX_MAGIC_BYTES,
            contentIdentity: request.expectedContentIdentity,
            contentIdentityVerified: true,
            sourceHandleId: 'sh-001',
          };
        },
      };

      await validateAndResolveImportSource(makeConfig({ replayRegistry, sourceHandleResolvers }));

      // Nonce must have been consumed BEFORE the resolver was invoked
      expect(resolverCalledWhenNonceSize).toBe(1);
    });

    it('joins source replay protection to the storage decisionId and nonce', async () => {
      const consumedKeys: HandoffReplayKey[] = [];
      const replayRegistry: HostHandoffReplayRegistry = {
        consumeOnce(key: HandoffReplayKey): boolean {
          consumedKeys.push(key);
          return true;
        },
      };
      let resolveDecisionId: string | undefined;
      let resolveNonce: string | undefined;
      const sourceHandleResolvers: HostSourceHandleResolverRegistry = {
        has: () => true,
        async resolve(request): Promise<SourceHandleResolveResult> {
          resolveDecisionId = request.decisionId;
          resolveNonce = request.nonce;
          return {
            bytes: XLSX_MAGIC_BYTES,
            contentIdentity: request.expectedContentIdentity,
            contentIdentityVerified: true,
            sourceHandleId: request.sourceHandleId,
          };
        },
      };

      await validateAndResolveImportSource(makeConfig({ replayRegistry, sourceHandleResolvers }));

      expect(consumedKeys).toEqual([
        expect.objectContaining({
          decisionId: 'decision-import-001',
          operation: 'import-source:sh-001',
          nonce: 'nonce-import-001',
        }),
      ]);
      expect(resolveDecisionId).toBe('decision-import-001');
      expect(resolveNonce).toBe('nonce-import-001');
    });

    it('does not call resolver when validation fails early', async () => {
      let resolverCalled = false;
      const sourceHandleResolvers: HostSourceHandleResolverRegistry = {
        has: () => true,
        async resolve(request): Promise<SourceHandleResolveResult> {
          resolverCalled = true;
          return {
            bytes: XLSX_MAGIC_BYTES,
            contentIdentity: request.expectedContentIdentity,
            contentIdentityVerified: true,
            sourceHandleId: 'sh-001',
          };
        },
      };

      // Expired handle — should fail before resolver is called
      const clock = createMockClock(1700003700000);

      await expect(
        validateAndResolveImportSource(makeConfig({ sourceHandleResolvers, clock })),
      ).rejects.toMatchObject({ code: 'SOURCE_HANDLE_EXPIRED' });

      expect(resolverCalled).toBe(false);
    });

    it('does not consume replay nonce when validation fails before nonce step', async () => {
      const replayRegistry = createMockReplayRegistry();

      // Expired handle — fails at step 3, before step 7 (nonce consumption)
      const clock = createMockClock(1700003700000);

      await expect(
        validateAndResolveImportSource(makeConfig({ replayRegistry, clock })),
      ).rejects.toMatchObject({ code: 'SOURCE_HANDLE_EXPIRED' });

      expect(replayRegistry.consumed.size).toBe(0);
    });
  });
});
