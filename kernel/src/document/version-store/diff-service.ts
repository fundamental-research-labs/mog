import type {
  VersionDiffOptions,
  ObjectDigest,
  VersionStoreDiagnostic as PublicVersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookDiffPage,
} from '@mog-sdk/contracts/api';
import { VERSION_DIFF_PAGE_ORDER } from '@mog-sdk/contracts/versioning';

import {
  degradedDiffPage,
  diagnostic,
  diffCompletenessDiagnostics,
  graphDiagnostics,
  type DiffServiceDegradedResult,
} from './diff-service-diagnostics';
import { pageStartOffset } from './diff-service-order-key';
import {
  internalPageTokenForOffset,
  internalPageTokenForOrderKey,
  parseDiffOptions,
  parsePageToken,
  publicPageTokenFor,
} from './diff-service-pagination';
import { readSemanticChangeSet } from './diff-service-object-diagnostics';
import { resolveCommitish } from './diff-service-commit-resolution';
import { mapSemanticChangeSet } from './diff-service-semantic-mapping';
import { openVisibleDiffGraph } from './diff-service-visible-graph';
import { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF } from './graph';
import { type VersionStoreDiagnostic, type VersionStoreProvider } from './provider';

type NormalizedDiffCommitish =
  | {
      readonly kind: 'commit';
      readonly id: WorkbookCommitId;
    }
  | {
      readonly kind: 'ref';
      readonly name: typeof VERSION_GRAPH_HEAD_REF | typeof VERSION_GRAPH_MAIN_REF;
    };

type DiffServiceSuccessResult = Extract<WorkbookDiffPage, { readonly status: 'success' }> & {
  readonly diagnostics: readonly (PublicVersionStoreDiagnostic | VersionStoreDiagnostic)[];
};

type DiffServiceResult = DiffServiceSuccessResult | DiffServiceDegradedResult;

export type WorkbookVersionDiffMetadataPage =
  | (DiffServiceSuccessResult & {
      readonly baseCommitId: WorkbookCommitId;
      readonly targetCommitId: WorkbookCommitId;
      readonly changeSetDigest: ObjectDigest;
    })
  | DiffServiceDegradedResult;

export type WorkbookVersionDiffServiceOptions = {
  readonly provider: VersionStoreProvider;
};

export class WorkbookVersionDiffService {
  private readonly provider: VersionStoreProvider;

  constructor(options: WorkbookVersionDiffServiceOptions) {
    this.provider = options.provider;
  }

  async diff(
    base: NormalizedDiffCommitish,
    target: NormalizedDiffCommitish,
    options: VersionDiffOptions = {},
  ): Promise<DiffServiceResult> {
    const result = await this.diffWithMetadata(base, target, options);
    if (result.status === 'degraded') return result;
    return {
      status: 'success',
      items: result.items,
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
      readRevision: result.readRevision,
      order: result.order,
      diagnostics: result.diagnostics,
    };
  }

