import { createHostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';
import type {
  HostDocumentAuthorizationRequest,
  HostExportContentPolicy,
  KernelDocumentHighWaterMarkProof,
} from '@mog-sdk/types-host/kernel';
import { createStandaloneBrowserShellHost } from './standalone-browser-host';

describe('createStandaloneBrowserShellHost export authorization', () => {
  it('authorizes local raw XLSX downloads with the kernel high-water proof', async () => {
    const host = createStandaloneBrowserShellHost({
      documentId: 'doc-export',
      wasmBaseUrl: '/',
      workerUrl: '/worker.js',
    });

    try {
      const { kernelContext } = host;
      const issuedAt = Date.now();
      const rawMaterializationProof = {
        source: 'rust-policy-engine' as const,
        decisionId: 'raw-export-decision',
        sessionId: kernelContext.session.sessionId,
        principalFingerprint: createHostCanonicalFingerprint(kernelContext.principal),
        resourceContextFingerprint: createHostCanonicalFingerprint(
          kernelContext.storage.resourceContext,
        ),
        target: 'raw-document-materialization' as const,
        scope: 'entire-document' as const,
        effectiveLevel: 'raw-materialize' as const,
        childPolicyResolution: 'all-materialized-targets-raw-authorized' as const,
        correlationId: 'raw-export-correlation',
        issuedAt,
      };
      const contentPolicy: HostExportContentPolicy = {
        kind: 'authorized-raw-snapshot',
        rawMaterializationProof,
      };
      const documentHighWaterMark: KernelDocumentHighWaterMarkProof = {
        source: 'kernel-write-gate',
        proofId: 'proof-export-001',
        registryId: 'registry-export-001',
        sessionId: kernelContext.session.sessionId,
        resourceContextFingerprint: rawMaterializationProof.resourceContextFingerprint,
        mutationWatermark: '0',
        exportPathId: 'workbook.toXlsx',
        format: 'xlsx',
        contentPolicyFingerprint: createHostCanonicalFingerprint(contentPolicy),
        destination: 'download',
        requestedExportSinkRefs: [],
        issuedAt,
        expiresAt: issuedAt + 30_000,
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
        canonicalPayloadHash: createHostCanonicalFingerprint({
          source: 'kernel-write-gate',
          mutationWatermark: '0',
          exportPathId: 'workbook.toXlsx',
          format: 'xlsx',
          destination: 'download',
          requestedExportSinkRefs: [],
          contentPolicy,
        }),
        verification: {
          kind: 'live-kernel-write-gate-registry',
          registryId: 'registry-export-001',
        },
      };
      const request: HostDocumentAuthorizationRequest = {
        correlationId: 'export-correlation',
        principal: kernelContext.principal,
        resourceContext: kernelContext.storage.resourceContext,
        documentRef: kernelContext.storage.documentRef,
        sourceHostId: kernelContext.storage.sourceHostId,
        details: {
          operation: 'export',
          format: 'xlsx',
          exportPathId: 'workbook.toXlsx',
          documentHighWaterMark,
          destination: 'download',
          requestedExportSinkRefs: [],
          contentPolicy,
        },
      };

      const decision = await kernelContext.documentAuthorization.authorize(request);

      expect(decision.allowed).toBe(true);
      if (!decision.allowed) throw new Error(decision.reason);
      expect(decision.handoff.operation).toBe('export');
      if (decision.handoff.operation !== 'export') {
        throw new Error(`Expected export handoff, got ${decision.handoff.operation}`);
      }
      expect(decision.handoff.exportMaterialization).toMatchObject({
        grantKind: 'export-byte-materialization',
        format: 'xlsx',
        exportPathId: 'workbook.toXlsx',
        destination: 'download',
        documentHighWaterMark,
        contentPolicy,
      });
      expect(decision.handoff.exportMaterialization.materializationNonce).toBe(
        decision.handoff.nonce,
      );
    } finally {
      await host.dispose();
    }
  });
});
