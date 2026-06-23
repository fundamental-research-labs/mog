import { completePendingRemoteSegmentWithIdempotencyAssertions } from './pending-remote-segment-store-memory-completion-scenarios';
import { createPendingRemoteSegmentMemoryHarness } from './pending-remote-segment-store-memory-harness';
import { reservePendingRemoteSegmentWithIdempotencyAndConflictAssertions } from './pending-remote-segment-store-memory-reservation-scenarios';
import { assertPendingRemoteSegmentMemorySnapshotReload } from './pending-remote-segment-store-memory-snapshot-scenarios';

export function registerPendingRemoteSegmentStoreMemoryPersistenceScenarios(): void {
  it('reserves, reads, completes, and snapshots pending remote segments idempotently', async () => {
    const harness = await createPendingRemoteSegmentMemoryHarness();

    await reservePendingRemoteSegmentWithIdempotencyAndConflictAssertions(harness);
    await completePendingRemoteSegmentWithIdempotencyAssertions(harness);
    await assertPendingRemoteSegmentMemorySnapshotReload(harness);
  });
}
