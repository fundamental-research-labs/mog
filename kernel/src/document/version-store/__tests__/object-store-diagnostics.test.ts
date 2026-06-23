import { createInMemoryVersionObjectStore, type VersionObjectRecord } from '../object-store';
import {
  VERSION_OBJECT_CURRENT_COMPATIBILITY_VERSION,
  VERSION_OBJECT_MIN_COMPATIBILITY_VERSION,
} from '../object-header';
import type { VersionDependencyRef, WorkbookCommitId } from '../object-digest';
import {
  digest,
  expectFailedCode,
  HEX_D,
  NAMESPACE,
  objectRef,
  OTHER_NAMESPACE,
  record,
} from './object-store-test-utils';

describe('InMemoryVersionObjectStore putObjects', () => {
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

  it('rejects records for the wrong namespace', async () => {
    const store = createInMemoryVersionObjectStore(OTHER_NAMESPACE);
    const semanticChangeSet = await record({ changes: [] });

    const result = await store.putObjects([semanticChangeSet]);

    expectFailedCode(result, 'VERSION_WRONG_NAMESPACE');
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
