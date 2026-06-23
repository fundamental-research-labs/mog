import { jest } from '@jest/globals';

export const VERSION_STATUS_ROOT_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
export const VERSION_STATUS_CHILD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
export const VERSION_STATUS_REF_REVISION = { kind: 'counter', value: '2' } as const;
export const VERSION_STATUS_CREATED_AT = '2026-06-20T00:00:00.000Z';
export const VERSION_STATUS_LIST_PAGE_TOKEN = 'vpt_aaaaaaaaaaaa';
export const VERSION_STATUS_DIFF_PAGE_TOKEN = 'mog-vdiff-v1.semantic-change-order.cursor-handle';

export function createFakeVersionStatusGraphStore(
  options: { readonly includeDiff?: boolean } = {},
) {
  const graphStore = {
    readHead: jest.fn(async () => ({
      status: 'success',
      head: {
        id: VERSION_STATUS_CHILD_COMMIT_ID,
        refName: 'refs/heads/main',
        resolvedFrom: 'HEAD',
        refRevision: VERSION_STATUS_REF_REVISION,
      },
      main: {
        name: 'refs/heads/main',
        commitId: VERSION_STATUS_CHILD_COMMIT_ID,
        revision: VERSION_STATUS_REF_REVISION,
        updatedAt: VERSION_STATUS_CREATED_AT,
      },
      diagnostics: [],
    })),
    listCommits: jest.fn(async () => ({
      status: 'success',
      commits: [
        {
          id: VERSION_STATUS_CHILD_COMMIT_ID,
          parents: [VERSION_STATUS_ROOT_COMMIT_ID],
          createdAt: VERSION_STATUS_CREATED_AT,
          author: {
            authorId: 'user-1',
            actorKind: 'user',
            displayName: 'Public Reader',
            clientId: 'hidden-client',
          },
        },
        {
          id: VERSION_STATUS_ROOT_COMMIT_ID,
          parents: [],
          createdAt: VERSION_STATUS_CREATED_AT,
          author: {
            authorId: 'system-1',
            actorKind: 'system',
          },
        },
      ],
      readRevision: VERSION_STATUS_REF_REVISION,
      order: 'topological-newest',
      pageSize: 50,
      diagnostics: [],
    })),
    readRef: jest.fn(async (name: string) => ({
      status: 'success',
      ref:
        name === 'HEAD'
          ? {
              name: 'HEAD',
              target: 'refs/heads/main',
              revision: VERSION_STATUS_REF_REVISION,
            }
          : {
              name: 'refs/heads/main',
              commitId: VERSION_STATUS_CHILD_COMMIT_ID,
              revision: VERSION_STATUS_REF_REVISION,
              updatedAt: VERSION_STATUS_CREATED_AT,
            },
      diagnostics: [],
    })),
    diff: jest.fn(async () => ({
      status: 'success',
      items: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'change-1',
            domain: 'cell',
            entityId: 'sheet-1!A1',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: 1 },
          after: {
            kind: 'value',
            value: { kind: 'formula', formula: '=A1+1', result: 2 },
          },
          display: {
            sheetName: { kind: 'value', value: 'Sheet1' },
            address: { kind: 'value', value: 'A1' },
          },
        },
      ],
      nextPageToken: VERSION_STATUS_DIFF_PAGE_TOKEN,
      readRevision: VERSION_STATUS_REF_REVISION,
      order: 'semantic-change-order',
      diagnostics: [],
    })),
  };

  if (options.includeDiff === false) {
    return {
      ...graphStore,
      diff: undefined,
    };
  }

  return graphStore;
}
