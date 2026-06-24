import type {
  CheckoutVersionResult,
  ObjectDigest,
  RedactedVersionAuthor,
  VersionCheckoutResult,
  VersionCommitPage,
  VersionCounterRecordRevision,
  VersionDiffEntry,
  VersionDiffResourceLimitSummary,
  VersionDiagnostic,
  VersionError,
  VersionMainRefName,
  VersionMergeChange,
  VersionMergeConflict,
  VersionMergeResult,
  VersionMergeResultId,
  VersionResult,
  VersionSemanticDiffPage,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookCommitSummary,
  WorkbookDiffPage,
} from '@mog-sdk/contracts/api';

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const baseCommitId = 'commit:sha256:version-result-status-base' as WorkbookCommitId;
const oursCommitId = 'commit:sha256:version-result-status-ours' as WorkbookCommitId;
const theirsCommitId = 'commit:sha256:version-result-status-theirs' as WorkbookCommitId;
const mainRefName: VersionMainRefName = 'refs/heads/main';
const mergeResultId = 'merge-result:version-result-status' as VersionMergeResultId;

const revision = {
  kind: 'counter',
  value: '18',
} satisfies VersionCounterRecordRevision;

const digest = {
  algorithm: 'sha256',
  digest: 'version-result-status-digest',
  byteLength: 256,
} satisfies ObjectDigest;

const author = {
  actorKind: 'agent',
  displayName: 'Version result status fixture author',
  redacted: false,
} satisfies RedactedVersionAuthor;

const storeDiagnostic = {
  issueCode: 'VERSION_PROVIDER_ERROR',
  severity: 'error',
  recoverability: 'retry',
  messageTemplateId: 'version.resultStatus.providerError',
  safeMessage: 'Version result status fixture provider error.',
  payload: { operation: 'diff' },
  redacted: false,
  mutationGuarantee: 'no-write-attempted',
} satisfies VersionStoreDiagnostic;

const publicDiagnostic = {
  code: 'version.surfaceStatus.diffUnavailable',
  severity: 'warning',
  message: 'Version result status fixture public diagnostic.',
  dependency: 'VC-04',
  data: { operation: 'diff', retryable: false },
} satisfies VersionDiagnostic;

const resultError = {
  code: 'target_unavailable',
  target: 'version.diff',
  diagnostics: [publicDiagnostic],
} satisfies Extract<VersionError, { readonly code: 'target_unavailable' }>;

const commitSummary = {
  id: oursCommitId,
  parents: [baseCommitId],
  createdAt: '2026-06-24T00:00:00.000Z',
  author,
  annotation: { title: { kind: 'text', value: 'Result status fixture' } },
  diagnostics: [storeDiagnostic],
} satisfies WorkbookCommitSummary;

const commitPageFixtures = [
  {
    status: 'success',
    items: [commitSummary],
    readRevision: revision,
    order: 'topological-newest',
    diagnostics: [],
  },
  {
    status: 'degraded',
    items: [],
    readRevision: revision,
    order: 'topological-newest',
    diagnostics: [storeDiagnostic],
  },
] as const satisfies readonly VersionCommitPage[];

const checkoutPlan = {
  strategy: 'fullSnapshot',
  target: {
    kind: 'head',
    refName: mainRefName,
    commitId: oursCommitId,
    refRevision: revision,
  },
  commitId: oursCommitId,
  parentCommitIds: [baseCommitId],
  requiredDependencies: [
    { role: 'snapshotRoot', objectType: 'version.snapshotRoot' },
    { role: 'semanticChangeSet', objectType: 'version.semanticChangeSet', index: 0 },
  ],
  requiredDependencyCount: 2,
} satisfies CheckoutVersionResult['plan'];

