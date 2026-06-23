import {
  VersionObjectMemoryBackend,
  createInMemoryVersionObjectStore,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectPutBatchResult,
  type VersionObjectRecord,
} from '../object-store';
import {
  VERSION_OBJECT_CURRENT_COMPATIBILITY_VERSION,
  VERSION_OBJECT_MIN_COMPATIBILITY_VERSION,
} from '../object-header';
import type {
  ObjectDigest,
  VersionDependencyRef,
  VersionObjectType,
  WorkbookCommitId,
} from '../object-digest';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

const OTHER_NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-2',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

const HEX_A = 'aa'.repeat(32);
const HEX_B = 'bb'.repeat(32);
const HEX_C = 'cc'.repeat(32);
const HEX_D = 'dd'.repeat(32);

function digest(hex: string): ObjectDigest {
  return { algorithm: 'sha256', digest: hex };
}

async function record(
  payload: unknown,
  dependencies: readonly VersionDependencyRef[] = [],
  objectType: VersionObjectType = 'workbook.semanticChangeSet.v1',
  namespace = NAMESPACE,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies,
    payload,
  });
}

function objectRef(record: VersionObjectRecord<unknown>): VersionDependencyRef {
  return {
    kind: 'object',
    objectType: record.preimage.objectType,
    digest: record.digest,
  };
}

function expectFailedCode(result: VersionObjectPutBatchResult, code: string): void {
  if (result.status !== 'failed') {
    throw new Error(`expected failed result, received ${result.status}`);
  }
  expect(result.mutationGuarantee).toBe('no-objects-written');
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
}

function expectSuccess(result: VersionObjectPutBatchResult): void {
  if (result.status !== 'success') {
    throw new Error(`expected success result, received ${result.status}`);
  }
  expect(result.diagnostics).toEqual([]);
}

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

  it('redacts merge and review artifact payload details from dependency diagnostics', async () => {
    const store = createInMemoryVersionObjectStore(NAMESPACE);
    const missingCommitId = `commit:sha256:${HEX_D}` as WorkbookCommitId;
    const missingCommitDependency: VersionDependencyRef = {
      kind: 'commit',
      commitId: missingCommitId,
      digest: digest(HEX_D),
    };
    const mergePreview = await record(
      {
        schemaVersion: 1,
        recordKind: 'mergePreview',
        base: missingCommitId,
        ours: missingCommitId,
        theirs: missingCommitId,
        privateEntityId: 'Sheet1!Secret42',
        reviewerNote: 'private merge payload must not leak',
      },
      [missingCommitDependency],
      'workbook.mergePreview.v1',
    );
    const reviewExtension = await record(
      {
        schemaVersion: 1,
        recordKind: 'reviewExtension',
        mergePreviewId: 'merge-preview/private-secret',
        reviewerNote: 'private review payload must not leak',
      },
      [],
      'workbook.reviewExtension.v1',
      OTHER_NAMESPACE,
    );

    const missingDependency = await store.putObjects([mergePreview]);
    const wrongNamespace = await store.putObjects([reviewExtension]);

    expectFailedCode(missingDependency, 'VERSION_MISSING_DEPENDENCY');
    expectFailedCode(wrongNamespace, 'VERSION_WRONG_NAMESPACE');
    if (missingDependency.status !== 'failed' || wrongNamespace.status !== 'failed') {
      throw new Error('expected failed diagnostic results');
    }

    expect(missingDependency.diagnostics[0]).toMatchObject({
      code: 'VERSION_MISSING_DEPENDENCY',
      objectType: 'workbook.mergePreview.v1',
      details: { dependencyKind: 'commit' },
    });
    expect(missingDependency.diagnostics[0]).not.toHaveProperty('digest');
    expect(missingDependency.diagnostics[0]).not.toHaveProperty('dependency');
    expect(wrongNamespace.diagnostics[0]).toMatchObject({
      code: 'VERSION_WRONG_NAMESPACE',
      details: { namespace: 'redacted' },
    });
    expect(wrongNamespace.diagnostics[0]).not.toHaveProperty('namespace');

    const diagnosticText = JSON.stringify([
      ...missingDependency.diagnostics,
      ...wrongNamespace.diagnostics,
    ]);
    for (const leakedValue of [
      missingCommitId,
      HEX_D,
      mergePreview.digest.digest,
      reviewExtension.digest.digest,
      OTHER_NAMESPACE.documentId,
      'Sheet1!Secret42',
      'private merge payload must not leak',
      'merge-preview/private-secret',
      'private review payload must not leak',
    ]) {
      expect(diagnosticText).not.toContain(leakedValue);
    }
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

  it('rejects records for the wrong namespace', async () => {
    const store = createInMemoryVersionObjectStore(OTHER_NAMESPACE);
    const semanticChangeSet = await record({ changes: [] });

    const result = await store.putObjects([semanticChangeSet]);

    expectFailedCode(result, 'VERSION_WRONG_NAMESPACE');
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

  it('returns structured diagnostics for malformed digests', async () => {
    const store = createInMemoryVersionObjectStore(NAMESPACE);
    const semanticChangeSet = await record({ changes: [] });

    const result = await store.putObjects([
      {
        ...semanticChangeSet,
        digest: { algorithm: 'sha256', digest: semanticChangeSet.digest.digest.toUpperCase() },
      } as VersionObjectRecord<unknown>,
    ]);

    expectFailedCode(result, 'VERSION_INVALID_DIGEST');
  });

  it.each([
    ['minReaderVersion', 'VC-09'],
    ['minReaderVersion', 'VC-12'],
    ['minWriterVersion', 'VC-09'],
    ['minWriterVersion', 'VC-12'],
  ] as const)('rejects %s outside the N-1 compatibility window', async (field, value) => {
    const store = createInMemoryVersionObjectStore(NAMESPACE);
    const semanticChangeSet = await record({ changes: [{ id: `${field}-${value}` }] });
    const incompatibleRecord: VersionObjectRecord<unknown> = {
      ...semanticChangeSet,
      preimage: {
        ...semanticChangeSet.preimage,
        [field]: value,
      },
    };

    const result = await store.putObjects([incompatibleRecord]);

    expectFailedCode(result, 'VERSION_UNSUPPORTED_SCHEMA');
    if (result.status !== 'failed') throw new Error('expected failed result');
    expect(result.diagnostics[0]).toMatchObject({
      code: 'VERSION_UNSUPPORTED_SCHEMA',
      path: `preimage.${field}`,
      details: {
        field,
        minSupportedVersion: VERSION_OBJECT_MIN_COMPATIBILITY_VERSION,
        currentVersion: VERSION_OBJECT_CURRENT_COMPATIBILITY_VERSION,
        received: value,
      },
    });
    await expect(store.hasObject(objectRef(semanticChangeSet))).resolves.toBe(false);
  });
});

describe('InMemoryVersionObjectStore namespace binding', () => {
  it('keeps same-digest records isolated per namespace in a shared backend', async () => {
    const backend = new VersionObjectMemoryBackend();
    const firstStore = createInMemoryVersionObjectStore(NAMESPACE, { backend });
    const secondStore = createInMemoryVersionObjectStore(OTHER_NAMESPACE, { backend });
    const payload = { changes: [{ id: 'same-digest' }] };
    const firstRecord = await record(payload, [], 'workbook.semanticChangeSet.v1', NAMESPACE);
    const secondRecord = await record(payload, [], 'workbook.semanticChangeSet.v1', OTHER_NAMESPACE);
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
    const foreignSnapshot = await record({ sheets: [] }, [], 'workbook.snapshotRoot.v1', OTHER_NAMESPACE);
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
