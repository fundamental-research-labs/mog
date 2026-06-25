import {
  MISSING_COMMIT_ID,
  PAGE_TOKEN,
  expectUnavailable,
  type FakeGraphStore,
  type createVersion,
} from './version-list-commits-selectors-test-utils';

type VersionUnderTest = ReturnType<typeof createVersion>;

export async function expectInvalidRefDiagnostic(
  version: VersionUnderTest,
  graphStore: FakeGraphStore,
) {
  await expect(version.listCommits({ ref: 'refs/heads/scenario/missing' })).resolves.toMatchObject(
    expectUnavailable('VERSION_INVALID_OPTIONS', 'ref'),
  );
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
