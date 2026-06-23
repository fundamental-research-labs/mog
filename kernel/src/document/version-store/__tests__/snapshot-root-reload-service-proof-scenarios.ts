import type { VersionGraphNamespace } from '../object-store';
import {
  createWorkbookSnapshotRootRecord,
  createYrsFullStateSnapshotRootPayload,
} from '../snapshot-root-capture';
import { createSnapshotRootReloadService } from '../snapshot-root-reload-service';

import {
  COMMIT_ID,
  FULL_STATE_BYTES,
  NAMESPACE,
  WRONG_DIGEST,
} from './snapshot-root-reload-service-test-helpers';

export function registerSnapshotRootReloadServiceProofScenarios(): void {
  it('rejects snapshot-root records from the wrong document, graph, or principal scope', async () => {
    const payload = createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES);
    const wrongNamespaces: readonly VersionGraphNamespace[] = [
      { ...NAMESPACE, documentId: 'document-2' },
      { ...NAMESPACE, graphId: 'graph-2' },
      { ...NAMESPACE, principalScope: 'principal-2' },
    ];
    let hydrateCalls = 0;
    const service = createSnapshotRootReloadService({
      hydrator: {
        hydrateYrsFullState: async () => {
          hydrateCalls += 1;
          return {
            status: 'materialized',
            materialized: undefined,
          };
        },
      },
      invariants: { expectedNamespace: NAMESPACE },
    });

    for (const wrongNamespace of wrongNamespaces) {
      const record = await createWorkbookSnapshotRootRecord(wrongNamespace, payload);
      const result = await service.reloadSnapshotRoot(record);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected reload failure');
      expect(result.error.code).toBe('wrongSnapshotRootNamespace');
      expect(result.freshLifecycleMutationGuarantee).toBe('not-started');
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'VERSION_SNAPSHOT_ROOT_RELOAD_WRONG_NAMESPACE',
          severity: 'error',
          path: 'record.namespace',
        }),
      ]);
    }

    expect(hydrateCalls).toBe(0);
  });

  it('rejects reload when required commit-root proofs are absent or nonmatching', async () => {
    const payload = createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES);
    const record = await createWorkbookSnapshotRootRecord(NAMESPACE, payload);
    let hydrateCalls = 0;
    const service = createSnapshotRootReloadService({
      hydrator: {
        hydrateYrsFullState: async () => {
          hydrateCalls += 1;
          return {
            status: 'materialized',
            materialized: undefined,
          };
        },
      },
    });

    const missingRoots = await service.reloadSnapshotRoot(record, {
      expectedNamespace: NAMESPACE,
      requireCommitRootProof: true,
    });
    const wrongRoot = await service.reloadSnapshotRoot(record, {
      expectedNamespace: NAMESPACE,
      requiredCommitRoots: [
        {
          commitId: COMMIT_ID,
          namespace: NAMESPACE,
          snapshotRootDigest: WRONG_DIGEST,
        },
      ],
    });

    for (const result of [missingRoots, wrongRoot]) {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected reload failure');
      expect(result.error.code).toBe('missingCommitRoot');
      expect(result.freshLifecycleMutationGuarantee).toBe('not-started');
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'VERSION_SNAPSHOT_ROOT_RELOAD_MISSING_COMMIT_ROOT',
          severity: 'error',
        }),
      ]);
    }
    expect(hydrateCalls).toBe(0);
  });

  it('rejects materialized reloads that cannot prove semantic identity', async () => {
    const payload = createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES);
    const record = await createWorkbookSnapshotRootRecord(NAMESPACE, payload);
    const service = createSnapshotRootReloadService({
      hydrator: {
        hydrateYrsFullState: async () => ({
          status: 'materialized',
          materialized: undefined,
        }),
      },
      invariants: {
        expectedNamespace: NAMESPACE,
        requireSemanticIdentityProof: true,
      },
    });

    const result = await service.reloadSnapshotRoot(record);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected reload failure');
    expect(result.error.code).toBe('semanticIdentityUnproven');
    expect(result.decodedByteLength).toBe(FULL_STATE_BYTES.byteLength);
    expect(result.freshLifecycleMutationGuarantee).toBe(
      'fresh-lifecycle-rejected-after-materialization',
    );
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_SNAPSHOT_ROOT_RELOAD_SEMANTIC_IDENTITY_UNPROVEN',
        severity: 'error',
      }),
    ]);
    expect('materialized' in result).toBe(false);
  });
}
