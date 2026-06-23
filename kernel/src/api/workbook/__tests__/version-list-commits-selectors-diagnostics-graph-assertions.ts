import {
  CHILD_COMMIT_ID,
  PARENT_A_COMMIT_ID,
  type FakeGraphStore,
  type createVersion,
} from './version-list-commits-selectors-test-utils';

type VersionUnderTest = ReturnType<typeof createVersion>;

export async function expectMissingIndexDiagnostic(
  version: VersionUnderTest,
  graphStore: FakeGraphStore,
) {
  const missingIndexResult = await version.listCommits({ ref: 'refs/heads/main' });
  expect(missingIndexResult).toMatchObject({
    ok: false,
    error: {
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_INDEX_REBUILD_REQUIRED',
          data: expect.objectContaining({
            recoverability: 'repair',
            payload: expect.objectContaining({
              operation: 'listCommits',
              option: 'pageToken',
              objectKind: 'index',
              indexManifestMissing: true,
              indexRebuildRequired: true,
            }),
          }),
        }),
      ],
    },
  });
  expect(JSON.stringify(missingIndexResult)).not.toContain('raw-ref-secret');
  expect(JSON.stringify(missingIndexResult)).not.toContain('/private/path');
  expect(JSON.stringify(missingIndexResult)).not.toContain('cursor-secret');
  expect(graphStore.listCommits).toHaveBeenLastCalledWith({ ref: 'refs/heads/main' });
}

export async function expectMissingParentDiagnostic(
  version: VersionUnderTest,
  graphStore: FakeGraphStore,
) {
  const missingParentResult = await version.listCommits({ ref: 'refs/heads/main' });
  expect(missingParentResult).toMatchObject({
    ok: false,
    error: {
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_MISSING_PARENT',
          data: expect.objectContaining({
            recoverability: 'repair',
            payload: expect.objectContaining({
              operation: 'listCommits',
              objectKind: 'commit',
              completenessMarker: 'diagnostic-read',
              completenessScope: 'graph-metadata',
              completenessCondition: 'history-gap',
              accessFiltered: true,
              missingCommitRole: 'parent',
              condition: 'history-gap',
              historyCompleteness: 'history-gap',
            }),
          }),
        }),
      ],
    },
  });
  expect(JSON.stringify(missingParentResult)).not.toContain(PARENT_A_COMMIT_ID);
  expect(JSON.stringify(missingParentResult)).not.toContain(CHILD_COMMIT_ID);
  expect(JSON.stringify(missingParentResult)).not.toContain('raw-ref-secret');
  expect(JSON.stringify(missingParentResult)).not.toContain('/private/path');
  expect(graphStore.listCommits).toHaveBeenLastCalledWith({ ref: 'refs/heads/main' });
}
