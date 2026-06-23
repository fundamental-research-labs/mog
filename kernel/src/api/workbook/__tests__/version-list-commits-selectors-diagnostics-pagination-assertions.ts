import {
  PUBLIC_LIST_PAGE_TOKEN,
  type FakeGraphStore,
  type createVersion,
} from './version-list-commits-selectors-test-utils';

type VersionUnderTest = ReturnType<typeof createVersion>;

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
