import type { VersionMainRefName } from '@mog-sdk/contracts/api';

export const VERSION_HEAD_REF = 'HEAD';
export const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
export const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';

export const VERSION_COMMIT_OBJECT_KIND_BY_TYPE: Readonly<Record<string, string>> = {
  'workbook.snapshotRoot.v1': 'snapshot-root',
  'workbook.semanticChangeSet.v1': 'semantic-change-set',
  'workbook.mutationSegment.v1': 'mutation-segment',
  'workbook.redactionSummary.v1': 'redaction-summary',
  'workbook.verificationSummary.v1': 'verification-summary',
  'workbook.authorizationSnapshot.v1': 'authorization-snapshot',
};

export const VERSION_COMMIT_SAFE_MESSAGES: Readonly<Record<string, string>> = {
  VERSION_GRAPH_UNINITIALIZED: 'The workbook version graph is not initialized for this document.',
  VERSION_INVALID_OPTIONS: 'The version commit options are invalid for this method.',
  VERSION_PERMISSION_DENIED:
    'The requested version commit option is not authorized in this public slice.',
  VERSION_REF_WRITE_UNAVAILABLE:
    'Public version commits cannot target or mutate arbitrary refs in this slice.',
  VERSION_STORE_READ_ONLY: 'The attached version store is read-only for this document.',
  VERSION_REF_CONFLICT: 'The version ref changed while the commit was in progress.',
  VERSION_MISSING_CHANGE_SET: 'The version commit has no eligible captured change set.',
  VERSION_MISSING_SNAPSHOT_ROOT: 'The version commit is missing its materializable snapshot root.',
  VERSION_MISSING_MUTATION_SEGMENT: 'The version commit is missing a captured mutation segment.',
  VERSION_DIGEST_MISMATCH: 'A version commit object digest does not match its canonical bytes.',
  VERSION_WRONG_OBJECT_KIND: 'A version commit dependency has the wrong object kind.',
  VERSION_UNSUPPORTED_SCHEMA: 'A version commit dependency uses an unsupported schema.',
  VERSION_REDACTION_VIOLATION:
    'The version commit could not prove required redaction before storage.',
  VERSION_ANNOTATION_WRITE_FAILED: 'The version commit annotation could not be written durably.',
  VERSION_UNMATERIALIZABLE_COMMIT:
    'The version commit is not materializable by the attached service.',
  VERSION_INVALID_COMMIT_PAYLOAD:
    'The version write service returned an invalid public commit payload.',
};

export const VERSION_COMMIT_REPAIR_ISSUES: ReadonlySet<string> = new Set([
  'VERSION_DANGLING_REF',
  'VERSION_MISSING_OBJECT',
  'VERSION_MISSING_SNAPSHOT_ROOT',
  'VERSION_MISSING_CHANGE_SET',
  'VERSION_MISSING_MUTATION_SEGMENT',
  'VERSION_DIGEST_MISMATCH',
  'VERSION_WRONG_OBJECT_KIND',
  'VERSION_OBJECT_STORE_FAILURE',
  'VERSION_INVALID_COMMIT_PAYLOAD',
  'VERSION_UNMATERIALIZABLE_COMMIT',
]);

export const VERSION_COMMIT_UNSUPPORTED_ISSUES: ReadonlySet<string> = new Set([
  'VERSION_GRAPH_UNINITIALIZED',
  'VERSION_PERMISSION_DENIED',
  'VERSION_REF_WRITE_UNAVAILABLE',
  'VERSION_STORE_READ_ONLY',
]);
