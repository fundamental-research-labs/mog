export type * from '@mog-sdk/types-document/security';
import type { AccessLevel } from '@mog-sdk/types-document/security';

/** Linear access ordering used by public policy helpers. */
export const ACCESS_LEVEL_ORDER: Record<AccessLevel, number> = {
  none: 0,
  structure: 1,
  read: 2,
  write: 3,
  admin: 4,
};
