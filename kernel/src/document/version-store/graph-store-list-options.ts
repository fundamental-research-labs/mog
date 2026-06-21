import type { VersionGraphListCommitsOptions, VersionGraphStoreDiagnostic } from './graph-store';

export const VERSION_GRAPH_LIST_COMMITS_DEFAULT_PAGE_SIZE = 50;
export const VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_SIZE = 500;

type GraphDiagnosticFactory = (
  code: VersionGraphStoreDiagnostic['code'],
  message: string,
  options?: Omit<VersionGraphStoreDiagnostic, 'code' | 'severity' | 'message'>,
) => VersionGraphStoreDiagnostic;

export function parseListCommitsOptions(
  options: VersionGraphListCommitsOptions,
  diagnostic: GraphDiagnosticFactory,
):
  | { readonly ok: true; readonly pageSize: number }
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

  return { ok: true, pageSize };
}
