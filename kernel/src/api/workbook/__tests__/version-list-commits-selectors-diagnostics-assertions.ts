import {
  CHILD_COMMIT_ID,
  MISSING_COMMIT_ID,
  PAGE_TOKEN,
  PARENT_A_COMMIT_ID,
  PUBLIC_LIST_PAGE_TOKEN,
  expectUnavailable,
  type FakeGraphStore,
  type createVersion,
} from './version-list-commits-selectors-test-utils';

type VersionUnderTest = ReturnType<typeof createVersion>;

export async function expectInvalidRefDiagnostic(
  version: VersionUnderTest,
  graphStore: FakeGraphStore,
) {
  await expect(
    version.listCommits({ ref: 'refs/heads/scenario/missing' }),
  ).resolves.toMatchObject(expectUnavailable('VERSION_INVALID_OPTIONS', 'ref'));
  expect(graphStore.listCommits).toHaveBeenLastCalledWith({ ref: 'refs/heads/scenario/missing' });
}

export async function expectMissingRootDiagnostic(
  version: VersionUnderTest,
  graphStore: FakeGraphStore,
) {
  const missingRootResult = await version.listCommits({ from: MISSING_COMMIT_ID });
  expect(missingRootResult).toMatchObject({
    ...expectUnavailable('VERSION_MISSING_OBJECT'),
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.listCommits',
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_MISSING_OBJECT',
          data: expect.objectContaining({
            recoverability: 'repair',
            payload: expect.objectContaining({
              operation: 'listCommits',
              rootKind: 'commit',
              rootMissing: true,
            }),
          }),
        }),
      ],
    },
  });
  expect(graphStore.listCommits).toHaveBeenLastCalledWith({ from: MISSING_COMMIT_ID });
  expect(JSON.stringify(missingRootResult)).not.toContain(MISSING_COMMIT_ID);
}

export async function expectStaleCursorDiagnostic(
  version: VersionUnderTest,
  graphStore: FakeGraphStore,
) {
  await expect(version.listCommits({ pageToken: PAGE_TOKEN })).resolves.toMatchObject(
    expectUnavailable('VERSION_STALE_PAGE_CURSOR', 'pageToken'),
  );
  expect(graphStore.listCommits).toHaveBeenLastCalledWith({ pageToken: PAGE_TOKEN });
}

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

export async function expectMalformedNextPageTokenDiagnostic(
  version: VersionUnderTest,
  graphStore: FakeGraphStore,
) {
  await expect(version.listCommits()).resolves.toMatchObject({
    ok: false,
    error: {
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_INVALID_COMMIT_PAYLOAD',
          data: expect.objectContaining({
            payload: expect.objectContaining({
              option: 'pageToken',
              cursorMalformed: true,
            }),
          }),
        }),
      ],
    },
  });
  expect(graphStore.listCommits).toHaveBeenLastCalledWith({});
}

export async function expectPublicNextPageTokenPassthrough(
  version: VersionUnderTest,
  graphStore: FakeGraphStore,
) {
  await expect(version.listCommits()).resolves.toMatchObject({
    ok: true,
    value: {
      nextCursor: 'vpt_next_page',
      limit: 50,
    },
  });
  expect(graphStore.listCommits).toHaveBeenLastCalledWith({});

  await expect(version.listCommits()).resolves.toMatchObject({
    ok: true,
    value: {
      nextCursor: PUBLIC_LIST_PAGE_TOKEN,
      limit: 50,
    },
  });
  expect(graphStore.listCommits).toHaveBeenLastCalledWith({});
}
