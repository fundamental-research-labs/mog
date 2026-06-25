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

type MaterializedMergeDiffRole = 'base' | 'ours' | 'theirs';

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
        (semanticPayload = materializedMergeDiffPayload(
          candidate.payload,
          resolvedBase.commitId,
          targetCommit.payload.parentCommitIds,
        ))
      ) {
        // The semantic payload was already projected for the requested merge diff slice.
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

function materializedMergeDiffPayload(
  payload: unknown,
  baseCommitId: WorkbookCommitId,
  parentCommitIds: readonly WorkbookCommitId[],
): unknown | undefined {
  const role = materializedMergeDiffRole(payload, baseCommitId, parentCommitIds);
  if (!role) return undefined;
  if (role === 'base' && (!isRecord(payload) || !Array.isArray(payload.mergeChanges))) {
    return payload;
  }
  if (!isRecord(payload) || !Array.isArray(payload.mergeChanges)) return undefined;

  const changes: unknown[] = [];
  for (const change of payload.mergeChanges) {
    const projected = projectMaterializedMergeChange(change, role);
    if (projected === null) return undefined;
    if (projected !== undefined) changes.push(projected);
  }

  return {
    schemaVersion: payload.schemaVersion,
    merge: payload.merge,
    changes,
  };
}

function materializedMergeDiffRole(
  payload: unknown,
  baseCommitId: WorkbookCommitId,
  parentCommitIds: readonly WorkbookCommitId[],
): MaterializedMergeDiffRole | null {
  if (!isRecord(payload) || !isRecord(payload.merge)) return null;
  const merge = materializedMergeProof(payload.merge);
  if (!merge || !materializedMergeParentsMatch(parentCommitIds, merge)) return null;

  if (merge.baseCommitId === baseCommitId) return 'base';
  if (merge.oursCommitId === baseCommitId) return 'ours';
  if (merge.theirsCommitId === baseCommitId) return 'theirs';
  return null;
}

function materializedMergeProof(value: Readonly<Record<string, unknown>>): {
  readonly baseCommitId: WorkbookCommitId;
  readonly oursCommitId: WorkbookCommitId;
  readonly theirsCommitId: WorkbookCommitId;
} | null {
  if (
    typeof value.baseCommitId !== 'string' ||
    typeof value.oursCommitId !== 'string' ||
    typeof value.theirsCommitId !== 'string'
  ) {
    return null;
  }
  return {
    baseCommitId: value.baseCommitId as WorkbookCommitId,
    oursCommitId: value.oursCommitId as WorkbookCommitId,
    theirsCommitId: value.theirsCommitId as WorkbookCommitId,
  };
}

function materializedMergeParentsMatch(
  parentCommitIds: readonly WorkbookCommitId[],
  merge: {
    readonly oursCommitId: WorkbookCommitId;
    readonly theirsCommitId: WorkbookCommitId;
  },
): boolean {
  if (
    parentCommitIds.length !== 2 ||
    parentCommitIds[0] === parentCommitIds[1] ||
    merge.oursCommitId === merge.theirsCommitId
  ) {
    return false;
  }
  return (
    (parentCommitIds[0] === merge.oursCommitId && parentCommitIds[1] === merge.theirsCommitId) ||
    (parentCommitIds[0] === merge.theirsCommitId && parentCommitIds[1] === merge.oursCommitId)
  );
}

function projectMaterializedMergeChange(
  change: unknown,
  role: MaterializedMergeDiffRole,
): unknown | undefined | null {
  if (!isRecord(change)) return null;
  const before = mergeDiffBeforeValue(change, role);
  const after = change.merged;
  if (before === undefined || after === undefined) return null;
  if (jsonValuesEqual(before, after)) return undefined;
  return {
    structural: change.structural,
    before,
    after,
    ...(change.display ? { display: change.display } : {}),
  };
}

function mergeDiffBeforeValue(
  change: Readonly<Record<string, unknown>>,
  role: MaterializedMergeDiffRole,
): unknown {
  if (role === 'base') return change.base;
  if (role === 'ours') return change.ours ?? change.base;
  return change.theirs ?? change.base;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((entry, index) => jsonValuesEqual(entry, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) => key === rightKeys[index] && jsonValuesEqual(left[key], right[key]),
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
