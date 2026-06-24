import {
  VERSION_GRAPH_MAIN_REF,
  parseGraphRefSelector,
  type ParsedGraphRefSelector,
} from './graph-store-refs';
import { graphMetadataCompletenessDetails } from './graph-store-traversal';
import { parseWorkbookCommitId, type WorkbookCommitId } from '../object-digest';
import type { RefVersion } from '../refs/ref-store';
import type {
  VersionGraphListCommitsOptions,
  VersionGraphRefSelector,
  VersionGraphStoreDiagnostic,
} from './graph-store-types';

export const VERSION_GRAPH_LIST_COMMITS_DEFAULT_PAGE_SIZE = 50;
export const VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_SIZE = 500;
export const VERSION_GRAPH_LIST_COMMITS_PAGE_TOKEN_PREFIX = 'vpt_';
export const VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_TOKEN_BYTES = 2048;

const VERSION_GRAPH_LIST_COMMITS_PAGE_TOKEN_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.:-]*$/;
const VERSION_GRAPH_OPERATION_PAGE_TOKEN_RE = /^mog-v[a-z0-9-]+-v[0-9]+\.[A-Za-z0-9_.:-]+$/;
const VERSION_GRAPH_LIST_COMMITS_CURSOR_CACHE_MAX_ENTRIES = 512;

type ParsedGraphListRefSelector = Extract<ParsedGraphRefSelector, { readonly ok: true }>;

export type ParsedListCommitsPageCursorRoot = {
  readonly commitId: WorkbookCommitId;
  readonly namespaceKey: string;
  readonly readRevision: RefVersion;
};

export type ParsedListCommitsPageCursor = {
  readonly root: ParsedListCommitsPageCursorRoot;
  readonly offset: number;
};

export type ParsedListCommitsTarget =
  | {
      readonly kind: 'ref';
      readonly selector: ParsedGraphListRefSelector;
    }
  | {
      readonly kind: 'commit';
      readonly commitId: WorkbookCommitId;
    }
  | {
      readonly kind: 'pageCursor';
      readonly cursor: ParsedListCommitsPageCursor;
    };

type GraphDiagnosticFactory = (
  code: VersionGraphStoreDiagnostic['code'],
  message: string,
  options?: Omit<VersionGraphStoreDiagnostic, 'code' | 'severity' | 'message'>,
) => VersionGraphStoreDiagnostic;

const LIST_COMMITS_CURSOR_CACHE = new Map<string, ParsedListCommitsPageCursor>();
let listCommitsCursorSequence = 0;

export function parseListCommitsOptions(
  options: VersionGraphListCommitsOptions,
  diagnostic: GraphDiagnosticFactory,
):
  | {
      readonly ok: true;
      readonly pageSize: number;
      readonly target: ParsedListCommitsTarget;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
  const pageSize = options.pageSize ?? VERSION_GRAPH_LIST_COMMITS_DEFAULT_PAGE_SIZE;
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_SIZE
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_INVALID_OPTIONS',
          'listCommits pageSize must be an integer from 1 through 500.',
          {
            operation: 'listCommits',
            option: 'pageSize',
            details: {
              min: 1,
              max: VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_SIZE,
              receivedPageSize: Number.isFinite(pageSize) ? pageSize : String(pageSize),
            },
          },
        ),
      ],
    };
  }

  const pageCursor = parseListCommitsPageToken(options.pageToken, diagnostic);
  if (!pageCursor.ok) {
    return { ok: false, diagnostics: pageCursor.diagnostics };
  }

  if (
    pageCursor.cursor !== undefined &&
    (options.ref !== undefined || options.from !== undefined)
  ) {
    return {
      ok: false,
      diagnostics: [
        staleListCommitsPageTokenDiagnostic(
          diagnostic,
          'listCommits pageToken cannot be combined with a new root selector.',
          {
            cursorCategory: 'refScopeMismatch',
            cursorRootMismatch: true,
          },
        ),
      ],
    };
  }

  if (options.pageToken !== undefined) {
    if (pageCursor.cursor === undefined) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_INVALID_OPTIONS',
            'listCommits pageToken is malformed or unsupported.',
            {
              operation: 'listCommits',
              option: 'pageToken',
              details: { category: 'malformedCursor' },
            },
          ),
        ],
      };
    }

    return {
      ok: true,
      pageSize,
      target: { kind: 'pageCursor', cursor: pageCursor.cursor },
    };
  }

  if (options.ref !== undefined && options.from !== undefined) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_INVALID_OPTIONS', 'listCommits accepts either ref or from, not both.', {
          operation: 'listCommits',
          option: 'ref',
          details: { exclusiveOptions: 'ref,from' },
        }),
      ],
    };
  }

  if (options.from !== undefined) {
    try {
      return {
        ok: true,
        pageSize,
        target: { kind: 'commit', commitId: parseWorkbookCommitId(options.from) },
      };
    } catch {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_INVALID_COMMIT_ID',
            'listCommits from must be commit:sha256:<64 hex>.',
            {
              operation: 'listCommits',
              option: 'from',
              details: { expected: 'commit:sha256:<64 lowercase hex>' },
            },
          ),
        ],
      };
    }
  }

  const selector = parseGraphRefSelector(
    (options.ref ?? VERSION_GRAPH_MAIN_REF) as VersionGraphRefSelector | string,
    diagnostic,
    'listCommits',
  );
  if (!selector.ok) return selector;

  return { ok: true, pageSize, target: { kind: 'ref', selector } };
}

