import type { VersionMainRefName } from '@mog-sdk/contracts/api';

export const VERSION_HEAD_REF = 'HEAD';
export const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
export const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
export const VERSION_LIST_COMMITS_PAGE_ORDER = 'topological-newest';
export const VERSION_LIST_COMMITS_PAGE_TOKEN_PREFIX = 'vpt_';
export const VERSION_LIST_COMMITS_PUBLIC_CURSOR_PREFIX =
  `mog-vcommits-v1.${VERSION_LIST_COMMITS_PAGE_ORDER}.` as const;
export const VERSION_LIST_COMMITS_PAGE_TOKEN_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
export const VERSION_LIST_COMMITS_MAX_PAGE_TOKEN_BYTES = 2048;
export const VERSION_OPERATION_PAGE_TOKEN_RE = /^mog-v[a-z0-9-]+-v[0-9]+\.[A-Za-z0-9_.-]+$/;
export const VERSION_LIST_COMMITS_DEFAULT_PAGE_SIZE = 50;
export const VERSION_LIST_COMMITS_MAX_PAGE_SIZE = 500;
export const VERSION_LIST_COMMITS_OPTION_KEYS = new Set([
  'ref',
  'from',
  'pageSize',
  'pageToken',
  'includeOrphans',
  'includeDiagnostics',
]);
