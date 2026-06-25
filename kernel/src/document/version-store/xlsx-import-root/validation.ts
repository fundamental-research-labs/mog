import { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF } from '../graph';
import type { WorkbookCommit } from '../commit-store';
import { isObjectDigest, type ObjectDigest } from '../object-digest';
import type {
  XlsxVersionMetadataHeadCandidate,
  XlsxVersionMetadataTrustDowngradeReason,
} from './provenance';

export function metadataHeadCandidateNamesSupportedRef(
  candidate: XlsxVersionMetadataHeadCandidate,
): boolean {
  return (
    optionalStringMatches(candidate.head.refName, VERSION_GRAPH_MAIN_REF) &&
    optionalStringMatches(candidate.head.resolvedFrom, VERSION_GRAPH_HEAD_REF)
  );
}

export function metadataHeadCandidateTrustedBaseMismatchReason(
  candidate: XlsxVersionMetadataHeadCandidate,
  baseCommit: WorkbookCommit,
): XlsxVersionMetadataTrustDowngradeReason | null {
  if (candidate.head.commitId !== baseCommit.id) return 'head-unverified';
  if (
    !isObjectDigest(candidate.head.semanticChangeSetDigest) ||
    !isObjectDigest(candidate.head.snapshotRootDigest)
  ) {
    return 'missing-object-digests';
  }
  if (
    !objectDigestMatches(
      candidate.head.semanticChangeSetDigest,
      baseCommit.payload.semanticChangeSetDigest,
    )
  ) {
    return 'object-digest-mismatch';
  }
  if (
    !objectDigestMatches(candidate.head.snapshotRootDigest, baseCommit.payload.snapshotRootDigest)
  ) {
    return 'snapshot-root-mismatch';
  }
  return null;
}

function objectDigestMatches(left: ObjectDigest, right: ObjectDigest): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function optionalStringMatches(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}
