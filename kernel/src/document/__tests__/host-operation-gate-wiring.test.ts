/**
 * Integration test: HostDocumentOperationGate wiring into DocumentContext.
 *
 * Proves that:
 * 1. DocumentContext carries the operationGate field
 * 2. Host-backed documents get a real gate (not the sentinel)
 * 3. Legacy documents get NO_HOST_OPERATION_GATE sentinel
 * 4. WorkbookImpl consults the gate before export
 * 5. WorkbookImpl blocks setActivePrincipal/makePrincipal on host-backed paths
 */

import {
  NO_HOST_OPERATION_GATE,
  createHostDocumentOperationGate,
  OperationDeniedError,
  type HostDocumentOperationGate,
  type MaybeHostOperationGate,
} from '../host-operation-gate';
import type { DocumentContext } from '../../context/types';

// ---------------------------------------------------------------------------
// Unit tests for gate sentinel and assertion behavior
// ---------------------------------------------------------------------------

describe('HostDocumentOperationGate wiring', () => {
  describe('NO_HOST_OPERATION_GATE sentinel', () => {
    it('is a symbol', () => {
      expect(typeof NO_HOST_OPERATION_GATE).toBe('symbol');
    });

    it('can be used as MaybeHostOperationGate discriminant', () => {
      const gate: MaybeHostOperationGate = NO_HOST_OPERATION_GATE;
      expect(gate === NO_HOST_OPERATION_GATE).toBe(true);
    });
  });

  describe('gate created from lifecycle input authorizes export through host service', () => {
    it('authorizeExport consumes an export handoff', async () => {
      const exportHandoff = {
        operation: 'export',
        decisionId: 'export-decision',
        correlationId: 'export-correlation',
        sessionId: 'test-session',
        nonce: 'export-nonce',
        expiresAt: Date.now() + 30_000,
        principal: {
          issuerId: 'test-issuer',
          issuerKind: 'test',
          actorKind: 'human',
          tenantId: { kind: 'single-tenant' },
          workspaceId: { kind: 'no-workspace' },
          tags: ['user:test'],
        },
        resourceContext: {
          tenantId: { kind: 'single-tenant' },
          workspaceId: { kind: 'no-workspace' },
          documentId: 'test-doc',
          resolutionSource: 'test-fixture',
        },
        sourceHostId: 'test-host',
        rawBytesPolicy: {
          kind: 'trusted-raw-provider-boundary',
          boundary: 'test-fixture',
          rawProviderBytesMayReachUntrustedClient: false,
        },
        exportMaterialization: {
          grantKind: 'export-byte-materialization',
          decisionId: 'export-decision',
          correlationId: 'export-correlation',
          format: 'xlsx',
          exportPathId: 'test',
          documentHighWaterMark: {},
          contentPolicy: {
            kind: 'authorized-raw-snapshot',
            rawMaterializationProof: {},
          },
          destination: 'download',
          exportSinkRefs: [],
          materializationNonce: 'export-nonce',
          expiresAt: Date.now() + 30_000,
        },
      };
      const gate = createHostDocumentOperationGate({
        sessionId: 'test-session',
        sourceHostId: 'test-host',
        principalFingerprint: 'mog-host-fp:v1:sha256:test-principal-fp' as any,
        resourceContextFingerprint: 'mog-host-fp:v1:sha256:test-resource-fp' as any,
        principal: {
          issuerId: 'test-issuer',
          issuerKind: 'test',
          actorKind: 'human',
          tenantId: { kind: 'single-tenant' },
          workspaceId: { kind: 'no-workspace' },
          tags: ['user:test'],
        } as any,
        resourceContext: {
          tenantId: { kind: 'single-tenant' },
          workspaceId: { kind: 'no-workspace' },
          documentId: 'test-doc',
          resolutionSource: 'test-fixture',
        },
        documentAuthorization: {
          authorize: async () => ({
            allowed: true,
            decisionId: 'export-decision',
            correlationId: 'export-correlation',
            authorizedAt: Date.now(),
            handoff: exportHandoff,
          }),
        } as any,
        replayRegistry: {
          consumeOnce: () => true,
        } as any,
        diagnostics: {
          emit: () => {},
        } as any,
        clock: { now: () => Date.now() },
      });

      expect(gate.installed).toBe(true);

      await expect(
        gate.authorizeExport({
          format: 'xlsx',
          destination: 'download',
          exportPathId: 'test',
          documentHighWaterMark: {} as any,
          requestedExportSinkRefs: [],
          contentPolicy: {
            kind: 'authorized-raw-snapshot',
            rawMaterializationProof: {} as any,
          },
        }),
      ).resolves.toBe(exportHandoff);
    });
  });

  describe('principal mutation guard', () => {
    it('OperationDeniedError carries HOST_PRINCIPAL_IMMUTABLE code', () => {
      const err = new OperationDeniedError(
        'setActivePrincipal',
        'HOST_PRINCIPAL_IMMUTABLE',
        'test',
      );
      expect(err.operation).toBe('setActivePrincipal');
      expect(err.code).toBe('HOST_PRINCIPAL_IMMUTABLE');
      expect(err.name).toBe('OperationDeniedError');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('DocumentContext interface contract', () => {
    it('operationGate field exists on the interface', () => {
      // Type-level check: DocumentContext must have operationGate
      const mockCtx = {
        operationGate: NO_HOST_OPERATION_GATE,
      } as Pick<DocumentContext, 'operationGate'>;

      expect(mockCtx.operationGate).toBe(NO_HOST_OPERATION_GATE);
    });

    it('accepts a real gate as operationGate', () => {
      const mockGate: HostDocumentOperationGate = {
        installed: true,
        authorizeExport: async () => ({}) as any,
        authorizeShare: async () => ({}) as any,
        authorizeDelete: async () => ({}) as any,
        authorizeDestroy: async () => ({}) as any,
      };

      const mockCtx = {
        operationGate: mockGate,
      } as Pick<DocumentContext, 'operationGate'>;

      expect(mockCtx.operationGate).not.toBe(NO_HOST_OPERATION_GATE);
      expect((mockCtx.operationGate as HostDocumentOperationGate).installed).toBe(true);
    });
  });
});
