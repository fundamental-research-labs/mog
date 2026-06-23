import {
  createWorkbookSnapshotRootRecord,
  createYrsFullStateSnapshotRootPayload,
  decodeYrsFullStateSnapshotRootPayload,
} from '../snapshot-root-capture';
import {
  createSnapshotRootReloadService,
  type SnapshotRootFreshLifecycleHydrationInput,
  type SnapshotRootReloadCommitRootProof,
  type SnapshotRootSemanticIdentityVerificationInput,
} from '../snapshot-root-reload-service';

import {
  COMMIT_ID,
  FULL_STATE_BYTES,
  NAMESPACE,
} from './snapshot-root-reload-service-test-helpers';

export function registerSnapshotRootReloadServiceSuccessScenarios(): void {
  it('validates and decodes a workbook snapshot-root record before hydrating a fresh lifecycle', async () => {
    const payload = createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES);
    const record = await createWorkbookSnapshotRootRecord(NAMESPACE, payload);
    const hydrationInputs: SnapshotRootFreshLifecycleHydrationInput[] = [];
    const service = createSnapshotRootReloadService<{ readonly documentId: string }>({
      hydrator: {
        hydrateYrsFullState: async (input) => {
          hydrationInputs.push(input);
          return {
            status: 'materialized',
            materialized: { documentId: 'fresh-document' },
          };
        },
      },
    });

    const result = await service.reloadSnapshotRoot(record);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected reload success: ${result.error.code}`);
    expect(result.materialization).toBe('fresh-lifecycle');
    expect(result.materialized).toEqual({ documentId: 'fresh-document' });
    expect(result.decodedByteLength).toBe(FULL_STATE_BYTES.byteLength);
    expect(result.mutationGuarantee).toBe('no-current-workbook-mutation');
    expect(result.freshLifecycleMutationGuarantee).toBe('fresh-lifecycle-materialized');
    expect(hydrationInputs).toHaveLength(1);
    expect(hydrationInputs[0]).toMatchObject({
      byteLength: FULL_STATE_BYTES.byteLength,
      source: 'record',
      objectDigest: record.digest,
    });
    expect(hydrationInputs[0].objectDigest).not.toBe(record.digest);
    expect(Array.from(hydrationInputs[0].yrsFullStateBytes)).toEqual([...FULL_STATE_BYTES]);
  });

  it('passes namespace, commit-root, and semantic-identity proofs through strict reload', async () => {
    const payload = createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES);
    const record = await createWorkbookSnapshotRootRecord(NAMESPACE, payload);
    const commitRoot: SnapshotRootReloadCommitRootProof = {
      commitId: COMMIT_ID,
      namespace: NAMESPACE,
      snapshotRootDigest: record.digest,
    };
    const hydrationInputs: SnapshotRootFreshLifecycleHydrationInput[] = [];
    const verifierInputs: SnapshotRootSemanticIdentityVerificationInput<{
      readonly documentId: string;
    }>[] = [];
    const service = createSnapshotRootReloadService<{ readonly documentId: string }>({
      hydrator: {
        hydrateYrsFullState: async (input) => {
          hydrationInputs.push(input);
          return {
            status: 'materialized',
            materialized: { documentId: 'fresh-document' },
          };
        },
      },
      invariants: {
        expectedNamespace: NAMESPACE,
        requiredCommitRoots: [commitRoot],
        requireSemanticIdentityProof: true,
        semanticIdentityVerifier: async (input) => {
          verifierInputs.push(input);
          return {
            ok: true,
            proof: {
              proofKind: 'test-semantic-full-state',
              semanticIdentityDigest: record.digest,
              details: { source: 'verifier' },
            },
          };
        },
      },
    });

    const result = await service.reloadSnapshotRoot(record);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected reload success: ${result.error.code}`);
    expect(hydrationInputs).toHaveLength(1);
    expect(hydrationInputs[0]).toMatchObject({
      namespace: NAMESPACE,
      requiredCommitRoots: [commitRoot],
    });
    expect(verifierInputs).toHaveLength(1);
    expect(verifierInputs[0]).toMatchObject({
      namespace: NAMESPACE,
      objectDigest: record.digest,
      decodedByteLength: FULL_STATE_BYTES.byteLength,
      requiredCommitRoots: [commitRoot],
    });
    expect(Array.from(verifierInputs[0].yrsFullStateBytes)).toEqual([...FULL_STATE_BYTES]);
    expect(result.semanticIdentityProof).toEqual({
      proofKind: 'test-semantic-full-state',
      semanticIdentityDigest: record.digest,
      details: { source: 'verifier' },
    });
  });

  it('does not let the hydrator mutate the original snapshot-root payload bytes', async () => {
    const payload = createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES);
    const observedBytes: number[][] = [];
    const service = createSnapshotRootReloadService({
      hydrator: {
        hydrateYrsFullState: async (input) => {
          observedBytes.push([...input.yrsFullStateBytes]);
          input.yrsFullStateBytes.fill(255);
          return {
            status: 'materialized',
            materialized: undefined,
          };
        },
      },
    });

    const first = await service.reloadSnapshotRoot(payload);
    const second = await service.reloadSnapshotRoot(payload);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(observedBytes).toEqual([[...FULL_STATE_BYTES], [...FULL_STATE_BYTES]]);
    expect(Array.from(decodeYrsFullStateSnapshotRootPayload(payload))).toEqual([
      ...FULL_STATE_BYTES,
    ]);
  });
}
