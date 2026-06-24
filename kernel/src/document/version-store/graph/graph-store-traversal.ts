import type { WorkbookCommit } from '../commit-store';
import type { WorkbookCommitId } from '../object-digest';
import type { VersionGraphStoreDiagnostic } from './graph-store-types';
import type { VersionGraphStoreOperation } from './graph-store-operation';

export type VersionGraphMetadataCompletenessCondition = 'stale' | 'history-gap' | 'corrupt';

export function graphMetadataCompletenessDetails(
  condition: VersionGraphMetadataCompletenessCondition,
  details: Readonly<Record<string, string | number | boolean | null>> = {},
): Readonly<Record<string, string | number | boolean | null>> {
  return {
    completenessMarker: 'diagnostic-read',
    completenessScope: 'graph-metadata',
    completenessCondition: condition,
    accessFiltered: true,
    ...details,
  };
}

export function orderTopologicalNewestFirst(
  rootCommitId: WorkbookCommitId,
  commits: ReadonlyMap<WorkbookCommitId, WorkbookCommit>,
  operation: VersionGraphStoreOperation = 'listCommits',
):
  | { readonly commits: readonly WorkbookCommit[]; readonly diagnostics: readonly [] }
  | {
      readonly commits: readonly [];
      readonly diagnostics: readonly VersionGraphStoreDiagnostic[];
    } {
  const root = commits.get(rootCommitId);
  if (root === undefined) {
    return {
      commits: [],
      diagnostics: [
        missingCommitDiagnostic(rootCommitId, operation, 'Traversal root commit is missing.'),
      ],
    };
  }

  const validation = validateTraversalShape(rootCommitId, commits, operation);
  if (!validation.ok) {
    return { commits: [], diagnostics: validation.diagnostics };
  }

  const reachableChildCounts = new Map<WorkbookCommitId, number>();
  const generations = new Map<WorkbookCommitId, number>([[rootCommitId, 0]]);
  const generationQueue = [rootCommitId];

  while (generationQueue.length > 0) {
    const commitId = generationQueue.shift() as WorkbookCommitId;
    const commit = commits.get(commitId);
    if (commit === undefined) continue;
    const nextGeneration = (generations.get(commitId) ?? 0) + 1;

    for (const parentId of uniqueSortedCommitIds(commit.payload.parentCommitIds)) {
      if (!commits.has(parentId)) continue;
      reachableChildCounts.set(parentId, (reachableChildCounts.get(parentId) ?? 0) + 1);
      const currentGeneration = generations.get(parentId);
      if (currentGeneration === undefined || nextGeneration > currentGeneration) {
        generations.set(parentId, nextGeneration);
        generationQueue.push(parentId);
      }
    }
  }

  const emitted = new Set<WorkbookCommitId>();
  const eligible = [rootCommitId];
  const ordered: WorkbookCommit[] = [];

  while (eligible.length > 0) {
    eligible.sort((left, right) => compareQueueEntries(left, right, generations, commits));
    const commitId = eligible.shift() as WorkbookCommitId;
    if (emitted.has(commitId)) continue;
    const commit = commits.get(commitId);
    if (commit === undefined) continue;

    emitted.add(commitId);
    ordered.push(commit);

    for (const parentId of uniqueSortedCommitIds(commit.payload.parentCommitIds)) {
      if (!commits.has(parentId) || emitted.has(parentId)) continue;
      const remaining = (reachableChildCounts.get(parentId) ?? 0) - 1;
      reachableChildCounts.set(parentId, remaining);
      if (remaining <= 0) {
        eligible.push(parentId);
      }
    }
  }

  if (ordered.length !== commits.size) {
    return {
      commits: [],
      diagnostics: [
        {
          code: 'VERSION_INVALID_COMMIT_PAYLOAD',
          severity: 'error',
          message: 'Commit graph traversal could not reach a stable topological order.',
          operation,
          details: {
            ...graphMetadataCompletenessDetails('corrupt'),
            orderedCommitCount: ordered.length,
            reachableCommitCount: commits.size,
          },
        },
      ],
    };
  }

  return { commits: ordered, diagnostics: [] };
}

export function uniqueSortedCommitIds(
  commitIds: readonly WorkbookCommitId[],
): readonly WorkbookCommitId[] {
  return [...new Set(commitIds)].sort((left, right) => left.localeCompare(right));
}

