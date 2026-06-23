import {
  objectDigestFromWorkbookCommitId,
  type VersionDependencyRef,
  type VersionObjectType,
} from '../object-digest';
import { cloneDigest } from './utils';
import type {
  CreateWorkbookCommitInput,
  WorkbookCommitPayload,
  WorkbookCommitStoreDiagnostic,
} from './types';
import type { VersionObjectRecord } from '../object-store';
import { diagnostic } from './payload-diagnostics';
import { isVersionObjectRecord } from './payload-guards';

export type CommitDependencyRecords = {
  readonly snapshotRootRecord: VersionObjectRecord<unknown>;
  readonly semanticChangeSetRecord: VersionObjectRecord<unknown>;
  readonly mutationSegmentRecords: readonly VersionObjectRecord<unknown>[];
  readonly redactionSummaryRecord?: VersionObjectRecord<unknown>;
  readonly verificationSummaryRecord?: VersionObjectRecord<unknown>;
  readonly diagnostics: readonly WorkbookCommitStoreDiagnostic[];
};

export function collectDependencyRecords(
  input: CreateWorkbookCommitInput,
): CommitDependencyRecords {
  const diagnostics: WorkbookCommitStoreDiagnostic[] = [];
  const snapshotRootRecord = validateDependencyRecord(
    input.snapshotRootRecord,
    'workbook.snapshotRoot.v1',
    'snapshotRootRecord',
    diagnostics,
  );
  const semanticChangeSetRecord = validateDependencyRecord(
    input.semanticChangeSetRecord,
    'workbook.semanticChangeSet.v1',
    'semanticChangeSetRecord',
    diagnostics,
  );
  const mutationSegmentRecords = (input.mutationSegmentRecords ?? []).flatMap((record, index) => {
    const validated = validateDependencyRecord(
      record,
      'workbook.mutationSegment.v1',
      `mutationSegmentRecords[${index}]`,
      diagnostics,
    );
    return validated === undefined ? [] : [validated];
  });
  const redactionSummaryRecord =
    input.redactionSummaryRecord === undefined
      ? undefined
      : validateDependencyRecord(
          input.redactionSummaryRecord,
          'workbook.redactionSummary.v1',
          'redactionSummaryRecord',
          diagnostics,
        );
  const verificationSummaryRecord =
    input.verificationSummaryRecord === undefined
      ? undefined
      : validateDependencyRecord(
          input.verificationSummaryRecord,
          'workbook.verificationSummary.v1',
          'verificationSummaryRecord',
          diagnostics,
        );

  return {
    snapshotRootRecord: snapshotRootRecord as VersionObjectRecord<unknown>,
    semanticChangeSetRecord: semanticChangeSetRecord as VersionObjectRecord<unknown>,
    mutationSegmentRecords,
    ...(redactionSummaryRecord === undefined ? {} : { redactionSummaryRecord }),
    ...(verificationSummaryRecord === undefined ? {} : { verificationSummaryRecord }),
    diagnostics,
  };
}

export function dependenciesForPayload(
  payload: WorkbookCommitPayload,
): readonly VersionDependencyRef[] {
  return [
    ...payload.parentCommitIds.map(
      (commitId): VersionDependencyRef => ({
        kind: 'commit',
        commitId,
        digest: objectDigestFromWorkbookCommitId(commitId),
      }),
    ),
    {
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: cloneDigest(payload.semanticChangeSetDigest),
    },
    {
      kind: 'object',
      objectType: 'workbook.snapshotRoot.v1',
      digest: cloneDigest(payload.snapshotRootDigest),
    },
    ...(payload.mutationSegmentDigests ?? []).map(
      (digest): VersionDependencyRef => ({
        kind: 'object',
        objectType: 'workbook.mutationSegment.v1',
        digest: cloneDigest(digest),
      }),
    ),
    ...(payload.redactionSummaryDigest === undefined
      ? []
      : [
          {
            kind: 'object',
            objectType: 'workbook.redactionSummary.v1',
            digest: cloneDigest(payload.redactionSummaryDigest),
          } satisfies VersionDependencyRef,
        ]),
    ...(payload.verificationSummaryDigest === undefined
      ? []
      : [
          {
            kind: 'object',
            objectType: 'workbook.verificationSummary.v1',
            digest: cloneDigest(payload.verificationSummaryDigest),
          } satisfies VersionDependencyRef,
        ]),
    ...(payload.resolvedMergeAttemptDigest === undefined
      ? []
      : [
          {
            kind: 'object',
            objectType: 'workbook.resolvedMergeAttempt.v1',
            digest: cloneDigest(payload.resolvedMergeAttemptDigest),
          } satisfies VersionDependencyRef,
        ]),
  ];
}

function validateDependencyRecord(
  record: VersionObjectRecord<unknown> | undefined,
  expectedObjectType: VersionObjectType,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): VersionObjectRecord<unknown> | undefined {
  if (!isVersionObjectRecord(record)) {
    diagnostics.push(
      diagnostic('VERSION_MISSING_DEPENDENCY', 'Commit dependency object record is missing.', {
        details: { path, expectedObjectType },
      }),
    );
    return undefined;
  }
  if (record.preimage.objectType !== expectedObjectType) {
    diagnostics.push(
      diagnostic('VERSION_MISSING_DEPENDENCY', 'Commit dependency object record has wrong type.', {
        objectDigest: record.digest,
        details: {
          path,
          expectedObjectType,
          receivedObjectType: record.preimage.objectType,
        },
      }),
    );
    return undefined;
  }
  return record;
}
