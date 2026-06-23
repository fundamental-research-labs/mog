export const VERSION_DIFF_PAGE_ORDER = 'semantic-change-order' as const;
export const VERSION_DIFF_PAGE_ORDER_VERSION = 1 as const;

export const VERSION_DIFF_DEFAULT_PAGE_LIMIT = 50 as const;
export const VERSION_DIFF_MAX_PAGE_LIMIT = 500 as const;

export const VERSION_DIFF_PUBLIC_CURSOR_SCHEMA_VERSION = 1 as const;
export const VERSION_DIFF_PUBLIC_CURSOR_ORDER_KEY = 'semantic-change-order' as const;
export const VERSION_DIFF_PUBLIC_CURSOR_PREFIX =
  `mog-vdiff-v1.${VERSION_DIFF_PUBLIC_CURSOR_ORDER_KEY}.` as const;
export const VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH = 2048 as const;

export const VERSION_DIFF_RESOURCE_LIMITS = Object.freeze({
  defaultPageLimit: VERSION_DIFF_DEFAULT_PAGE_LIMIT,
  maxPageLimit: VERSION_DIFF_MAX_PAGE_LIMIT,
  maxPublicCursorBytes: VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH,
} as const);

const PUBLIC_CURSOR_BODY_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

export function isPublicVersionDiffCursor(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (
    value.length <= VERSION_DIFF_PUBLIC_CURSOR_PREFIX.length ||
    value.length > VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH ||
    !value.startsWith(VERSION_DIFF_PUBLIC_CURSOR_PREFIX)
  ) {
    return false;
  }
  return PUBLIC_CURSOR_BODY_RE.test(value.slice(VERSION_DIFF_PUBLIC_CURSOR_PREFIX.length));
}
