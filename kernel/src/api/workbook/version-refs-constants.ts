import type { VersionMainRefName } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

export const VERSION_HEAD_REF = 'HEAD';
export const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
export const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';

export const VERSION_REF_OPERATION_AUTHOR: VersionAuthor = Object.freeze({
  authorId: 'public-version-ref-facade',
  actorKind: 'system',
  displayName: 'Public version ref facade',
});
