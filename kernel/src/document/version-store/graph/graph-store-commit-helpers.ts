import type { WorkbookCommit } from '../commit-store';
import { parseWorkbookCommitId, type WorkbookCommitId } from '../object-digest';
import type {
  VersionGraphCommitSummary,
  VersionGraphStoreDiagnostic,
  VersionGraphWriteSuccess,
} from './graph-store-types';
import { graphRefFromLiveRef } from './graph-store-refs';
import type { LiveRefRecord } from '../refs/ref-store';

type InvalidCommitDiagnosticFactory = (
  code: 'VERSION_INVALID_COMMIT_ID',
  message: string,
) => VersionGraphStoreDiagnostic;

export function parseGraphCommitExpectedHead(
  value: WorkbookCommitId | string,
  diagnostic: InvalidCommitDiagnosticFactory,
):
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
  try {
    return { ok: true, commitId: parseWorkbookCommitId(value) };
  } catch {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_INVALID_COMMIT_ID', 'Commit id must be commit:sha256:<64 hex>.'),
      ],
    };
  }
}

export function graphWriteSuccess(
  commit: WorkbookCommit,
  ref: LiveRefRecord,
  mainRef: LiveRefRecord = ref,
): VersionGraphWriteSuccess {
  return {
    status: 'success',
    commit,
    ref: graphRefFromLiveRef(ref),
    main: graphRefFromLiveRef(mainRef),
    diagnostics: [],
  };
}

export function graphCommitSummary(commit: WorkbookCommit): VersionGraphCommitSummary {
  return {
    id: commit.id,
    parents: [...commit.payload.parentCommitIds],
    createdAt: commit.payload.createdAt,
    author: { ...commit.payload.author },
    ...(commit.payload.annotation ? { annotation: commit.payload.annotation } : {}),
  };
}
