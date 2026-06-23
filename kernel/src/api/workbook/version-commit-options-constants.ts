export const VERSION_COMMIT_OPTION_KEYS = new Set([
  'message',
  'targetRef',
  'redactionPolicy',
  'expectedHead',
  'mode',
]);

export const VERSION_COMMIT_EXPECTED_HEAD_KEYS = new Set([
  'commitId',
  'revision',
  'symbolicHeadRevision',
]);

export const VERSION_COMMIT_MODE_KEYS = new Set(['kind']);

export const REDACTION_POLICY_KEYS = new Set([
  'mode',
  'redactSecrets',
  'redactExternalLinks',
  'redactAgentTrace',
]);

export const REDACTION_POLICY_MODES = new Set(['default', 'strict', 'clean']);

export const REF_MUTATION_FIELDS = new Set(['ref', 'branch']);

export const AUTHOR_SPOOFING_FIELDS = new Set([
  'author',
  'committer',
  'principal',
  'principalScope',
  'updatedBy',
]);

export const PARENT_OVERRIDE_FIELDS = new Set([
  'parents',
  'parentCommitIds',
  'parentIds',
  'baseCommitId',
]);

export const DIRECT_SEGMENT_FIELDS = new Set([
  'segmentIds',
  'segments',
  'mutationSegments',
  'changeSet',
  'semanticChangeSet',
  'semanticChanges',
  'operations',
  'captureFrontier',
  'frontier',
]);

export const ROOT_IMPORT_PROVENANCE_FIELDS = new Set([
  'expectedRegistryRevision',
  'root',
  'rootEvidence',
  'importRootEvidence',
  'provenance',
  'trustRoots',
]);

export const ANNOTATION_BINDING_FIELDS = new Set([
  'annotation',
  'annotationDigest',
  'annotationRecord',
  'annotationRevision',
  'tags',
  'title',
]);

export const OBJECT_BINDING_FIELDS = new Set([
  'authorizationSnapshot',
  'authorizationSnapshotDigest',
  'commitId',
  'commitRecord',
  'objectRecords',
  'redactionPolicyDigest',
  'redactionSummary',
  'redactionSummaryDigest',
  'semanticChangeSetDigest',
  'snapshotRoot',
  'snapshotRootDigest',
  'snapshotRootRecord',
  'verificationSummary',
  'verificationSummaryDigest',
]);
