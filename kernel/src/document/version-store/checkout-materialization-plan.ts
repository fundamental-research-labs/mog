import type { WorkbookCommit } from './commit-store';
import type { ObjectDigest, VersionDependencyRef } from './object-digest';
import type {
  CheckoutMaterializationDependency,
  CheckoutMaterializationPlan,
  CheckoutResolvedMaterializationTarget,
} from './checkout-service';

export function createMaterializationPlan(
  commit: WorkbookCommit,
  resolvedTarget: CheckoutResolvedMaterializationTarget,
): CheckoutMaterializationPlan {
  const dependencies = materializationDependencies(commit);
  return Object.freeze({
    strategy: 'fullSnapshot',
    resolvedTarget,
    commitId: commit.id,
    parentCommitIds: Object.freeze([...commit.payload.parentCommitIds]),
    snapshotRootDigest: cloneDigest(commit.payload.snapshotRootDigest),
    semanticChangeSetDigest: cloneDigest(commit.payload.semanticChangeSetDigest),
    mutationSegmentDigests: Object.freeze(
      (commit.payload.mutationSegmentDigests ?? []).map(cloneDigest),
    ),
    requiredDependencies: Object.freeze(dependencies),
    requiredDependencyDigests: Object.freeze(
      dependencies.map((entry) => cloneDigest(entry.digest)),
    ),
  });
}

export function materializationDependencies(
  commit: WorkbookCommit,
): readonly CheckoutMaterializationDependency[] {
  return Object.freeze([
    freezeMaterializationDependency({
      role: 'snapshotRoot',
      objectType: 'workbook.snapshotRoot.v1',
      digest: commit.payload.snapshotRootDigest,
    }),
    freezeMaterializationDependency({
      role: 'semanticChangeSet',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: commit.payload.semanticChangeSetDigest,
    }),
    ...(commit.payload.mutationSegmentDigests ?? []).map((digest, index) =>
      freezeMaterializationDependency({
        role: 'mutationSegment',
        objectType: 'workbook.mutationSegment.v1',
        digest,
        index,
      }),
    ),
    ...(commit.payload.redactionSummaryDigest === undefined
      ? []
      : [
          freezeMaterializationDependency({
            role: 'redactionSummary',
            objectType: 'workbook.redactionSummary.v1',
            digest: commit.payload.redactionSummaryDigest,
          }),
        ]),
    ...(commit.payload.verificationSummaryDigest === undefined
      ? []
      : [
          freezeMaterializationDependency({
            role: 'verificationSummary',
            objectType: 'workbook.verificationSummary.v1',
            digest: commit.payload.verificationSummaryDigest,
          }),
        ]),
  ]);
}

export function dependencyRefForPlan(
  dependency: CheckoutMaterializationDependency,
): VersionDependencyRef {
  return Object.freeze({
    kind: 'object',
    objectType: dependency.objectType,
    digest: cloneDigest(dependency.digest),
  });
}

function freezeMaterializationDependency(
  dependency: CheckoutMaterializationDependency,
): CheckoutMaterializationDependency {
  return Object.freeze({
    ...dependency,
    digest: cloneDigest(dependency.digest),
  });
}

function cloneDigest(digest: ObjectDigest): ObjectDigest {
  return Object.freeze({ algorithm: digest.algorithm, digest: digest.digest });
}
