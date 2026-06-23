import type {
  VersionDiffOptions,
  VersionPageToken,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';
import {
  VERSION_DIFF_DEFAULT_PAGE_LIMIT,
  VERSION_DIFF_MAX_PAGE_LIMIT,
  VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH,
  VERSION_DIFF_PUBLIC_CURSOR_PREFIX,
  VERSION_DIFF_RESOURCE_LIMITS,
  isPublicVersionDiffCursor,
} from '@mog-sdk/contracts/versioning';

import { diagnostic, type DiffServiceDiagnostic } from './diff-service-diagnostics';
import {
  isSemanticDiffOrderKey,
  type SemanticDiffOrderKey,
  type SemanticDiffPageCursor,
} from './diff-service-order-key';

const VERSION_DIFF_INTERNAL_PAGE_TOKEN_PREFIX = 'vc04diff';
const VERSION_DIFF_CURSOR_CACHE_MAX_ENTRIES = 512;

type PublicCursorCacheEntry = {
  readonly internalToken: string;
};

export type ParsedDiffOptions = {
  readonly pageSize: number;
  readonly pageToken?: VersionPageToken | string;
};

export type ParsedPageToken =
  | {
      readonly ok: true;
      readonly cursor: SemanticDiffPageCursor;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly DiffServiceDiagnostic[];
    };

const PUBLIC_DIFF_CURSOR_CACHE = new Map<string, PublicCursorCacheEntry>();
let publicDiffCursorSequence = 0;

export function parseDiffOptions(options: VersionDiffOptions): {
  readonly options: ParsedDiffOptions;
  readonly diagnostics: readonly DiffServiceDiagnostic[];
} {
  const pageSize = options.pageSize ?? VERSION_DIFF_DEFAULT_PAGE_LIMIT;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > VERSION_DIFF_MAX_PAGE_LIMIT) {
    return {
      options: { pageSize: VERSION_DIFF_DEFAULT_PAGE_LIMIT },
      diagnostics: [
        diagnostic(
          'VERSION_INVALID_OPTIONS',
          'diff pageSize must be an integer from 1 through 500.',
          {
            details: {
              min: 1,
              max: VERSION_DIFF_MAX_PAGE_LIMIT,
              receivedPageSize: Number.isFinite(pageSize) ? pageSize : String(pageSize),
            },
          },
        ),
      ],
    };
  }
  return {
    options: {
      pageSize,
      ...(options.pageToken === undefined ? {} : { pageToken: options.pageToken }),
    },
    diagnostics: [],
  };
}

export function parsePageToken(
  token: VersionPageToken | string | undefined,
  baseCommitId: WorkbookCommitId,
  targetCommitId: WorkbookCommitId,
): ParsedPageToken {
  if (token === undefined) return { ok: true, cursor: { kind: 'offset', offset: 0 } };

  const publicCursor = resolvePublicPageToken(token);
  if (!publicCursor.ok) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_STALE_PAGE_CURSOR', publicCursor.safeMessage, {
          recoverability: 'retry',
          details: publicCursor.details,
        }),
      ],
    };
  }

  const parts = publicCursor.internalToken.split(':');
  const cursorValue = parts.at(-1);
  const targetDigest = parts.at(-2);
  const targetPrefix = parts.at(-4);
  const baseDigest = parts.at(-5);
  const basePrefix = parts.at(-7);
  if (
    parts.length !== 8 ||
    (parts[0] !== VERSION_DIFF_INTERNAL_PAGE_TOKEN_PREFIX &&
      parts[0] !== `${VERSION_DIFF_INTERNAL_PAGE_TOKEN_PREFIX}k`) ||
    basePrefix !== 'commit' ||
    parts.at(-6) !== 'sha256' ||
    targetPrefix !== 'commit' ||
    parts.at(-3) !== 'sha256' ||
    `${basePrefix}:sha256:${baseDigest}` !== baseCommitId ||
    `${targetPrefix}:sha256:${targetDigest}` !== targetCommitId ||
    cursorValue === undefined
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_STALE_PAGE_CURSOR', 'diff pageToken does not match this diff request.'),
      ],
    };
  }

  if (parts[0] === `${VERSION_DIFF_INTERNAL_PAGE_TOKEN_PREFIX}k`) {
    const orderKey = parseEncodedSemanticDiffOrderKey(cursorValue);
    if (!orderKey) {
      return {
        ok: false,
        diagnostics: [
          diagnostic('VERSION_STALE_PAGE_CURSOR', 'diff pageToken carries an invalid order key.'),
        ],
      };
    }
    return { ok: true, cursor: { kind: 'orderKey', orderKey } };
  }

  const offset = parsePageOffset(cursorValue);
  if (offset === null) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_STALE_PAGE_CURSOR', 'diff pageToken carries an invalid page offset.'),
      ],
    };
  }
  return { ok: true, cursor: { kind: 'offset', offset } };
}