const checkoutResultFixtures = [
  {
    status: 'success',
    materialization: 'planned',
    plan: checkoutPlan,
    diagnostics: [],
    mutationGuarantee: 'no-workbook-mutation',
  },
  {
    status: 'success',
    materialization: 'applied',
    plan: checkoutPlan,
    diagnostics: [],
    mutationGuarantee: 'workbook-state-materialized',
  },
  {
    status: 'degraded',
    materialization: 'not-applied',
    plan: null,
    diagnostics: [storeDiagnostic],
    mutationGuarantee: 'unknown-after-partial-mutation',
  },
] as const satisfies readonly VersionCheckoutResult[];

const diffEntry = {
  structural: {
    kind: 'metadata',
    changeId: 'change:version-result-status',
    domain: 'cells.values',
    entityId: 'sheet:fixture!A1',
    propertyPath: ['value'],
  },
  before: { kind: 'value', value: null },
  after: { kind: 'value', value: 42 },
  display: { address: { kind: 'value', value: 'Fixture!A1' } },
  diagnostics: [storeDiagnostic],
} satisfies VersionDiffEntry;

const diffResourceLimitSummaryFixtures = [
  {
    status: 'within-budget',
    limits: [{ kind: 'pageLimit', limit: 50, unit: 'changes', observed: 1 }],
  },
  {
    status: 'truncated',
    limits: [{ kind: 'responseBytes', limit: 4096, unit: 'bytes', observed: 8192 }],
    omittedValueCount: 1,
  },
  {
    status: 'exceeded',
    limits: [{ kind: 'diffCacheEntriesPerDocument', limit: 32, unit: 'entries', observed: 33 }],
    exactTotalCountUnavailable: true,
  },
] as const satisfies readonly VersionDiffResourceLimitSummary[];

const diffStatusPageFixtures = [
  {
    status: 'success',
    items: [diffEntry],
    readRevision: revision,
    order: 'semantic-change-order',
    diagnostics: [],
    resourceLimits: diffResourceLimitSummaryFixtures[0],
  },
  {
    status: 'degraded',
    items: [],
    readRevision: revision,
    order: 'semantic-change-order',
    diagnostics: [storeDiagnostic],
    resourceLimits: diffResourceLimitSummaryFixtures[1],
  },
] as const satisfies readonly WorkbookDiffPage[];

const semanticDiffPageFixtures = [
  {
    items: [diffEntry],
    limit: 50,
    totalEstimate: 1,
    readRevision: revision,
    order: 'semantic-change-order',
    resourceLimits: diffResourceLimitSummaryFixtures[0],
  },
  {
    items: [],
    limit: 50,
    readRevision: revision,
    order: 'semantic-change-order',
    resourceLimits: diffResourceLimitSummaryFixtures[2],
  },
] as const satisfies readonly VersionSemanticDiffPage[];

const mergeChange = {
  structural: diffEntry.structural,
  base: diffEntry.before,
  ours: diffEntry.before,
  theirs: diffEntry.after,
  merged: diffEntry.after,
  display: diffEntry.display,
  diagnostics: [],
} satisfies VersionMergeChange;

const mergeConflict = {
  conflictId: 'conflict:version-result-status',
  conflictDigest: 'conflict-digest:version-result-status',
  conflictKind: 'same-property',
  structural: mergeChange.structural,
  base: mergeChange.base,
  ours: mergeChange.ours,
  theirs: mergeChange.theirs,
  resolutionOptions: [
    {
      optionId: 'resolution:accept-ours',
      conflictId: 'conflict:version-result-status',
      kind: 'acceptOurs',
      value: mergeChange.ours,
      recalcRequired: false,
    },
  ],
  display: mergeChange.display,
  diagnostics: [],
} satisfies VersionMergeConflict;