function classifyListCommitsPageToken(token: unknown):
  | { readonly kind: 'valid'; readonly cursor: ParsedListCommitsPageCursor }
  | {
      readonly kind: 'invalid' | 'stale';
      readonly message: string;
      readonly details: Readonly<Record<string, string | number | boolean | null>>;
    } {
  if (typeof token !== 'string') {
    return {
      kind: 'invalid',
      message: 'listCommits pageToken is malformed or unsupported.',
      details: { category: 'malformedCursor' },
    };
  }

  if (token.length > VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_TOKEN_BYTES) {
    return {
      kind: 'invalid',
      message: 'listCommits pageToken exceeds the public cursor size limit.',
      details: {
        category: 'oversizedCursor',
        max: VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_TOKEN_BYTES,
        receivedCursorBytes: token.length,
      },
    };
  }

  if (
    token.length > VERSION_GRAPH_LIST_COMMITS_PAGE_TOKEN_PREFIX.length &&
    token.startsWith(VERSION_GRAPH_LIST_COMMITS_PAGE_TOKEN_PREFIX) &&
    VERSION_GRAPH_LIST_COMMITS_PAGE_TOKEN_RE.test(
      token.slice(VERSION_GRAPH_LIST_COMMITS_PAGE_TOKEN_PREFIX.length),
    )
  ) {
    const cursor = LIST_COMMITS_CURSOR_CACHE.get(token);
    if (cursor === undefined) {
      return {
        kind: 'stale',
        message: 'listCommits pageToken is stale or no longer available.',
        details: { cursorCategory: 'staleCursor' },
      };
    }
    return { kind: 'valid', cursor };
  }

  if (VERSION_GRAPH_OPERATION_PAGE_TOKEN_RE.test(token)) {
    return {
      kind: 'stale',
      message: 'listCommits pageToken belongs to a different version read operation.',
      details: { cursorCategory: 'wrongOperationCursor' },
    };
  }

  return {
    kind: 'invalid',
    message: 'listCommits pageToken is malformed or unsupported.',
    details: { category: 'malformedCursor' },
  };
}

function parseListCommitsPageToken(
  token: string | undefined,
  diagnostic: GraphDiagnosticFactory,
):
  | { readonly ok: true; readonly cursor?: ParsedListCommitsPageCursor }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
  if (token === undefined) return { ok: true };

  const pageToken = classifyListCommitsPageToken(token);
  if (pageToken.kind === 'valid') return { ok: true, cursor: pageToken.cursor };

  if (pageToken.kind === 'invalid') {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_INVALID_OPTIONS', pageToken.message, {
          operation: 'listCommits',
          option: 'pageToken',
          details: pageToken.details,
        }),
      ],
    };
  }

  return {
    ok: false,
    diagnostics: [
      staleListCommitsPageTokenDiagnostic(diagnostic, pageToken.message, pageToken.details),
    ],
  };
}

export function publicListCommitsPageTokenFor(cursor: ParsedListCommitsPageCursor): string {
  evictListCommitsCursorCache();
  const publicToken = `${VERSION_GRAPH_LIST_COMMITS_PAGE_TOKEN_PREFIX}${nextCursorHandle()}`;
  LIST_COMMITS_CURSOR_CACHE.set(publicToken, cursor);
  return publicToken;
}

function staleListCommitsPageTokenDiagnostic(
  diagnostic: GraphDiagnosticFactory,
  message: string,
  details: Readonly<Record<string, string | number | boolean | null>>,
): VersionGraphStoreDiagnostic {
  return diagnostic('VERSION_STALE_PAGE_CURSOR', message, {
    operation: 'listCommits',
    option: 'pageToken',
    details: graphMetadataCompletenessDetails('stale', details),
  });
}

function nextCursorHandle(): string {
  listCommitsCursorSequence = (listCommitsCursorSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${randomCursorSegment()}.${Date.now().toString(36)}.${listCommitsCursorSequence.toString(36)}`;
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

function evictListCommitsCursorCache(): void {
  while (LIST_COMMITS_CURSOR_CACHE.size >= VERSION_GRAPH_LIST_COMMITS_CURSOR_CACHE_MAX_ENTRIES) {
    const oldest = LIST_COMMITS_CURSOR_CACHE.keys().next().value;
    if (!oldest) return;
    LIST_COMMITS_CURSOR_CACHE.delete(oldest);
  }
}