export function internalPageTokenForOffset(
  baseCommitId: WorkbookCommitId,
  targetCommitId: WorkbookCommitId,
  offset: number,
): VersionPageToken {
  return `${VERSION_DIFF_INTERNAL_PAGE_TOKEN_PREFIX}:${baseCommitId}:${targetCommitId}:${offset}` as VersionPageToken;
}

export function internalPageTokenForOrderKey(
  baseCommitId: WorkbookCommitId,
  targetCommitId: WorkbookCommitId,
  orderKey: SemanticDiffOrderKey,
): VersionPageToken {
  return `${VERSION_DIFF_INTERNAL_PAGE_TOKEN_PREFIX}k:${baseCommitId}:${targetCommitId}:${encodeURIComponent(JSON.stringify(orderKey))}` as VersionPageToken;
}

export function publicPageTokenFor(internalToken: VersionPageToken): VersionPageToken {
  evictPublicDiffCursorCache();
  const publicToken =
    `${VERSION_DIFF_PUBLIC_CURSOR_PREFIX}${nextPublicCursorHandle()}` as VersionPageToken;
  PUBLIC_DIFF_CURSOR_CACHE.set(publicToken, { internalToken });
  return publicToken;
}

function parsePageOffset(value: string): number | null {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const offset = Number(value);
  return Number.isSafeInteger(offset) ? offset : null;
}

function parseEncodedSemanticDiffOrderKey(value: string): SemanticDiffOrderKey | null {
  try {
    const key = JSON.parse(decodeURIComponent(value));
    return typeof key === 'string' && isSemanticDiffOrderKey(key) ? key : null;
  } catch {
    return null;
  }
}

function resolvePublicPageToken(token: VersionPageToken | string):
  | {
      readonly ok: true;
      readonly internalToken: string;
    }
  | {
      readonly ok: false;
      readonly safeMessage: string;
      readonly details: Readonly<Record<string, string | number | boolean | null>>;
    } {
  if (typeof token !== 'string') {
    return {
      ok: false,
      safeMessage: 'diff pageToken is malformed or unsupported.',
      details: { category: 'malformedCursor' },
    };
  }
  if (token.length > VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH) {
    return {
      ok: false,
      safeMessage: 'diff pageToken exceeds the public cursor size limit.',
      details: {
        category: 'oversizedCursor',
        max: VERSION_DIFF_RESOURCE_LIMITS.maxPublicCursorBytes,
        receivedCursorBytes: token.length,
      },
    };
  }
  if (!isPublicVersionDiffCursor(token)) {
    return {
      ok: false,
      safeMessage: 'diff pageToken uses an unsupported public cursor order or version.',
      details: { category: 'unsupportedCursor' },
    };
  }
  const entry = PUBLIC_DIFF_CURSOR_CACHE.get(token);
  if (!entry) {
    return {
      ok: false,
      safeMessage: 'diff pageToken is stale or no longer available.',
      details: { category: 'staleCursor' },
    };
  }
  return { ok: true, internalToken: entry.internalToken };
}

function nextPublicCursorHandle(): string {
  publicDiffCursorSequence = (publicDiffCursorSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${randomCursorSegment()}.${Date.now().toString(36)}.${publicDiffCursorSequence.toString(36)}`;
}

function randomCursorSegment(): string {
  const bytes = new Uint8Array(16);
  const cryptoLike = (
    globalThis as { readonly crypto?: { getRandomValues?: <T extends Uint8Array>(array: T) => T } }
  ).crypto;
  if (cryptoLike?.getRandomValues) {
    cryptoLike.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function evictPublicDiffCursorCache(): void {
  while (PUBLIC_DIFF_CURSOR_CACHE.size >= VERSION_DIFF_CURSOR_CACHE_MAX_ENTRIES) {
    const oldest = PUBLIC_DIFF_CURSOR_CACHE.keys().next().value;
    if (!oldest) return;
    PUBLIC_DIFF_CURSOR_CACHE.delete(oldest);
  }
}
