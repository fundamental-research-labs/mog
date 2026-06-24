import type {
  InMemoryWorkbookCommitStore,
  WorkbookCommit,
  WorkbookCommitStoreDiagnostic,
} from '../commit-store';
import {
  danglingRefDiagnostic,
  diagnostic,
  missingCommitDiagnostics,
  refStoreDiagnostic,
} from './graph-store-diagnostics';
import type { VersionGraphStoreOperation } from './graph-store-operation';
import {
  VERSION_GRAPH_MAIN_REF,
  graphRefFromLiveRef,
  graphRefNameFromRefName,
} from './graph-store-refs';
import { uniqueSortedCommitIds } from './graph-store-traversal';
import type { WorkbookCommitId } from '../object-digest';
import type { RefName } from '../refs/ref-name';
import type { InMemoryRefStore, LiveRefRecord } from '../refs/ref-store';
import type { VersionGraphStoreDiagnostic } from './graph-store-types';

export type GraphLiveRefReadResult =
  | { readonly ok: true; readonly ref: LiveRefRecord }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] };

export type GraphCommitFromRefReadResult =
  | { readonly ok: true; readonly commit: WorkbookCommit }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] };

export type GraphReachableCommitReadResult =
  | {
      readonly ok: true;
      readonly commits: ReadonlyMap<WorkbookCommitId, WorkbookCommit>;
    }
  | {
      readonly ok: false;
      readonly commits: ReadonlyMap<WorkbookCommitId, WorkbookCommit>;
      readonly diagnostics: readonly VersionGraphStoreDiagnostic[];
      readonly sourceDiagnostics: readonly WorkbookCommitStoreDiagnostic[];
    };

export async function readCommitFromGraphRef(
  commitStore: InMemoryWorkbookCommitStore,
  ref: LiveRefRecord,
  operation: VersionGraphStoreOperation,
): Promise<GraphCommitFromRefReadResult> {
  const read = await commitStore.readCommit(ref.targetCommitId);
  if (read.status === 'success') {
    return { ok: true, commit: read.commit };
  }

  const graphRef = graphRefFromLiveRef(ref);
  return {
    ok: false,
    diagnostics: [
      danglingRefDiagnostic(graphRef, operation, read.diagnostics),
      ...missingCommitDiagnostics(ref.targetCommitId, operation, read.diagnostics),
    ],
  };
}

export async function collectReachableGraphCommits(
  commitStore: InMemoryWorkbookCommitStore,
  rootCommitId: WorkbookCommitId,
  operation: VersionGraphStoreOperation,
): Promise<GraphReachableCommitReadResult> {
  const commits = new Map<WorkbookCommitId, WorkbookCommit>();
  const sourceDiagnostics: WorkbookCommitStoreDiagnostic[] = [];
  const diagnostics: VersionGraphStoreDiagnostic[] = [];
  const pending = [rootCommitId];
  const seen = new Set<WorkbookCommitId>();

  while (pending.length > 0) {
    const commitId = pending.shift() as WorkbookCommitId;
    if (seen.has(commitId)) continue;
    seen.add(commitId);

    const read = await commitStore.readCommit(commitId);
    if (read.status !== 'success') {
      sourceDiagnostics.push(...read.diagnostics);
      diagnostics.push(...missingCommitDiagnostics(commitId, operation, read.diagnostics));
      continue;
    }

    commits.set(commitId, read.commit);
    pending.push(...uniqueSortedCommitIds(read.commit.payload.parentCommitIds));
  }

  if (diagnostics.length > 0) {
    return { ok: false, commits, diagnostics, sourceDiagnostics };
  }
  return { ok: true, commits };
}

export function readGraphMainRef(
  refStore: InMemoryRefStore,
  operation?: VersionGraphStoreOperation,
): GraphLiveRefReadResult {
  const result = refStore.getRef('main');
  if (!result.ok) {
    return { ok: false, diagnostics: [refStoreDiagnostic(result.diagnostics, operation)] };
  }
  if (result.ref === null) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_GRAPH_UNINITIALIZED', 'Graph main ref is not initialized.', {
          refName: VERSION_GRAPH_MAIN_REF,
          operation,
        }),
      ],
    };
  }
  return { ok: true, ref: result.ref };
}

export function readGraphBranchRef(
  refStore: InMemoryRefStore,
  refName: RefName,
  operation?: VersionGraphStoreOperation,
): GraphLiveRefReadResult {
  const result = refStore.getRef(refName);
  if (!result.ok) {
    return { ok: false, diagnostics: [refStoreDiagnostic(result.diagnostics, operation)] };
  }
  if (result.ref === null) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_INVALID_OPTIONS', 'Graph branch ref was not found.', {
          refName: graphRefNameFromRefName(refName),
          operation,
          option: 'ref',
          details: { refMissing: true },
        }),
      ],
    };
  }
  return { ok: true, ref: result.ref };
}