const mergeResultFixtures = [
  {
    status: 'clean',
    base: baseCommitId,
    ours: oursCommitId,
    theirs: theirsCommitId,
    changes: [mergeChange],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
    resultId: mergeResultId,
    resultDigest: digest,
    attemptPersistence: 'persisted',
    attemptKind: 'applyable',
  },
  {
    status: 'conflicted',
    base: baseCommitId,
    ours: oursCommitId,
    theirs: theirsCommitId,
    changes: [mergeChange],
    conflicts: [mergeConflict],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
    resultId: mergeResultId,
    resultDigest: digest,
    attemptPersistence: 'persisted',
    attemptKind: 'reviewOnly',
  },
  {
    status: 'fastForward',
    base: baseCommitId,
    ours: oursCommitId,
    theirs: theirsCommitId,
    changes: [],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  },
  {
    status: 'alreadyMerged',
    base: baseCommitId,
    ours: oursCommitId,
    theirs: theirsCommitId,
    changes: [],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  },
  {
    status: 'blocked',
    base: null,
    ours: null,
    theirs: null,
    changes: [],
    conflicts: [],
    diagnostics: [storeDiagnostic],
    mutationGuarantee: 'preview-only',
  },
] as const satisfies readonly VersionMergeResult[];

const commitResultFixtures = [
  { ok: true, value: commitSummary },
  { ok: false, error: resultError },
] as const satisfies readonly VersionResult<WorkbookCommitSummary>[];

const checkoutResultEnvelopeFixtures = [
  { ok: true, value: checkoutResultFixtures[0] },
  { ok: false, error: resultError },
] as const satisfies readonly VersionResult<CheckoutVersionResult>[];

const mergeResultEnvelopeFixtures = [
  { ok: true, value: mergeResultFixtures[0] },
  { ok: false, error: resultError },
] as const satisfies readonly VersionResult<VersionMergeResult>[];

const diffResultEnvelopeFixtures = [
  { ok: true, value: semanticDiffPageFixtures[0] },
  { ok: false, error: resultError },
] as const satisfies readonly VersionResult<VersionSemanticDiffPage>[];

type _ContractsVersionCommitPageFixturesCoverStatuses = Assert<
  IsEqual<(typeof commitPageFixtures)[number]['status'], VersionCommitPage['status']>
>;
type _ContractsVersionCommitResultFixturesCoverEnvelopeStates = Assert<
  IsEqual<(typeof commitResultFixtures)[number]['ok'], VersionResult<WorkbookCommitSummary>['ok']>
>;
type _ContractsVersionCheckoutFixturesCoverStatuses = Assert<
  IsEqual<(typeof checkoutResultFixtures)[number]['status'], VersionCheckoutResult['status']>
>;
type _ContractsVersionCheckoutFixturesCoverMaterializationStates = Assert<
  IsEqual<
    (typeof checkoutResultFixtures)[number]['materialization'],
    VersionCheckoutResult['materialization']
  >
>;
type _ContractsVersionCheckoutResultFixturesCoverEnvelopeStates = Assert<
  IsEqual<
    (typeof checkoutResultEnvelopeFixtures)[number]['ok'],
    VersionResult<CheckoutVersionResult>['ok']
  >
>;
type _ContractsVersionMergeResultFixturesCoverStatuses = Assert<
  IsEqual<(typeof mergeResultFixtures)[number]['status'], VersionMergeResult['status']>
>;
type _ContractsVersionMergeResultFixturesCoverEnvelopeStates = Assert<
  IsEqual<
    (typeof mergeResultEnvelopeFixtures)[number]['ok'],
    VersionResult<VersionMergeResult>['ok']
  >
>;
type _ContractsVersionDiffStatusPageFixturesCoverStatuses = Assert<
  IsEqual<(typeof diffStatusPageFixtures)[number]['status'], WorkbookDiffPage['status']>
>;
type _ContractsVersionDiffResourceLimitFixturesCoverStatuses = Assert<
  IsEqual<
    (typeof diffResourceLimitSummaryFixtures)[number]['status'],
    VersionDiffResourceLimitSummary['status']
  >
>;
type _ContractsVersionDiffResultFixturesCoverEnvelopeStates = Assert<
  IsEqual<
    (typeof diffResultEnvelopeFixtures)[number]['ok'],
    VersionResult<VersionSemanticDiffPage>['ok']
  >
>;
