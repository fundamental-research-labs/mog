import type {
  VersionMainRefName,
  VersionRef,
  VersionRefName,
  WorkbookCommitId,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import type { VersionHistoryData } from '../version-history-panel-data';

const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';
const VERSION_MAIN_BRANCH = 'main';
const VERSION_MAIN_REF = 'refs/heads/main';

export type VersionMergeTarget = {
  readonly commitId: WorkbookCommitId;
  readonly refName?: VersionMainRefName | VersionRefName;
};

export type LoadedMergeBaseResult =
  | { readonly ok: true; readonly baseCommitId: WorkbookCommitId }
  | { readonly ok: false; readonly reason: string };

export function resolveCurrentMergeTarget(
  data: VersionHistoryData,
): VersionMergeTarget | undefined {
  const current = data.surface?.current;
  const commitId =
    (current?.checkedOutCommitId as WorkbookCommitId | undefined) ??
    (current?.headCommitId as WorkbookCommitId | undefined) ??
    data.head?.id;
  const surfaceRefName = publicBranchRefName(current?.branchName);
  const refName = surfaceRefName ?? (current?.checkedOutCommitId ? undefined : data.head?.refName);
  if (!commitId) return undefined;
  return {
    commitId,
    ...(refName ? { refName } : {}),
  };
}

export function mergeSourceRefs(data: VersionHistoryData): readonly VersionRef[] {
  const current = data.surface?.current;
  const surfaceRefName = publicBranchRefName(current?.branchName);
  const currentRefName =
    surfaceRefName ?? (current?.checkedOutCommitId ? undefined : data.head?.refName);
  return data.refs.filter((ref) => ref.name !== currentRefName);
}

export function findLoadedMergeBase(
  commits: readonly WorkbookCommitSummary[],
  ours: WorkbookCommitId,
  theirs: WorkbookCommitId,
): LoadedMergeBaseResult {
  const commitMap = new Map<WorkbookCommitId, WorkbookCommitSummary>(
    commits.map((commit) => [commit.id, commit]),
  );
  const oursDistances = collectAncestorDistances(commitMap, ours);
  const theirsDistances = collectAncestorDistances(commitMap, theirs);

  if (oursDistances.size === 0) {
    return { ok: false, reason: 'Current head is not available in loaded history.' };
  }
  if (theirsDistances.size === 0) {
    return { ok: false, reason: 'Source ref tip is not available in loaded history.' };
  }

  let best:
    | {
        readonly commitId: WorkbookCommitId;
        readonly totalDistance: number;
        readonly oursDistance: number;
        readonly theirsDistance: number;
      }
    | undefined;
  for (const [commitId, oursDistance] of oursDistances) {
    const theirsDistance = theirsDistances.get(commitId);
    if (theirsDistance === undefined) continue;
    const candidate = {
      commitId,
      oursDistance,
      theirsDistance,
      totalDistance: oursDistance + theirsDistance,
    };
    if (
      !best ||
      candidate.totalDistance < best.totalDistance ||
      (candidate.totalDistance === best.totalDistance &&
        candidate.oursDistance < best.oursDistance) ||
      (candidate.totalDistance === best.totalDistance &&
        candidate.oursDistance === best.oursDistance &&
        candidate.theirsDistance < best.theirsDistance)
    ) {
      best = candidate;
    }
  }

  if (!best) {
    return {
      ok: false,
      reason: 'No common ancestor is available in loaded history for these refs.',
    };
  }
  return { ok: true, baseCommitId: best.commitId };
}

function collectAncestorDistances(
  commitMap: ReadonlyMap<WorkbookCommitId, WorkbookCommitSummary>,
  start: WorkbookCommitId,
): Map<WorkbookCommitId, number> {
  const distances = new Map<WorkbookCommitId, number>();
  const queue: Array<{ readonly commitId: WorkbookCommitId; readonly distance: number }> = [
    { commitId: start, distance: 0 },
  ];

  for (let index = 0; index < queue.length; index += 1) {
    const { commitId, distance } = queue[index]!;
    const previous = distances.get(commitId);
    if (previous !== undefined && previous <= distance) continue;
    distances.set(commitId, distance);

    const commit = commitMap.get(commitId);
    if (!commit) continue;
    for (const parentId of commit.parents) {
      queue.push({ commitId: parentId, distance: distance + 1 });
    }
  }

  return distances;
}

function publicBranchRefName(
  value: string | undefined,
): VersionMainRefName | VersionRefName | undefined {
  if (!value) return undefined;
  if (value === VERSION_MAIN_BRANCH) return VERSION_MAIN_REF as VersionMainRefName;
  if (value.startsWith(VERSION_BRANCH_REF_PREFIX)) {
    return value as VersionMainRefName | VersionRefName;
  }
  if (value.startsWith('refs/')) return undefined;
  return `${VERSION_BRANCH_REF_PREFIX}${value}` as VersionRefName;
}
