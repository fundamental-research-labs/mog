/**
 * RedactedPublishedSnapshotProvider tests.
 *
 * Like ReadOnlySnapshotProvider, this is read-only so does not pass the
 * full write-oriented conformance suite. Tests cover: attach with policy
 * validation, generation proof, rejection paths, write-op no-ops, and
 * the storage provider lifecycle methods.
 *
 * @see redacted-published-snapshot-provider.ts
 */

import { buildMockProviderDoc, makeUpdate } from './mock-provider-doc';
import {
  RedactedPublishedSnapshotProvider,
  createRedactedPublishedSnapshotProviderFactory,
  type PublishedSnapshotResolver,
  type PublishedSnapshotResult,
} from '../redacted-published-snapshot-provider';

// =============================================================================
// Test resolver
// =============================================================================

function createTestResolver(opts: {
  snapshots: Map<string, { snapshot: Uint8Array; generationProof: string }>;
  validPolicies: Set<string>;
}): PublishedSnapshotResolver {
  return {
    async resolve(handle: string, policyId: string): Promise<PublishedSnapshotResult | null> {
      if (!opts.validPolicies.has(policyId)) return null;
      const entry = opts.snapshots.get(handle);
      if (!entry) return null;
      return { snapshot: entry.snapshot, generationProof: entry.generationProof };
    },
    async validatePolicy(policyId: string): Promise<boolean> {
      return opts.validPolicies.has(policyId);
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('RedactedPublishedSnapshotProvider', () => {
  const defaultUpdate = makeUpdate(77);
  const defaultProof = 'proof-abc-123';
  const defaultPolicy = 'policy-1';

  function makeResolver() {
    return createTestResolver({
      snapshots: new Map([
        ['pub-snap-1', { snapshot: defaultUpdate, generationProof: defaultProof }],
      ]),
      validPolicies: new Set([defaultPolicy]),
    });
  }

  it('attach validates policy and applies snapshot', async () => {
    const resolver = makeResolver();
    const provider = new RedactedPublishedSnapshotProvider(
      'doc-1',
      'pub-snap-1',
      defaultPolicy,
      resolver,
    );
    const doc = buildMockProviderDoc('doc-1');
    await provider.attach(doc);

    expect(doc.appliedCount()).toBe(1);
    await provider.detach();
  });

  it('attach throws when policy is invalid', async () => {
    const resolver = makeResolver();
    const provider = new RedactedPublishedSnapshotProvider(
      'doc-2',
      'pub-snap-1',
      'invalid-policy',
      resolver,
    );
    const doc = buildMockProviderDoc('doc-2');

    await expect(provider.attach(doc)).rejects.toThrow('invalid or expired');
  });

  it('attach throws when snapshot not found', async () => {
    const resolver = makeResolver();
    const provider = new RedactedPublishedSnapshotProvider(
      'doc-3',
      'missing-snap',
      defaultPolicy,
      resolver,
    );
    const doc = buildMockProviderDoc('doc-3');

    await expect(provider.attach(doc)).rejects.toThrow('not found');
  });

  it('attach throws after detach', async () => {
    const resolver = makeResolver();
    const provider = new RedactedPublishedSnapshotProvider(
      'doc-4',
      'pub-snap-1',
      defaultPolicy,
      resolver,
    );
    await provider.attach(buildMockProviderDoc('doc-4'));
    await provider.detach();

    await expect(provider.attach(buildMockProviderDoc('doc-4'))).rejects.toThrow(
      'has been detached',
    );
  });

  it('readOnly is always true', () => {
    const resolver = makeResolver();
    const provider = new RedactedPublishedSnapshotProvider(
      'doc-ro',
      'pub-snap-1',
      defaultPolicy,
      resolver,
    );
    expect(provider.readOnly).toBe(true);
  });

  it('appendUpdate is a no-op', async () => {
    const resolver = makeResolver();
    const provider = new RedactedPublishedSnapshotProvider(
      'doc-nop',
      'pub-snap-1',
      defaultPolicy,
      resolver,
    );
    await provider.attach(buildMockProviderDoc('doc-nop'));

    // Should not throw.
    provider.appendUpdate(makeUpdate(1));
    await provider.detach();
  });

  it('flush is a no-op', async () => {
    const resolver = makeResolver();
    const provider = new RedactedPublishedSnapshotProvider(
      'doc-flush',
      'pub-snap-1',
      defaultPolicy,
      resolver,
    );
    await provider.attach(buildMockProviderDoc('doc-flush'));

    await expect(provider.flush()).resolves.toBeUndefined();
    await provider.detach();
  });

  it('checkpointFullState is a no-op', async () => {
    const resolver = makeResolver();
    const provider = new RedactedPublishedSnapshotProvider(
      'doc-cp',
      'pub-snap-1',
      defaultPolicy,
      resolver,
    );
    const doc = buildMockProviderDoc('doc-cp');
    await provider.attach(doc);

    await expect(provider.checkpointFullState(doc)).resolves.toBeUndefined();
    await provider.detach();
  });

  it('flushSync is a no-op', async () => {
    const resolver = makeResolver();
    const provider = new RedactedPublishedSnapshotProvider(
      'doc-fs',
      'pub-snap-1',
      defaultPolicy,
      resolver,
    );
    await provider.attach(buildMockProviderDoc('doc-fs'));

    expect(() => provider.flushSync()).not.toThrow();
    await provider.detach();
  });

  it('flushFailed is always false', () => {
    const resolver = makeResolver();
    const provider = new RedactedPublishedSnapshotProvider(
      'doc-ff',
      'pub-snap-1',
      defaultPolicy,
      resolver,
    );
    expect(provider.flushFailed).toBe(false);
  });

  it('stateVector returns a fixed 4-byte buffer', async () => {
    const resolver = makeResolver();
    const provider = new RedactedPublishedSnapshotProvider(
      'doc-sv',
      'pub-snap-1',
      defaultPolicy,
      resolver,
    );
    const sv = await provider.stateVector();
    expect(sv).toBeInstanceOf(Uint8Array);
    expect(sv.length).toBe(4);
  });

  it('detach is idempotent', async () => {
    const resolver = makeResolver();
    const provider = new RedactedPublishedSnapshotProvider(
      'doc-det',
      'pub-snap-1',
      defaultPolicy,
      resolver,
    );
    await provider.attach(buildMockProviderDoc('doc-det'));

    await provider.detach();
    await expect(provider.detach()).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // the storage provider lifecycle optional methods
  // ---------------------------------------------------------------------------

  it('getCapabilities returns read-only shape', () => {
    const resolver = makeResolver();
    const provider = new RedactedPublishedSnapshotProvider(
      'doc-cap',
      'pub-snap-1',
      defaultPolicy,
      resolver,
    );
    const caps = provider.getCapabilities();
    expect(caps.writable).toBe(false);
    expect(caps.durable).toBe(false);
    expect(caps.fullStateCheckpoint).toBe(false);
    expect(caps.incrementalUpdateLog).toBe(false);
    expect(caps.storageCursor).toBe(true);
  });

  it('getIdentity returns StorageProviderIdentity with providerRefId', () => {
    const resolver = makeResolver();
    const provider = new RedactedPublishedSnapshotProvider(
      'doc-id',
      'handle-pub',
      'policy-pub',
      resolver,
    );
    const id = provider.getIdentity();
    expect(id.providerRefId).toContain('doc-id');
    expect(id.storageScope.kind).toBe('explicit-no-scope');
    expect(id.contractVersion).toBe('0.3.0');
    expect(id.providerProtocolVersion).toBe('0.1.0');
  });

  it('storageCursor includes docId, handle, and policyId', async () => {
    const resolver = makeResolver();
    const provider = new RedactedPublishedSnapshotProvider(
      'doc-cur',
      'handle-xyz',
      'pol-abc',
      resolver,
    );
    const cursorBytes = await provider.storageCursor();
    const cursor = new TextDecoder().decode(cursorBytes);
    expect(cursor).toContain('doc-cur');
    expect(cursor).toContain('handle-xyz');
    expect(cursor).toContain('pol-abc');
  });

  it('createRedactedPublishedSnapshotProviderFactory closes over the resolver', () => {
    const resolver = makeResolver();
    const factory = createRedactedPublishedSnapshotProviderFactory(resolver);

    const p = factory('doc-f', 'pub-snap-1', defaultPolicy);
    expect(p).toBeInstanceOf(RedactedPublishedSnapshotProvider);
    expect(p.getIdentity().providerRefId).toContain('doc-f');
    expect(p.getIdentity().contractVersion).toBe('0.3.0');
  });
});
