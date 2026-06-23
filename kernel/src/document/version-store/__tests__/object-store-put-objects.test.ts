import {
  VersionObjectMemoryBackend,
  createInMemoryVersionObjectStore,
  type VersionObjectRecord,
} from '../object-store';
import {
  digest,
  expectFailedCode,
  expectSuccess,
  HEX_C,
  NAMESPACE,
  objectRef,
  record,
} from './object-store-test-utils';

describe('InMemoryVersionObjectStore putObjects', () => {
  it('satisfies dependencies from objects in the same batch', async () => {
    const store = createInMemoryVersionObjectStore(NAMESPACE);
    const snapshot = await record({ sheets: [] }, [], 'workbook.snapshotRoot.v1');
    const semanticChangeSet = await record({ changes: [] }, [objectRef(snapshot)]);

    const result = await store.putObjects([semanticChangeSet, snapshot]);

    expectSuccess(result);
    await expect(store.getObject(objectRef(semanticChangeSet))).resolves.toEqual({ changes: [] });
    await expect(store.getObject(objectRef(snapshot))).resolves.toEqual({ sheets: [] });
  });

  it('rejects missing dependencies and leaves the batch absent', async () => {
    const store = createInMemoryVersionObjectStore(NAMESPACE);
    const missingSnapshot = await record({ sheets: [] }, [], 'workbook.snapshotRoot.v1');
    const semanticChangeSet = await record({ changes: [] }, [objectRef(missingSnapshot)]);

    const result = await store.putObjects([semanticChangeSet]);

    expectFailedCode(result, 'VERSION_MISSING_DEPENDENCY');
    await expect(store.hasObject(objectRef(semanticChangeSet))).resolves.toBe(false);
  });

  it('rejects partial admission failures without writing earlier valid records', async () => {
    const store = createInMemoryVersionObjectStore(NAMESPACE);
    const admittedFirst = await record({ changes: [{ id: 'admitted-first' }] });
    const invalidSecond = await record({ changes: [{ id: 'invalid-second' }] });

    const result = await store.putObjects([
      admittedFirst,
      {
        ...invalidSecond,
        payloadByteLength: invalidSecond.payloadByteLength + 1,
      },
    ]);

    expectFailedCode(result, 'VERSION_BYTE_LENGTH_MISMATCH');
    await expect(store.hasObject(objectRef(admittedFirst))).resolves.toBe(false);
    await expect(store.hasObject(objectRef(invalidSecond))).resolves.toBe(false);
  });

  it('rejects duplicate object refs with mismatched payloads without choosing a winner', async () => {
    const store = createInMemoryVersionObjectStore(NAMESPACE);
    const original = await record({ changes: [{ id: 'original' }] });
    const conflictingPayload = await record({ changes: [{ id: 'conflicting' }] });
    const duplicateRefWithDifferentPayload: VersionObjectRecord<unknown> = {
      ...conflictingPayload,
      digest: original.digest,
    };

    const result = await store.putObjects([original, duplicateRefWithDifferentPayload]);

    expectFailedCode(result, 'VERSION_OBJECT_CORRUPTION');
    await expect(store.hasObject(objectRef(original))).resolves.toBe(false);
    await expect(store.hasObject(objectRef(conflictingPayload))).resolves.toBe(false);
  });

  it('rejects dependency validation failures without writing independent batch records', async () => {
    const store = createInMemoryVersionObjectStore(NAMESPACE);
    const independent = await record({ changes: [{ id: 'independent' }] });
    const missingSnapshot = await record({ sheets: [] }, [], 'workbook.snapshotRoot.v1');
    const dependent = await record({ changes: [{ id: 'dependent' }] }, [
      objectRef(missingSnapshot),
    ]);

    const result = await store.putObjects([independent, dependent]);

    expectFailedCode(result, 'VERSION_MISSING_DEPENDENCY');
    await expect(store.hasObject(objectRef(independent))).resolves.toBe(false);
    await expect(store.hasObject(objectRef(dependent))).resolves.toBe(false);
  });

  it('is idempotent for the same record', async () => {
    const store = createInMemoryVersionObjectStore(NAMESPACE);
    const semanticChangeSet = await record({ changes: [{ id: 'change-1' }] });

    expectSuccess(await store.putObjects([semanticChangeSet]));
    expectSuccess(await store.putObjects([semanticChangeSet]));

    await expect(store.getObject(objectRef(semanticChangeSet))).resolves.toEqual({
      changes: [{ id: 'change-1' }],
    });
  });

  it('rejects a same-digest different-record write as corruption', async () => {
    const backend = new VersionObjectMemoryBackend();
    const store = createInMemoryVersionObjectStore(NAMESPACE, { backend });
    const semanticChangeSet = await record({ changes: [{ id: 'change-1' }] });
    const conflictingRecord = await record({ changes: [{ id: 'change-2' }] });
    backend.putCorruptRecordForTesting(NAMESPACE, semanticChangeSet.digest, conflictingRecord);

    const result = await store.putObjects([semanticChangeSet]);

    expectFailedCode(result, 'VERSION_OBJECT_CORRUPTION');
    await expect(store.getObject(objectRef(semanticChangeSet))).rejects.toMatchObject({
      diagnostic: { code: 'VERSION_OBJECT_CORRUPTION' },
    });
  });

  it('rejects digest and byte-length mismatches', async () => {
    const digestMismatchStore = createInMemoryVersionObjectStore(NAMESPACE);
    const lengthMismatchStore = createInMemoryVersionObjectStore(NAMESPACE);
    const semanticChangeSet = await record({ changes: [] });

    expectFailedCode(
      await digestMismatchStore.putObjects([
        {
          ...semanticChangeSet,
          digest: digest(HEX_C),
        },
      ]),
      'VERSION_DIGEST_MISMATCH',
    );

    expectFailedCode(
      await lengthMismatchStore.putObjects([
        {
          ...semanticChangeSet,
          payloadByteLength: semanticChangeSet.payloadByteLength + 1,
        },
      ]),
      'VERSION_BYTE_LENGTH_MISMATCH',
    );
  });
});
