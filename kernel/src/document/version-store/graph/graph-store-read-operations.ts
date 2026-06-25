import { graphCommitSummary, parseGraphCommitExpectedHead } from './graph-store-commit-helpers';
import { danglingRefDiagnostic, diagnostic } from './graph-store-diagnostics';
import {
  VERSION_GRAPH_LIST_COMMITS_DEFAULT_PAGE_SIZE,
  VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_SIZE,
  parseListCommitsOptions,
  publicListCommitsPageTokenFor,
} from './graph-store-list-options';
import { resolveListCommitsRoot } from './graph-store-list-commits-root';
import type { GraphStoreRefHelpers } from './graph-store-ref-helpers';
import {
  VERSION_GRAPH_HEAD_REF,
  commitRefFromLiveRef,
  graphRefFromLiveRef,
  parseGraphRefSelector,
  symbolicHeadFromLiveRef,
} from './graph-store-refs';
import {
  graphMetadataCompletenessDetails,
  orderTopologicalNewestFirst,
} from './graph-store-traversal';
import type {
  VersionGraphClosureReadResult,
  VersionGraphCommitPageResult,
  VersionGraphListCommitsOptions,
  VersionGraphReadHeadResult,
  VersionGraphReadRefResult,
} from './graph-store-types';
import type { WorkbookCommitId } from '../object-digest';

export type GraphStoreReadContext = {
  readonly cursorNamespaceKey: string;
  readonly refs: GraphStoreRefHelpers;
};

export async function readVersionGraphHead(
  context: GraphStoreReadContext,
): Promise<VersionGraphReadHeadResult> {
  const current = context.refs.readMainRef('readHead');
  if (!current.ok) {
    return { status: 'degraded', head: null, diagnostics: current.diagnostics };
  }

  const main = graphRefFromLiveRef(current.ref);
  const readable = await context.refs.readCommitFromRef(current.ref, 'readHead');
  if (!readable.ok) {
    return {
      status: 'degraded',
      head: null,
      main,
      diagnostics: readable.diagnostics,
    };
  }

  return {
    status: 'success',
    head: commitRefFromLiveRef(current.ref, VERSION_GRAPH_HEAD_REF),
    main,
    diagnostics: [],
  };
}

export async function readVersionGraphRef(
  context: GraphStoreReadContext,
  name: string,
): Promise<VersionGraphReadRefResult> {
  const selector = parseGraphRefSelector(name, diagnostic);
  if (!selector.ok) {
    return { status: 'degraded', ref: null, diagnostics: selector.diagnostics };
  }

  if (selector.name === VERSION_GRAPH_HEAD_REF) {
    const current = context.refs.readMainRef('readRef');
    if (!current.ok) {
      return { status: 'degraded', ref: null, diagnostics: current.diagnostics };
    }

    const ref = symbolicHeadFromLiveRef(current.ref);
    const readable = await context.refs.readCommitFromRef(current.ref, 'readRef');
    if (!readable.ok) {
      return {
        status: 'degraded',
        ref,
        diagnostics: readable.diagnostics,
      };
    }

    return { status: 'success', ref, diagnostics: [] };
  }

  const current =
    selector.refName === 'main'
      ? context.refs.readMainRef('readRef')
      : context.refs.readBranchRef(selector.refName, 'readRef');
  if (!current.ok) {
    return { status: 'degraded', ref: null, diagnostics: current.diagnostics };
  }

  const ref = graphRefFromLiveRef(current.ref);
  const readable = await context.refs.readCommitFromRef(current.ref, 'readRef');
  if (!readable.ok) {
    return {
      status: 'degraded',
      ref,
      diagnostics: readable.diagnostics,
    };
  }

  return { status: 'success', ref, diagnostics: [] };
}

