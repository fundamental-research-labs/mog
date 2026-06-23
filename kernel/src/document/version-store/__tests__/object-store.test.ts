import { createInMemoryVersionObjectStore } from '../object-store';
import { VERSION_OBJECT_MIN_COMPATIBILITY_VERSION } from '../object-header';
import type { VersionDependencyRef } from '../object-digest';
import {
  digest,
  expectSuccess,
  HEX_A,
  HEX_B,
  HEX_C,
  NAMESPACE,
  objectRef,
  record,
} from './object-store-test-utils';

describe('version object store canonical digests', () => {
  it('writes N-1 reader and writer compatibility bounds into new object headers', async () => {
    const semanticChangeSet = await record({ changes: [{ id: 'header-bounds' }] });
    const store = createInMemoryVersionObjectStore(NAMESPACE);

    expect(semanticChangeSet.preimage).toMatchObject({
      minReaderVersion: VERSION_OBJECT_MIN_COMPATIBILITY_VERSION,
      minWriterVersion: VERSION_OBJECT_MIN_COMPATIBILITY_VERSION,
    });

    expectSuccess(await store.putObjects([semanticChangeSet]));
    await expect(store.getObjectRecord(objectRef(semanticChangeSet))).resolves.toMatchObject({
      preimage: {
        minReaderVersion: VERSION_OBJECT_MIN_COMPATIBILITY_VERSION,
        minWriterVersion: VERSION_OBJECT_MIN_COMPATIBILITY_VERSION,
      },
    });
  });

  it('keeps digests stable when canonical JSON payload keys are reordered', async () => {
    const first = await record({ z: { beta: 2, alpha: 1 }, a: ['x', { d: 4, c: 3 }] });
    const second = await record({ a: ['x', { c: 3, d: 4 }], z: { alpha: 1, beta: 2 } });

    expect(first.digest).toEqual(second.digest);
    expect(first.payloadByteLength).toBe(second.payloadByteLength);
    expect(first.preimageByteLength).toBe(second.preimageByteLength);
  });

  it('sorts dependencies before hashing and changes the digest when dependency content changes', async () => {
    const snapshotDependency: VersionDependencyRef = {
      kind: 'object',
      objectType: 'workbook.snapshotRoot.v1',
      digest: digest(HEX_B),
    };
    const mutationDependency: VersionDependencyRef = {
      kind: 'object',
      objectType: 'workbook.mutationSegment.v1',
      digest: digest(HEX_A),
    };

    const first = await record({ changes: [] }, [snapshotDependency, mutationDependency]);
    const second = await record({ changes: [] }, [mutationDependency, snapshotDependency]);
    const changed = await record({ changes: [] }, [
      mutationDependency,
      { ...snapshotDependency, digest: digest(HEX_C) },
    ]);

    expect(first.digest).toEqual(second.digest);
    expect(changed.digest.digest).not.toBe(first.digest.digest);
  });
});
