import {
  createCommitFixture,
  createService,
  createStores,
  expectPlanOk,
} from './checkout-service-test-helpers';

describe('CheckoutMaterializationService planning', () => {
  it('creates a stable full-snapshot materialization plan for an explicit commit', async () => {
    const stores = createStores();
    const root = await createCommitFixture(stores, 'root');
    const child = await createCommitFixture(stores, 'child', {
      parentCommitIds: [root.commit.id],
      mutationSegmentPayloads: [{ segmentId: 'segment-1' }],
    });
    const service = createService(stores);

    const result = await service.planCheckout({
      target: 'commit',
      commitId: child.commit.id,
    });

    expectPlanOk(result);
    expect(result.mutationGuarantee).toBe('no-workbook-mutation');
    expect(Object.isFrozen(result.plan)).toBe(true);
    expect(result.plan).toMatchObject({
      strategy: 'fullSnapshot',
      resolvedTarget: { kind: 'commit', commitId: child.commit.id },
      commitId: child.commit.id,
      parentCommitIds: [root.commit.id],
      snapshotRootDigest: child.snapshotRootRecord.digest,
      semanticChangeSetDigest: child.semanticChangeSetRecord.digest,
      mutationSegmentDigests: [child.mutationSegmentRecords[0].digest],
    });
    expect(result.plan.requiredDependencies.map((dependency) => dependency.role)).toEqual([
      'snapshotRoot',
      'semanticChangeSet',
      'mutationSegment',
    ]);
    expect(result.plan.requiredDependencyDigests).toEqual([
      child.snapshotRootRecord.digest,
      child.semanticChangeSetRecord.digest,
      child.mutationSegmentRecords[0].digest,
    ]);
  });
});
