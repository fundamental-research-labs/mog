import type {
  VersionCreateReviewInput,
  WorkbookCommitId,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
  WorkbookVersionReviewSubject,
} from '@mog-sdk/contracts/api';

import type { VersionDocumentScope } from './registry';
import { canonicalJsonStringify, cloneJson, cloneRecord } from './review-service-codec';

export function createReviewRecord(input: {
  readonly documentScope: VersionDocumentScope;
  readonly reviewId: string;
  readonly input: VersionCreateReviewInput;
  readonly createdAt: string;
}): WorkbookVersionReviewRecord {
  const subject = cloneJson(input.input.subject);
  const baseCommitId = input.input.baseCommitId ?? subjectBaseCommitId(subject);
  const headCommitId = input.input.headCommitId ?? subjectHeadCommitId(subject);
  const proposalId = subject.kind === 'proposal' ? subject.proposalId : undefined;
  return cloneRecord({
    schemaVersion: 1,
    id: input.reviewId,
    documentId: input.documentScope.documentId,
    subject,
    status: 'open',
    ...(input.input.title === undefined ? {} : { title: input.input.title }),
    ...(baseCommitId === undefined ? {} : { baseCommitId }),
    ...(headCommitId === undefined ? {} : { headCommitId }),
    ...(proposalId === undefined ? {} : { proposalId }),
    revision: 1,
    createdBy: cloneJson(input.input.createdBy),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    decisions: [],
    redaction: {
      policy: cloneJson(input.input.redactionPolicy),
      redactedFields: [],
      diagnostics: [],
    },
    diagnostics: [],
  });
}

export function reviewSubjectsEqual(
  left: WorkbookVersionReviewSubject,
  right: WorkbookVersionReviewSubject,
): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

export function reviewSummary(
  record: WorkbookVersionReviewRecord,
): WorkbookVersionReviewRecordSummary {
  return {
    id: record.id,
    documentId: record.documentId,
    subject: cloneJson(record.subject),
    status: record.status,
    ...(record.title === undefined ? {} : { title: record.title }),
    ...(record.baseCommitId === undefined ? {} : { baseCommitId: record.baseCommitId }),
    ...(record.headCommitId === undefined ? {} : { headCommitId: record.headCommitId }),
    ...(record.proposalId === undefined ? {} : { proposalId: record.proposalId }),
    revision: record.revision,
    createdBy: cloneJson(record.createdBy),
    updatedAt: record.updatedAt,
  };
}

function subjectBaseCommitId(subject: WorkbookVersionReviewSubject): WorkbookCommitId | undefined {
  return 'baseCommitId' in subject ? subject.baseCommitId : undefined;
}

function subjectHeadCommitId(subject: WorkbookVersionReviewSubject): WorkbookCommitId | undefined {
  if ('headCommitId' in subject) return subject.headCommitId;
  if (subject.kind === 'commit') return subject.commitId;
  return undefined;
}
