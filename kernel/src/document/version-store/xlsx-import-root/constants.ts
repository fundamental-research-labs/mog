import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

export const XLSX_IMPORT_ROOT_GRAPH_ID = 'xlsx-import-root';
export const XLSX_EXTERNAL_CHANGE_BRANCH_PREFIX = 'import/external-change';
export const XLSX_IMPORT_NEW_ROOT_BRANCH_PREFIX = 'import/new-root';

export const XLSX_IMPORT_ROOT_AUTHOR: VersionAuthor = {
  authorId: 'mog.xlsx-import',
  actorKind: 'system',
  displayName: 'Mog XLSX Import',
};

export const XLSX_IMPORT_CHANGE_AUTHOR: VersionAuthor = {
  authorId: 'mog.xlsx-import-change',
  actorKind: 'system',
  displayName: 'Mog XLSX Import Change',
};
