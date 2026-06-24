import { expect, jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';

export const ROOT_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
export const CHILD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
export const MERGE_COMMIT_ID = `commit:sha256:${'3'.repeat(64)}`;
export const PARENT_A_COMMIT_ID = `commit:sha256:${'4'.repeat(64)}`;
export const PARENT_B_COMMIT_ID = `commit:sha256:${'5'.repeat(64)}`;
export const MISSING_COMMIT_ID = `commit:sha256:${'9'.repeat(64)}`;
export const PAGE_TOKEN = 'vpt_aaaaaaaaaaaa';
export const PUBLIC_LIST_PAGE_TOKEN = 'mog-vcommits-v1.topological-newest.cursor-handle';
export const DIFF_PAGE_TOKEN = 'mog-vdiff-v1.semantic-change-order.cursor-handle';
export const REF_REVISION = { kind: 'counter', value: '2' } as const;
export const CREATED_AT = '2026-06-20T00:00:00.000Z';

export type FakeGraphStore = ReturnType<typeof createFakeGraphStore>;

export function createVersion(
  graphStore: FakeGraphStore,
  versioning: Record<string, unknown> = {},
) {
  return new WorkbookVersionImpl({
    versioning: {
      graphStore,
      ...versioning,
    },
  } as any);
}

export function createFakeGraphStore() {
  return {
    listCommits: jest.fn(async () => successPage()),
  };
}

export function childCommitSummary() {
  return {
    id: CHILD_COMMIT_ID,
    parents: [ROOT_COMMIT_ID],
    createdAt: CREATED_AT,
    author: {
      authorId: 'user-1',
      actorKind: 'user',
      displayName: 'Public Reader',
      clientId: 'hidden-client',
    },
  };
}

export function rootCommitSummary() {
  return {
    id: ROOT_COMMIT_ID,
    parents: [],
    createdAt: CREATED_AT,
    author: {
      authorId: 'system-1',
      actorKind: 'system',
    },
  };
}

export function mergeCommitSummary() {
  return {
    id: MERGE_COMMIT_ID,
    parents: [PARENT_A_COMMIT_ID, PARENT_B_COMMIT_ID],
    createdAt: CREATED_AT,
    author: { actorKind: 'user', displayName: 'Merge Author' },
  };
}

export function parentCommitSummary(id: string) {
  return {
    id,
    parents: [],
    createdAt: CREATED_AT,
    author: { actorKind: 'user', displayName: 'Parent Author' },
  };
}

export function successPage(overrides: Record<string, unknown> = {}) {
  return {
    status: 'success',
    commits: [childCommitSummary(), rootCommitSummary()],
    readRevision: REF_REVISION,
    order: 'topological-newest',
    pageSize: 50,
    diagnostics: [],
    ...overrides,
  };
}

export function expectUnavailable(code: string, option?: string) {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.listCommits',
      diagnostics: [
        expect.objectContaining({
          code,
          data: expect.objectContaining({
            redacted: true,
            ...(option
              ? {
                  payload: expect.objectContaining({ option }),
                }
              : {}),
          }),
        }),
      ],
    },
  };
}
