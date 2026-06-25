import {
  VersionObjectMemoryBackend,
  createInMemoryVersionObjectStore,
  type VersionObjectRecord,
} from '../object-store';
import { VERSION_OBJECT_CURRENT_COMPATIBILITY_VERSION } from '../object-header';
import {
  expectFailedCode,
  expectSuccess,
  NAMESPACE,
  objectRef,
  OTHER_NAMESPACE,
  record,
} from './object-store-test-utils';

describe('InMemoryVersionObjectStore namespace binding', () => {
  it('keeps same-digest records isolated per namespace in a shared backend', async () => {
    const backend = new VersionObjectMemoryBackend();
    const firstStore = createInMemoryVersionObjectStore(NAMESPACE, { backend });
    const secondStore = createInMemoryVersionObjectStore(OTHER_NAMESPACE, { backend });
    const payload = { changes: [{ id: 'same-digest' }] };
    const firstRecord = await record(payload, [], 'workbook.semanticChangeSet.v1', NAMESPACE);
    const secondRecord = await record(
      payload,
      [],
      'workbook.semanticChangeSet.v1',
      OTHER_NAMESPACE,
    );
    const ref = objectRef(firstRecord);

    expect(firstRecord.digest).toEqual(secondRecord.digest);
    expectSuccess(await firstStore.putObjects([firstRecord]));
    expectSuccess(await secondStore.putObjects([secondRecord]));

    await expect(firstStore.getObjectRecord(ref)).resolves.toMatchObject({ namespace: NAMESPACE });
    await expect(secondStore.getObjectRecord(ref)).resolves.toMatchObject({
      namespace: OTHER_NAMESPACE,
    });
  });

  it('does not resolve objects across namespaces in a shared memory backend', async () => {
    const backend = new VersionObjectMemoryBackend();
    const firstStore = createInMemoryVersionObjectStore(NAMESPACE, { backend });
    const secondStore = createInMemoryVersionObjectStore(OTHER_NAMESPACE, { backend });
    const semanticChangeSet = await record({ changes: [{ id: 'change-1' }] });
    const ref = objectRef(semanticChangeSet);

    expectSuccess(await firstStore.putObjects([semanticChangeSet]));

    await expect(firstStore.hasObject(ref)).resolves.toBe(true);
    await expect(secondStore.hasObject(ref)).resolves.toBe(false);
    await expect(secondStore.getObject(ref)).rejects.toMatchObject({
      diagnostic: { code: 'VERSION_OBJECT_NOT_FOUND' },
    });
  });

  it('rejects stored records whose storage key namespace disagrees with the record', async () => {
    const store = createInMemoryVersionObjectStore(NAMESPACE);
    const foreignSnapshot = await record(
      { sheets: [] },
      [],
      'workbook.snapshotRoot.v1',
      OTHER_NAMESPACE,
    );
    const ref = objectRef(foreignSnapshot);
    store.putCorruptRecordForTesting(foreignSnapshot.digest, foreignSnapshot);

    await expect(store.hasObject(ref)).resolves.toBe(false);
    expect(store.listObjectRecords()).toEqual([]);
    await expect(store.getObjectRecord(ref)).rejects.toMatchObject({
      diagnostic: { code: 'VERSION_OBJECT_CORRUPTION' },
    });

    const dependent = await record({ changes: [{ id: 'depends-on-foreign' }] }, [ref]);
    const result = await store.putObjects([dependent]);

    expectFailedCode(result, 'VERSION_MISSING_DEPENDENCY');
    await expect(store.hasObject(objectRef(dependent))).resolves.toBe(false);
  });

  it('rejects stored records whose object type disagrees with the requested dependency', async () => {
    const store = createInMemoryVersionObjectStore(NAMESPACE);
    const semanticChangeSet = await record({ changes: [] });
    const snapshot = await record({ sheets: [] }, [], 'workbook.snapshotRoot.v1');
    const forgedSnapshot: VersionObjectRecord<unknown> = {
      ...snapshot,
      digest: semanticChangeSet.digest,
    };
    const semanticRef = objectRef(semanticChangeSet);
    store.putCorruptRecordForTesting(semanticChangeSet.digest, forgedSnapshot);

    await expect(store.hasObject(semanticRef)).resolves.toBe(false);
    await expect(store.getObjectRecord(semanticRef)).rejects.toMatchObject({
      diagnostic: { code: 'VERSION_OBJECT_TYPE_MISMATCH' },
    });

    const dependent = await record({ changes: [{ id: 'depends-on-semantic' }] }, [semanticRef]);
    const result = await store.putObjects([dependent]);

    expectFailedCode(result, 'VERSION_MISSING_DEPENDENCY');
    await expect(store.hasObject(objectRef(dependent))).resolves.toBe(false);
  });

  it('surfaces persisted object compatibility diagnostics without classifying them as corruption', async () => {
    const store = createInMemoryVersionObjectStore(NAMESPACE);
    const semanticChangeSet = await record({ changes: [] });
    expectSuccess(await store.putObjects([semanticChangeSet]));
    store.putCorruptRecordForTesting(semanticChangeSet.digest, {
      ...semanticChangeSet,
      preimage: {
        ...semanticChangeSet.preimage,
        minReaderVersion: 'VC-12',
      },
    });

    await expect(store.getObjectRecord(objectRef(semanticChangeSet))).rejects.toMatchObject({
      diagnostic: {
        code: 'VERSION_UNSUPPORTED_SCHEMA',
        severity: 'error',
        details: expect.objectContaining({
          cause: 'VERSION_UNSUPPORTED_SCHEMA',
          field: 'minReaderVersion',
          currentVersion: VERSION_OBJECT_CURRENT_COMPATIBILITY_VERSION,
          received: 'VC-12',
        }),
      },
    });
  });
});
