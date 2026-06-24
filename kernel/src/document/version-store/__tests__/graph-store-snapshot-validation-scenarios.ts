import { createInMemoryVersionGraphStoreFromSnapshot } from '../graph';
import { snapshotFixture, withoutDigest } from './graph-store-snapshot-test-helpers';

export function registerGraphStoreSnapshotValidationScenarios(): void {
  it('rejects snapshots with missing standalone object dependencies', async () => {
    const fixture = await snapshotFixture();
    const missingResolutionSet = withoutDigest(
      fixture.snapshot,
      fixture.resolutionSet.digest.digest,
    );

    await expect(createInMemoryVersionGraphStoreFromSnapshot(missingResolutionSet)).rejects.toThrow(
      'Version graph object snapshot failed validation.',
    );
  });

  it('rejects stale branch manifest counters before rebuilding refs', async () => {
    const fixture = await snapshotFixture();

    await expect(
      createInMemoryVersionGraphStoreFromSnapshot({
        ...fixture.snapshot,
        refStore: {
          ...fixture.snapshot.refStore,
          liveRefCount: (fixture.snapshot.refStore.liveRefCount ?? 0) + 1,
        },
      }),
    ).rejects.toThrow('Version graph ref snapshot live ref count manifest is stale.');

    await expect(
      createInMemoryVersionGraphStoreFromSnapshot({
        ...fixture.snapshot,
        refStore: {
          ...fixture.snapshot.refStore,
          nextGeneratedId: 0,
        },
      }),
    ).rejects.toThrow('Version graph ref snapshot generated id manifest is stale.');
  });

  it('rejects snapshots whose tombstone refs point at missing commit objects', async () => {
    const fixture = await snapshotFixture();
    const missingDeletedBranchCommit = withoutDigest(
      fixture.snapshot,
      fixture.deletedCommit.commit.record.digest.digest,
    );

    await expect(
      createInMemoryVersionGraphStoreFromSnapshot(missingDeletedBranchCommit),
    ).rejects.toThrow('Version graph ref snapshot references an unreadable commit object.');
  });
}
