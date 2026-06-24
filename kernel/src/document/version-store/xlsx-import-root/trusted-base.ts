import type { WorkbookCommit } from '../commit-store';
import type { WorkbookCommitId } from '../object-digest';
import {
  mapGraphDiagnostics,
  type VersionGraphStore,
  type VersionStoreDiagnostic,
} from '../provider';
import {
  metadataHeadCandidateNamesSupportedRef,
  metadataHeadCandidateTrustedBaseMismatchReason,
} from './validation';
import type {
  XlsxVersionMetadataHeadCandidate,
  XlsxVersionMetadataTrustDowngradeReason,
} from './provenance';
import type { XlsxVersionExistingGraphImportInput } from './results';

type XlsxVersionTrustedBaseReadResult =
  | {
      readonly status: 'success';
      readonly commit: WorkbookCommit;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'skipped';
      readonly reason: XlsxVersionMetadataTrustDowngradeReason;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    }
  | { readonly status: 'failed'; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export async function readTrustedBaseCommit(
  input: XlsxVersionExistingGraphImportInput,
  candidate: XlsxVersionMetadataHeadCandidate,
  visibleHeadCommitId: WorkbookCommitId,
): Promise<XlsxVersionTrustedBaseReadResult> {
  if (candidate.documentId !== input.namespace.documentId) {
    return { status: 'skipped', reason: 'wrong-document', diagnostics: [] };
  }
  if (!metadataHeadCandidateNamesSupportedRef(candidate)) {
    return { status: 'skipped', reason: 'head-unverified', diagnostics: [] };
  }

  const read = await input.graph.readCommit(candidate.head.commitId);
  if (read.status !== 'success') {
    return { status: 'skipped', reason: 'commit-missing', diagnostics: [] };
  }

  const mismatchReason = metadataHeadCandidateTrustedBaseMismatchReason(candidate, read.commit);
  if (mismatchReason) {
    return { status: 'skipped', reason: mismatchReason, diagnostics: [] };
  }

  const reachable = await metadataHeadCandidateIsOnVisibleHeadHistory({
    graph: input.graph,
    visibleHeadCommitId,
    candidateCommitId: read.commit.id,
  });
  if (reachable.status !== 'success') return reachable;
  if (!reachable.reachable) {
    return { status: 'skipped', reason: 'head-unverified', diagnostics: [] };
  }

  return { status: 'success', commit: read.commit, diagnostics: [] };
}

async function metadataHeadCandidateIsOnVisibleHeadHistory(input: {
  readonly graph: VersionGraphStore;
  readonly visibleHeadCommitId: WorkbookCommitId;
  readonly candidateCommitId: WorkbookCommitId;
}): Promise<
  | { readonly status: 'success'; readonly reachable: boolean; readonly diagnostics: readonly [] }
  | { readonly status: 'failed'; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const pending = [input.visibleHeadCommitId];
  const seen = new Set<WorkbookCommitId>();
  while (pending.length > 0) {
    const commitId = pending.shift();
    if (!commitId || seen.has(commitId)) continue;
    if (commitId === input.candidateCommitId) {
      return { status: 'success', reachable: true, diagnostics: [] };
    }
    seen.add(commitId);

    const read = await input.graph.readCommit(commitId);
    if (read.status !== 'success') {
      return {
        status: 'failed',
        diagnostics: mapGraphDiagnostics(read.diagnostics, 'commitGraphWrite'),
      };
    }
    pending.push(...read.commit.payload.parentCommitIds);
  }
  return { status: 'success', reachable: false, diagnostics: [] };
}