function validateTraversalShape(
  rootCommitId: WorkbookCommitId,
  commits: ReadonlyMap<WorkbookCommitId, WorkbookCommit>,
  operation: VersionGraphStoreOperation,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
  const visiting = new Set<WorkbookCommitId>();
  const visited = new Set<WorkbookCommitId>();

  const visit = (
    commitId: WorkbookCommitId,
    childCommitId?: WorkbookCommitId,
  ): readonly VersionGraphStoreDiagnostic[] => {
    const commit = commits.get(commitId);
    if (commit === undefined) {
      return [missingParentDiagnostic(commitId, childCommitId, operation)];
    }
    if (visiting.has(commitId)) {
      return [cyclicTraversalDiagnostic(commitId, childCommitId, operation)];
    }
    if (visited.has(commitId)) return [];

    visiting.add(commitId);
    for (const parentId of uniqueSortedCommitIds(commit.payload.parentCommitIds)) {
      const diagnostics = visit(parentId, commitId);
      if (diagnostics.length > 0) return diagnostics;
    }
    visiting.delete(commitId);
    visited.add(commitId);
    return [];
  };

  const diagnostics = visit(rootCommitId);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  if (visited.size !== commits.size) {
    return {
      ok: false,
      diagnostics: [unreachableTraversalDiagnostic(visited.size, commits.size, operation)],
    };
  }
  return { ok: true };
}

function compareQueueEntries(
  left: WorkbookCommitId,
  right: WorkbookCommitId,
  generations: ReadonlyMap<WorkbookCommitId, number>,
  commits: ReadonlyMap<WorkbookCommitId, WorkbookCommit>,
): number {
  const generationDiff = (generations.get(right) ?? 0) - (generations.get(left) ?? 0);
  if (generationDiff !== 0) return generationDiff;

  const leftCreatedAt = commits.get(left)?.payload.createdAt ?? '';
  const rightCreatedAt = commits.get(right)?.payload.createdAt ?? '';
  const createdAtDiff = rightCreatedAt.localeCompare(leftCreatedAt);
  if (createdAtDiff !== 0) return createdAtDiff;

  return left.localeCompare(right);
}

function missingCommitDiagnostic(
  commitId: WorkbookCommitId,
  operation: VersionGraphStoreOperation,
  message: string,
): VersionGraphStoreDiagnostic {
  return {
    code: 'VERSION_MISSING_OBJECT',
    severity: 'corruption',
    message,
    commitId,
    objectKind: 'commit',
    operation,
    details: graphMetadataCompletenessDetails('history-gap', { missingCommitRole: 'root' }),
  };
}

function missingParentDiagnostic(
  commitId: WorkbookCommitId,
  childCommitId: WorkbookCommitId | undefined,
  operation: VersionGraphStoreOperation,
): VersionGraphStoreDiagnostic {
  return {
    code: 'VERSION_MISSING_PARENT',
    severity: 'corruption',
    message: 'Commit graph traversal found a missing parent commit.',
    commitId,
    objectKind: 'commit',
    operation,
    details: graphMetadataCompletenessDetails('history-gap', {
      missingCommitRole: 'parent',
      ...(childCommitId === undefined ? {} : { childCommitId }),
    }),
  };
}

function cyclicTraversalDiagnostic(
  commitId: WorkbookCommitId,
  childCommitId: WorkbookCommitId | undefined,
  operation: VersionGraphStoreOperation,
): VersionGraphStoreDiagnostic {
  return {
    code: 'VERSION_INVALID_COMMIT_PAYLOAD',
    severity: 'corruption',
    message: 'Commit graph traversal encountered a parent cycle.',
    commitId,
    objectKind: 'commit',
    operation,
    details: graphMetadataCompletenessDetails('corrupt', {
      corruptTraversalCondition: 'parentCycle',
      ...(childCommitId === undefined ? {} : { childCommitId }),
    }),
  };
}

function unreachableTraversalDiagnostic(
  reachableCommitCount: number,
  commitCount: number,
  operation: VersionGraphStoreOperation,
): VersionGraphStoreDiagnostic {
  return {
    code: 'VERSION_INVALID_COMMIT_PAYLOAD',
    severity: 'corruption',
    message: 'Commit graph traversal includes commits that are not reachable from the root.',
    operation,
    details: graphMetadataCompletenessDetails('corrupt', {
      corruptTraversalCondition: 'unreachableCommit',
      reachableCommitCount,
      commitCount,
    }),
  };
}
