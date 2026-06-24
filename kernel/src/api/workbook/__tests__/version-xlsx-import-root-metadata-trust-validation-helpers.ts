import type { MogWorkbookVersionXlsxMetadataExpectedHead } from '../version/xlsx-metadata/xlsx-version-metadata';

export function expectedMetadataTrustHead(
  input: Pick<MogWorkbookVersionXlsxMetadataExpectedHead, 'commitId'> &
    Partial<
      Pick<
        MogWorkbookVersionXlsxMetadataExpectedHead,
        'refRevision' | 'semanticChangeSetDigest' | 'snapshotRootDigest'
      >
    >,
): MogWorkbookVersionXlsxMetadataExpectedHead {
  return {
    commitId: input.commitId,
    refName: 'refs/heads/main',
    resolvedFrom: 'HEAD',
    ...(input.refRevision ? { refRevision: input.refRevision } : {}),
    ...(input.semanticChangeSetDigest
      ? { semanticChangeSetDigest: input.semanticChangeSetDigest }
      : {}),
    ...(input.snapshotRootDigest ? { snapshotRootDigest: input.snapshotRootDigest } : {}),
  };
}
