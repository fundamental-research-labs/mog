/**
 * ReadOnlySnapshotProvider tests.
 *
 * The read-only Provider doesn't pass the full conformance suite (it cannot
 * persist writes), so we test the contract directly: attach loads a snapshot,
 * write operations are no-ops, and the storage provider lifecycle methods behave correctly.
 *
 * @see read-only-snapshot-provider.ts
 */

import { buildMockProviderDoc, makeUpdate } from './mock-provider-doc';
import {
  ReadOnlySnapshotProvider,
  createReadOnlySnapshotProviderFactory,
  type SnapshotResolver,
} from '../read-only-snapshot-provider';

// =============================================================================
// Test resolver
// =============================================================================

function createTestResolver(snapshots: Map<string, Uint8Array>): SnapshotResolver {
  return {
    async resolve(handle: string): Promise<Uint8Array | null> {
      return snapshots.get(handle) ?? null;
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ReadOnlySnapshotProvider', () => {
  it('attach replays snapshot from resolver into doc', async () => {
    const update = makeUpdate(42);
    const snapshots = new Map<string, Uint8Array>([['snap-1', update]]);
    const resolver = createTestResolver(snapshots);

    const provider = new ReadOnlySnapshotProvider('doc-1', 'snap-1', resolver);
    const doc = buildMockProviderDoc('doc-1');
    await provider.attach(doc);

    expect(doc.appliedCount()).toBe(1);
    await provider.detach();
  });

  it('attach with missing snapshot does not throw', async () => {
    const resolver = createTestResolver(new Map());
    const provider = new ReadOnlySnapshotProvider('doc-2', 'missing', resolver);
    const doc = buildMockProviderDoc('doc-2');

    await expect(provider.attach(doc)).resolves.toBeUndefined();
    expect(doc.appliedCount()).toBe(0);
    await provider.detach();
  });

  it('attach with empty snapshot does not call applyUpdate', async () => {
    const snapshots = new Map<string, Uint8Array>([['empty', new Uint8Array(0)]]);
    const resolver = createTestResolver(snapshots);
    const provider = new ReadOnlySnapshotProvider('doc-3', 'empty', resolver);
    const doc = buildMockProviderDoc('doc-3');
    await provider.attach(doc);

    expect(doc.appliedCount()).toBe(0);
    await provider.detach();
  });

  it('readOnly is always true', () => {
    const resolver = createTestResolver(new Map());
    const provider = new ReadOnlySnapshotProvider('doc-ro', 'x', resolver);
    expect(provider.readOnly).toBe(true);
  });

  it('appendUpdate is a no-op', async () => {
    const resolver = createTestResolver(new Map());
    const provider = new ReadOnlySnapshotProvider('doc-nop', 'x', resolver);
    await provider.attach(buildMockProviderDoc('doc-nop'));

    // Should not throw.
    provider.appendUpdate(makeUpdate(1));
    await provider.detach();
  });

  it('flush is a no-op', async () => {
    const resolver = createTestResolver(new Map());
    const provider = new ReadOnlySnapshotProvider('doc-flush', 'x', resolver);
    await provider.attach(buildMockProviderDoc('doc-flush'));

    await expect(provider.flush()).resolves.toBeUndefined();
    await provider.detach();
  });

  it('checkpointFullState is a no-op', async () => {
    const resolver = createTestResolver(new Map());
    const provider = new ReadOnlySnapshotProvider('doc-cp', 'x', resolver);
    const doc = buildMockProviderDoc('doc-cp');
    await provider.attach(doc);

    await expect(provider.checkpointFullState(doc)).resolves.toBeUndefined();
    await provider.detach();
  });

  it('flushSync is a no-op', async () => {
    const resolver = createTestResolver(new Map());
    const provider = new ReadOnlySnapshotProvider('doc-fs', 'x', resolver);
    await provider.attach(buildMockProviderDoc('doc-fs'));

    expect(() => provider.flushSync()).not.toThrow();
    await provider.detach();
  });

  it('flushFailed is always false', () => {
    const resolver = createTestResolver(new Map());
    const provider = new ReadOnlySnapshotProvider('doc-ff', 'x', resolver);
    expect(provider.flushFailed).toBe(false);
  });

  it('stateVector returns a fixed 4-byte buffer', async () => {
    const resolver = createTestResolver(new Map());
    const provider = new ReadOnlySnapshotProvider('doc-sv', 'x', resolver);
    const sv = await provider.stateVector();
    expect(sv).toBeInstanceOf(Uint8Array);
    expect(sv.length).toBe(4);
  });

  it('detach is idempotent', async () => {
    const resolver = createTestResolver(new Map());
    const provider = new ReadOnlySnapshotProvider('doc-det', 'x', resolver);
    await provider.attach(buildMockProviderDoc('doc-det'));

    await provider.detach();
    await expect(provider.detach()).resolves.toBeUndefined();
  });

  it('throws on attach after detach', async () => {
    const resolver = createTestResolver(new Map());
    const provider = new ReadOnlySnapshotProvider('doc-ad', 'x', resolver);
    await provider.attach(buildMockProviderDoc('doc-ad'));
    await provider.detach();

    await expect(provider.attach(buildMockProviderDoc('doc-ad'))).rejects.toThrow(
      'has been detached',
    );
  });

  // ---------------------------------------------------------------------------
  // the storage provider lifecycle optional methods
  // ---------------------------------------------------------------------------

  it('getCapabilities returns read-only shape', () => {
    const resolver = createTestResolver(new Map());
    const provider = new ReadOnlySnapshotProvider('doc-cap', 'x', resolver);
    const caps = provider.getCapabilities();
    expect(caps.writable).toBe(false);
    expect(caps.durable).toBe(false);
    expect(caps.fullStateCheckpoint).toBe(false);
    expect(caps.incrementalUpdateLog).toBe(false);
    expect(caps.storageCursor).toBe(true);
  });

  it('getIdentity returns StorageProviderIdentity with providerRefId', () => {
    const resolver = createTestResolver(new Map());
    const provider = new ReadOnlySnapshotProvider('doc-id', 'handle-abc', resolver);
    const id = provider.getIdentity();
    expect(id.providerRefId).toContain('doc-id');
    expect(id.storageScope.kind).toBe('explicit-no-scope');
    expect(id.contractVersion).toBe('0.3.0');
    expect(id.providerProtocolVersion).toBe('0.1.0');
  });

  it('storageCursor includes docId and handle', async () => {
    const resolver = createTestResolver(new Map());
    const provider = new ReadOnlySnapshotProvider('doc-cur', 'handle-xyz', resolver);
    const cursorBytes = await provider.storageCursor();
    const cursor = new TextDecoder().decode(cursorBytes);
    expect(cursor).toContain('doc-cur');
    expect(cursor).toContain('handle-xyz');
  });

  it('createReadOnlySnapshotProviderFactory closes over the resolver', () => {
    const snapshots = new Map<string, Uint8Array>([['snap-f', makeUpdate(99)]]);
    const resolver = createTestResolver(snapshots);
    const factory = createReadOnlySnapshotProviderFactory(resolver);

    const p = factory('doc-f', 'snap-f');
    expect(p).toBeInstanceOf(ReadOnlySnapshotProvider);
    expect(p.getIdentity().providerRefId).toContain('doc-f');
    expect(p.getIdentity().contractVersion).toBe('0.3.0');
  });
});