  async diffWithMetadata(
    base: NormalizedDiffCommitish,
    target: NormalizedDiffCommitish,
    options: VersionDiffOptions = {},
  ): Promise<WorkbookVersionDiffMetadataPage> {
    const parsedOptions = parseDiffOptions(options);
    if (parsedOptions.diagnostics.length > 0) {
      return degradedDiffPage(parsedOptions.diagnostics);
    }

    const opened = await openVisibleDiffGraph(this.provider);
    if (!opened.ok) return degradedDiffPage(opened.diagnostics);

    const resolvedBase = await resolveCommitish(opened.graph, base, 'base');
    if (!resolvedBase.ok) return degradedDiffPage(resolvedBase.diagnostics);
    const resolvedTarget = await resolveCommitish(opened.graph, target, 'target');
    if (!resolvedTarget.ok) return degradedDiffPage(resolvedTarget.diagnostics);

    const pageToken = parsePageToken(
      parsedOptions.options.pageToken,
      resolvedBase.commitId,
      resolvedTarget.commitId,
    );
    if (!pageToken.ok) return degradedDiffPage(pageToken.diagnostics);

    const closure = await opened.graph.readCommitClosure(resolvedTarget.commitId);
    if (closure.status !== 'success') {
      return degradedDiffPage(graphDiagnostics(closure.diagnostics));
    }

    const targetCommit = closure.commits.find((commit) => commit.id === resolvedTarget.commitId);
    if (!targetCommit) {
      return degradedDiffPage([
        diagnostic(
          'VERSION_UNMATERIALIZABLE_COMMIT',
          'Target commit is absent from its readable commit closure.',
          {
            details: { selector: 'target' },
          },
        ),
      ]);
    }

    let semanticPayload: unknown | undefined;
    const directParentDiff =
      targetCommit.payload.parentCommitIds.length === 1 &&
      targetCommit.payload.parentCommitIds[0] === resolvedBase.commitId;
    if (!directParentDiff && targetCommit.payload.parentCommitIds.length === 2) {
      const candidate = await readSemanticChangeSet(
        opened.objectStore,
        targetCommit.payload.semanticChangeSetDigest,
      );
      if (!candidate.ok) return degradedDiffPage(candidate.diagnostics);
      if (
        isProvenMaterializedMergeDiff(
          candidate.payload,
          resolvedBase.commitId,
          targetCommit.payload.parentCommitIds,
        )
      ) {
        semanticPayload = candidate.payload;
      }
    }

    if (!directParentDiff && semanticPayload === undefined) {
      return degradedDiffPage([
        diagnostic(
          'VERSION_UNMATERIALIZABLE_COMMIT',
          'This semantic diff slice supports only direct parent-child diffs or materialized merge diffs proven by the target semantic change-set.',
          {
            details: {
              parentCount: targetCommit.payload.parentCommitIds.length,
              parentMatchesBase: targetCommit.payload.parentCommitIds[0] === resolvedBase.commitId,
              mergeProofMatchesBase: false,
            },
          },
        ),
      ]);
    }

    const completenessDiagnostics = diffCompletenessDiagnostics(
      closure.commits,
      resolvedBase.commitId,
      resolvedTarget.commitId,
    );
    if (completenessDiagnostics.length > 0) {
      return degradedDiffPage(completenessDiagnostics);
    }

    if (semanticPayload === undefined) {
      const semanticRecord = await readSemanticChangeSet(
        opened.objectStore,
        targetCommit.payload.semanticChangeSetDigest,
      );
      if (!semanticRecord.ok) return degradedDiffPage(semanticRecord.diagnostics);
      semanticPayload = semanticRecord.payload;
    }

    const entries = mapSemanticChangeSet(semanticPayload);
    if (!entries.ok) return degradedDiffPage(entries.diagnostics);

    const offset = pageStartOffset(entries.items, pageToken.cursor);
    const pageEntries = entries.items.slice(offset, offset + parsedOptions.options.pageSize);
    const pageItems = pageEntries.map((item) => item.entry);
    const nextOffset = offset + pageEntries.length;
    const shouldUseOrderKeyCursor = entries.items.some((entry) => entry.hasExplicitOrderKey);
    const internalNextPageToken =
      nextOffset < entries.items.length
        ? shouldUseOrderKeyCursor && pageEntries.length > 0
          ? internalPageTokenForOrderKey(
              resolvedBase.commitId,
              resolvedTarget.commitId,
              pageEntries[pageEntries.length - 1]!.orderKey,
            )
          : internalPageTokenForOffset(resolvedBase.commitId, resolvedTarget.commitId, nextOffset)
        : undefined;
    const nextPageToken = internalNextPageToken
      ? publicPageTokenFor(internalNextPageToken)
      : undefined;

    return {
      status: 'success',
      items: pageItems,
      ...(nextPageToken ? { nextPageToken } : {}),
      readRevision: resolvedTarget.readRevision,
      order: VERSION_DIFF_PAGE_ORDER,
      diagnostics: [],
      baseCommitId: resolvedBase.commitId,
      targetCommitId: resolvedTarget.commitId,
      changeSetDigest: targetCommit.payload.semanticChangeSetDigest,
    };
  }
}

function isProvenMaterializedMergeDiff(
  payload: unknown,
  baseCommitId: WorkbookCommitId,
  parentCommitIds: readonly WorkbookCommitId[],
): boolean {
  if (!isRecord(payload) || !isRecord(payload.merge)) return false;
  return (
    payload.merge.baseCommitId === baseCommitId &&
    payload.merge.oursCommitId === parentCommitIds[0] &&
    payload.merge.theirsCommitId === parentCommitIds[1]
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

export function createWorkbookVersionDiffService(
  options: WorkbookVersionDiffServiceOptions,
): WorkbookVersionDiffService {
  return new WorkbookVersionDiffService(options);
}
