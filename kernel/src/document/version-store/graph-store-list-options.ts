import {
  VERSION_GRAPH_MAIN_REF,
  parseGraphRefSelector,
  type ParsedGraphRefSelector,
} from './graph-store-refs';
import { parseWorkbookCommitId, type WorkbookCommitId } from './object-digest';
import type {
  VersionGraphListCommitsOptions,
  VersionGraphRefSelector,
  VersionGraphStoreDiagnostic,
} from './graph-store';

export const VERSION_GRAPH_LIST_COMMITS_DEFAULT_PAGE_SIZE = 50;
export const VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_SIZE = 500;

type ParsedGraphListRefSelector = Extract<ParsedGraphRefSelector, { readonly ok: true }>;

export type ParsedListCommitsTarget =
  | {
      readonly kind: 'ref';
      readonly selector: ParsedGraphListRefSelector;
    }
  | {
      readonly kind: 'commit';
      readonly commitId: WorkbookCommitId;
    };

type GraphDiagnosticFactory = (
  code: VersionGraphStoreDiagnostic['code'],
  message: string,
  options?: Omit<VersionGraphStoreDiagnostic, 'code' | 'severity' | 'message'>,
) => VersionGraphStoreDiagnostic;

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

  if (options.pageToken !== undefined) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_STALE_PAGE_CURSOR',
          'listCommits page tokens are not implemented by this in-memory graph store slice.',
          {
            operation: 'listCommits',
            option: 'pageToken',
            details: { pageTokenUnsupported: true },
          },
        ),
      ],
    };
  }

  if (options.ref !== undefined && options.from !== undefined) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_INVALID_OPTIONS',
          'listCommits accepts either ref or from, not both.',
          {
            operation: 'listCommits',
            option: 'ref',
            details: { exclusiveOptions: 'ref,from' },
          },
        ),
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