export async function listVersionGraphCommits(
  context: GraphStoreReadContext,
  options: VersionGraphListCommitsOptions = {},
): Promise<VersionGraphCommitPageResult> {
  const parsedOptions = parseListCommitsOptions(options, diagnostic);
  if (!parsedOptions.ok) {
    return { status: 'failed', diagnostics: parsedOptions.diagnostics };
  }

  const root = resolveListCommitsRoot(parsedOptions.target, {
    readMainRef: () => context.refs.readMainRef('listCommits'),
    readBranchRef: (refName) => context.refs.readBranchRef(refName, 'listCommits'),
  });
  if (!root.ok) {
    return { status: 'failed', diagnostics: root.diagnostics };
  }
  if (
    parsedOptions.target.kind === 'pageCursor' &&
    parsedOptions.target.cursor.root.namespaceKey !== context.cursorNamespaceKey
  ) {
    return {
      status: 'failed',
      diagnostics: [
        diagnostic(
          'VERSION_STALE_PAGE_CURSOR',
          'listCommits pageToken is stale or no longer available.',
          {
            operation: 'listCommits',
            option: 'pageToken',
            details: graphMetadataCompletenessDetails('stale', {
              cursorCategory: 'wrongNamespaceCursor',
            }),
          },
        ),
      ],
    };
  }

  const collected = await context.refs.collectReachableCommits(root.commitId, 'listCommits');
  if (!collected.ok) {
    const diagnostics =
      root.ref && !collected.commits.has(root.commitId)
        ? [
            danglingRefDiagnostic(root.ref, 'listCommits', collected.sourceDiagnostics),
            ...collected.diagnostics,
          ]
        : collected.diagnostics;
    return { status: 'failed', diagnostics };
  }

  const ordered = orderTopologicalNewestFirst(root.commitId, collected.commits, 'listCommits');
  if (ordered.diagnostics.length > 0) {
    return { status: 'failed', diagnostics: ordered.diagnostics };
  }
  const pageOffset =
    parsedOptions.target.kind === 'pageCursor' ? parsedOptions.target.cursor.offset : 0;
  if (pageOffset >= ordered.commits.length) {
    return {
      status: 'failed',
      diagnostics: [
        diagnostic(
          'VERSION_STALE_PAGE_CURSOR',
          'listCommits pageToken is stale or no longer available.',
          {
            operation: 'listCommits',
            option: 'pageToken',
            ...(root.ref ? { refName: root.ref.name } : {}),
            details: graphMetadataCompletenessDetails('stale', {
              cursorCategory: 'staleCursor',
              commitCount: ordered.commits.length,
            }),
          },
        ),
      ],
    };
  }
  const pageCommits = ordered.commits.slice(pageOffset, pageOffset + parsedOptions.pageSize);
  const nextOffset = pageOffset + pageCommits.length;
  const nextPageToken =
    nextOffset < ordered.commits.length
      ? publicListCommitsPageTokenFor({
          root: {
            commitId: root.commitId,
            namespaceKey: context.cursorNamespaceKey,
            readRevision: root.readRevision,
          },
          offset: nextOffset,
        })
      : undefined;

  return {
    status: 'success',
    commits: pageCommits.map(graphCommitSummary),
    ...(nextPageToken ? { nextPageToken } : {}),
    readRevision: root.readRevision,
    order: 'topological-newest',
    pageSize: parsedOptions.pageSize,
    diagnostics: [],
  };
}

export async function readVersionGraphCommitClosure(
  context: GraphStoreReadContext,
  commitIdInput: WorkbookCommitId | string,
): Promise<VersionGraphClosureReadResult> {
  const start = parseGraphCommitExpectedHead(commitIdInput, diagnostic);
  if (!start.ok) {
    return { status: 'failed', diagnostics: start.diagnostics };
  }

  const collected = await context.refs.collectReachableCommits(start.commitId, 'readCommitClosure');
  if (!collected.ok) {
    return { status: 'failed', diagnostics: collected.diagnostics };
  }
  const ordered = orderTopologicalNewestFirst(
    start.commitId,
    collected.commits,
    'readCommitClosure',
  );
  if (ordered.diagnostics.length > 0) {
    return { status: 'failed', diagnostics: ordered.diagnostics };
  }
  return { status: 'success', commits: ordered.commits, diagnostics: [] };
}

export { VERSION_GRAPH_LIST_COMMITS_DEFAULT_PAGE_SIZE, VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_SIZE };
