import type {
  AgentProposal,
  AgentProposalAcceptResult,
  AgentProposalSummary,
  AgentProposalWorkspaceHandle,
  CheckoutVersionResult,
  GetVersionHeadInput,
  ListVersionCommitsInput,
  ListVersionRefsInput,
  ObjectDigest,
  Paged,
  RedactedVersionAuthor,
  VersionApplyMergeInput,
  VersionApplyMergeOptions,
  VersionApplyMergeResolution,
  VersionApplyMergeResult,
  VersionBranchName,
  VersionBranchRefReadResult,
  VersionCheckoutOptions,
  VersionCheckoutTarget,
  VersionCommitExpectedHead,
  VersionCommitish,
  VersionCommitOptions,
  VersionCounterRecordRevision,
  VersionCreateBranchOptions,
  VersionDeleteRefOptions,
  VersionDiagnostic,
  VersionDiagnosticCode,
  VersionDiagnosticPublicPayload,
  VersionDiffOptions,
  VersionError,
  VersionFastForwardBranchOptions,
  VersionGetMergeConflictDetailRequest,
  VersionHead,
  VersionListReviewsInput,
  VersionMainRefName,
  VersionMergeConflictDetailResult,
  VersionMergeEndpointDeniedStatus,
  VersionMergeChange,
  VersionMergeConflict,
  VersionMergeInput,
  VersionMergeOptions,
  VersionMergeResult,
  VersionMergeResultId,
  VersionPromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult,
  VersionProposalApi,
  VersionPutMergeResolutionPayloadRequest,
  VersionPutMergeResolutionPayloadResult,
  VersionRef,
  VersionRefMutationResult,
  VersionRefName,
  VersionRefReadResult,
  VersionRefSelector,
  VersionResult,
  VersionRevertInput,
  VersionRevertOptions,
  VersionRevertResult,
  VersionSaveMergeResolutionsRequest,
  VersionSaveMergeResolutionsResult,
  VersionSemanticDiffPage,
  VersionStoreDiagnostic,
  VersionSurfaceStatus,
  VersionSymbolicRefReadResult,
  VersionUpdateBranchOptions,
  WorkbookCommitId,
  WorkbookCommitRef,
  WorkbookCommitSummary,
  WorkbookVersion,
  WorkbookVersionDiagnostic,
  WorkbookVersionReviewApi,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
  WorkbookVersionStatus,
} from '@mog/types-api/api/workbook';

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAssignable<A, B> = [A] extends [B] ? true : false;
type IsMutuallyAssignable<A, B> = IsAssignable<A, B> extends true ? IsAssignable<B, A> : false;
type KeysOfUnion<T> = T extends unknown ? keyof T : never;
type MethodReturn<T> = T extends (...args: any[]) => infer R ? R : never;
type UnwrapVersionResult<T> = T extends VersionResult<infer Value> ? Value : never;

type ExpectedWorkbookVersionMethodName =
  | 'getStatus'
  | 'getSurfaceStatus'
  | 'getHead'
  | 'listCommits'
  | 'commit'
  | 'promotePendingRemote'
  | 'checkout'
  | 'merge'
  | 'applyMerge'
  | 'revert'
  | 'saveMergeResolutions'
  | 'getMergeConflictDetail'
  | 'putMergeResolutionPayload'
  | 'listReviews'
  | 'getReview'
  | 'createReview'
  | 'appendReviewDecision'
  | 'updateReviewStatus'
  | 'getReviewDiff'
  | 'createProposal'
  | 'startProposalWorkspace'
  | 'getProposalWorkspace'
  | 'disposeProposalWorkspace'
  | 'commitProposalWorkspace'
  | 'failProposal'
  | 'getProposal'
  | 'listProposals'
  | 'markProposalVerified'
  | 'openProposalReview'
  | 'acceptProposal'
  | 'rejectProposal'
  | 'supersedeProposal'
  | 'diff'
  | 'readRef'
  | 'getRef'
  | 'listRefs'
  | 'createBranch'
  | 'fastForwardBranch'
  | 'updateBranch'
  | 'deleteBranch'
  | 'deleteRef';

interface ExpectedWorkbookVersionCoreMethods {
  getStatus(): Promise<WorkbookVersionStatus>;
  getSurfaceStatus(): Promise<VersionSurfaceStatus>;
  getHead(): Promise<VersionResult<VersionHead>>;
  getHead(options: GetVersionHeadInput): Promise<VersionResult<VersionHead>>;
  listCommits(
    options?: ListVersionCommitsInput,
  ): Promise<VersionResult<Paged<WorkbookCommitSummary>>>;
  commit(options?: VersionCommitOptions): Promise<VersionResult<WorkbookCommitSummary>>;
  promotePendingRemote(
    options?: VersionPromotePendingRemoteOptions,
  ): Promise<VersionResult<VersionPromotePendingRemoteResult>>;
  checkout(
    target: VersionCheckoutTarget,
    options?: VersionCheckoutOptions,
  ): Promise<VersionResult<CheckoutVersionResult>>;
  merge(
    input: VersionMergeInput,
    options?: VersionMergeOptions,
  ): Promise<VersionResult<VersionMergeResult>>;
  applyMerge(
    input: VersionApplyMergeInput,
    options?: VersionApplyMergeOptions,
  ): Promise<VersionResult<VersionApplyMergeResult>>;
  revert(
    input: VersionRevertInput,
    options?: VersionRevertOptions,
  ): Promise<VersionResult<VersionRevertResult>>;
  saveMergeResolutions(
    input: VersionSaveMergeResolutionsRequest,
  ): Promise<VersionResult<VersionSaveMergeResolutionsResult>>;
  getMergeConflictDetail(
    input: VersionGetMergeConflictDetailRequest,
  ): Promise<VersionResult<VersionMergeConflictDetailResult>>;
  putMergeResolutionPayload(
    input: VersionPutMergeResolutionPayloadRequest,
  ): Promise<VersionResult<VersionPutMergeResolutionPayloadResult>>;
  diff(
    base: VersionCommitish,
    target: VersionCommitish,
    options?: VersionDiffOptions,
  ): Promise<VersionResult<VersionSemanticDiffPage>>;
  readRef(name: 'HEAD'): Promise<VersionResult<VersionSymbolicRefReadResult>>;
  readRef(
    name: VersionMainRefName | VersionRefName | VersionBranchName,
  ): Promise<VersionResult<VersionBranchRefReadResult>>;
  readRef(
    name: VersionRefSelector | VersionBranchName,
  ): Promise<VersionResult<VersionRefReadResult>>;
  getRef(name: 'HEAD'): Promise<VersionResult<VersionSymbolicRefReadResult>>;
  getRef(
    name: VersionMainRefName | VersionRefName | VersionBranchName,
  ): Promise<VersionResult<VersionBranchRefReadResult>>;
  getRef(
    name: VersionRefSelector | VersionBranchName,
  ): Promise<VersionResult<VersionRefReadResult>>;
  listRefs(options?: ListVersionRefsInput): Promise<VersionResult<Paged<VersionRef>>>;
  createBranch(options: VersionCreateBranchOptions): Promise<VersionResult<VersionRef>>;
  fastForwardBranch(options: VersionFastForwardBranchOptions): Promise<VersionResult<VersionRef>>;
  updateBranch(options: VersionUpdateBranchOptions): Promise<VersionResult<VersionRef>>;
  deleteBranch(options: VersionDeleteRefOptions): Promise<VersionResult<VersionRef>>;
  deleteRef(options: VersionDeleteRefOptions): Promise<VersionResult<VersionRef>>;
}

type ExpectedWorkbookVersionResultByMethod = {
  readonly getHead: VersionResult<VersionHead>;
  readonly listCommits: VersionResult<Paged<WorkbookCommitSummary>>;
  readonly commit: VersionResult<WorkbookCommitSummary>;
  readonly promotePendingRemote: VersionResult<VersionPromotePendingRemoteResult>;
  readonly checkout: VersionResult<CheckoutVersionResult>;
  readonly merge: VersionResult<VersionMergeResult>;
  readonly applyMerge: VersionResult<VersionApplyMergeResult>;
  readonly revert: VersionResult<VersionRevertResult>;
  readonly saveMergeResolutions: VersionResult<VersionSaveMergeResolutionsResult>;
  readonly getMergeConflictDetail: VersionResult<VersionMergeConflictDetailResult>;
  readonly putMergeResolutionPayload: VersionResult<VersionPutMergeResolutionPayloadResult>;
  readonly listReviews: VersionResult<Paged<WorkbookVersionReviewRecordSummary>>;
  readonly getReview: VersionResult<WorkbookVersionReviewRecord>;
  readonly createReview: VersionResult<WorkbookVersionReviewRecord>;
  readonly appendReviewDecision: VersionResult<WorkbookVersionReviewRecord>;
  readonly updateReviewStatus: VersionResult<WorkbookVersionReviewRecord>;
  readonly getReviewDiff: VersionResult<WorkbookVersionReviewDiffPage>;
  readonly createProposal: VersionResult<AgentProposal>;
  readonly startProposalWorkspace: VersionResult<AgentProposalWorkspaceHandle>;
  readonly getProposalWorkspace: VersionResult<AgentProposalWorkspaceHandle>;
  readonly disposeProposalWorkspace: VersionResult<{ readonly disposed: true }>;
  readonly commitProposalWorkspace: VersionResult<AgentProposal>;
  readonly failProposal: VersionResult<AgentProposal>;
  readonly getProposal: VersionResult<AgentProposal>;
  readonly listProposals: VersionResult<Paged<AgentProposalSummary>>;
  readonly markProposalVerified: VersionResult<AgentProposal>;
  readonly openProposalReview: VersionResult<WorkbookVersionReviewRecord>;
  readonly acceptProposal: VersionResult<AgentProposalAcceptResult>;
  readonly rejectProposal: VersionResult<AgentProposal>;
  readonly supersedeProposal: VersionResult<AgentProposal>;
  readonly diff: VersionResult<VersionSemanticDiffPage>;
  readonly readRef: VersionResult<VersionRefReadResult>;
  readonly getRef: VersionResult<VersionRefReadResult>;
  readonly listRefs: VersionResult<Paged<VersionRef>>;
  readonly createBranch: VersionResult<VersionRef>;
  readonly fastForwardBranch: VersionResult<VersionRef>;
  readonly updateBranch: VersionResult<VersionRef>;
  readonly deleteBranch: VersionResult<VersionRef>;
  readonly deleteRef: VersionResult<VersionRef>;
};

type WorkbookVersionReturnByMethod = {
  readonly [Method in ExpectedWorkbookVersionMethodName]: Awaited<
    MethodReturn<WorkbookVersion[Method]>
  >;
};

type ExpectedWorkbookVersionReturnByMethod = ExpectedWorkbookVersionResultByMethod & {
  readonly getStatus: WorkbookVersionStatus;
  readonly getSurfaceStatus: VersionSurfaceStatus;
};

type VersionTargetUnavailableError = Extract<VersionError, { readonly code: 'target_unavailable' }>;

type PublicVersionPrivateDiagnosticFieldName =
  | 'principal'
  | 'principalId'
  | 'principalIds'
  | 'principalRef'
  | 'principalScope'
  | 'principalTag'
  | 'principalTags'
  | 'principal_tags'
  | 'rawPayload'
  | 'raw_payload'
  | 'rawPayloadBytes'
  | 'raw_payload_bytes'
  | 'payloadBytes'
  | 'payload_bytes'
  | 'providerPayload'
  | 'provider_payload'
  | 'rawWorkbookBytes'
  | 'raw_workbook_bytes'
  | 'workbookBytes'
  | 'workbook_bytes'
  | 'credential'
  | 'credentials'
  | 'accessToken'
  | 'access_token'
  | 'secret'
  | 'secrets';

type WorkbookVersionBasicContractFixtureSurface = {
  readonly commitOptions: readonly VersionCommitOptions[];
  readonly commitSummary: WorkbookCommitSummary;
  readonly branchCreateOptions: readonly VersionCreateBranchOptions[];
  readonly branchRef: VersionRef;
  readonly refReadResults: readonly VersionRefReadResult[];
  readonly refMutationResults: readonly VersionRefMutationResult[];
  readonly checkoutTargets: readonly VersionCheckoutTarget[];
  readonly checkoutOptions: VersionCheckoutOptions;
  readonly checkoutResults: readonly CheckoutVersionResult[];
  readonly mergeInput: VersionMergeInput;
  readonly mergeOptions: VersionMergeOptions;
  readonly mergeResults: readonly VersionMergeResult[];
  readonly applyMergeInputs: readonly VersionApplyMergeInput[];
  readonly applyMergeOptions: readonly VersionApplyMergeOptions[];
  readonly applyMergeResults: readonly VersionApplyMergeResult[];
  readonly revertResults: readonly VersionRevertResult[];
};

const versionBaseCommitId = 'commit:sha256:version-contract-base' as WorkbookCommitId;
const versionOursCommitId = 'commit:sha256:version-contract-ours' as WorkbookCommitId;
const versionTheirsCommitId = 'commit:sha256:version-contract-theirs' as WorkbookCommitId;
const versionMergeCommitId = 'commit:sha256:version-contract-merge' as WorkbookCommitId;
const versionRevertCommitId = 'commit:sha256:version-contract-revert' as WorkbookCommitId;
const versionMainRefName: VersionMainRefName = 'refs/heads/main';
const versionBranchName = 'budget' as VersionBranchName;
const versionBranchRefName = 'refs/heads/budget' as VersionRefName;
const versionMergeResultId = 'merge-result:version-contract-basic' as VersionMergeResultId;

const versionCounterRevision = {
  kind: 'counter',
  value: '7',
} satisfies VersionCounterRecordRevision;

const versionDigest = {
  algorithm: 'sha256',
  digest: 'version-contract-basic-digest',
  byteLength: 128,
} satisfies ObjectDigest;

const versionAuthorFixture = {
  actorKind: 'user',
  displayName: 'Version contract fixture author',
  redacted: false,
} satisfies RedactedVersionAuthor;

const versionStoreDiagnosticFixture = {
  issueCode: 'VERSION_MISSING_DEPENDENCY',
  severity: 'error',
  recoverability: 'retry',
  messageTemplateId: 'version.contract.fixture.missingDependency',
  safeMessage: 'Version contract fixture diagnostic.',
  payload: {
    dependency: 'objectStore',
  },
  redacted: false,
  mutationGuarantee: 'no-write-attempted',
} satisfies VersionStoreDiagnostic;

const versionRefConflictDiagnosticFixture = {
  issueCode: 'VERSION_REF_CONFLICT',
  severity: 'error',
  recoverability: 'retry',
  messageTemplateId: 'version.contract.fixture.refConflict',
  safeMessage: 'Version contract fixture stale target head.',
  payload: {
    targetRef: versionMainRefName,
  },
  redacted: false,
  mutationGuarantee: 'ref-not-mutated',
} satisfies VersionStoreDiagnostic;

const versionRevertConflictDiagnosticFixture = {
  issueCode: 'VERSION_REVERT_CONFLICT',
  severity: 'error',
  recoverability: 'retry',
  messageTemplateId: 'version.contract.fixture.revertConflict',
  safeMessage: 'Version contract fixture revert requires review.',
  payload: {
    operation: 'revert',
    targetKind: 'range',
    rangeConflictCount: 1,
  },
  redacted: true,
  mutationGuarantee: 'ref-not-mutated',
} satisfies VersionStoreDiagnostic;

const versionExpectedHeadFixture = {
  commitId: versionOursCommitId,
  revision: versionCounterRevision,
  symbolicHeadRevision: versionCounterRevision,
} satisfies VersionCommitExpectedHead;

const workbookCommitSummaryFixture = {
  id: versionOursCommitId,
  parents: [versionBaseCommitId],
  createdAt: '2026-06-23T00:00:00.000Z',
  author: versionAuthorFixture,
  annotation: {
    title: {
      kind: 'text',
      value: 'Budget scenario',
    },
    message: {
      kind: 'text',
      value: 'Capture budget scenario edits.',
    },
    tags: [
      {
        kind: 'text',
        value: 'scenario',
      },
    ],
  },
  diagnostics: [versionStoreDiagnosticFixture],
} satisfies WorkbookCommitSummary;

const workbookVersionCommitOptionFixtures = [
  {
    message: 'Capture budget scenario edits.',
    targetRef: versionBranchName,
    redactionPolicy: {
      mode: 'default',
      redactSecrets: true,
      redactExternalLinks: true,
      redactAgentTrace: true,
    },
    expectedHead: versionExpectedHeadFixture,
    mode: {
      kind: 'normal',
    },
  },
  {
    message: 'Create workbook root.',
    targetRef: versionMainRefName,
    mode: {
      kind: 'root',
    },
  },
  {
    message: 'Import external workbook root.',
    targetRef: versionBranchRefName,
    mode: {
      kind: 'import-root',
    },
  },
] satisfies readonly VersionCommitOptions[];

const workbookVersionBranchCreateFixtures = [
  {
    name: versionBranchName,
    targetCommitId: versionOursCommitId,
    baseCommitId: versionBaseCommitId,
    expectedAbsent: true,
  },
  {
    name: versionBranchRefName,
    targetCommitId: versionTheirsCommitId,
  },
] satisfies readonly VersionCreateBranchOptions[];

const workbookVersionBranchRefFixture = {
  name: versionBranchRefName,
  commitId: versionOursCommitId,
  revision: versionCounterRevision,
  updatedAt: '2026-06-23T00:01:00.000Z',
} satisfies VersionRef;

const workbookVersionSymbolicHeadRefFixture = {
  name: 'HEAD',
  target: versionMainRefName,
  revision: versionCounterRevision,
} satisfies NonNullable<VersionSymbolicRefReadResult['ref']>;

const workbookVersionRefReadResultFixtures = [
  {
    status: 'success',
    ref: workbookVersionSymbolicHeadRefFixture,
    diagnostics: [],
  },
  { status: 'success', ref: workbookVersionBranchRefFixture, diagnostics: [] },
  {
    status: 'degraded',
    ref: workbookVersionSymbolicHeadRefFixture,
    diagnostics: [versionStoreDiagnosticFixture],
  },
  { status: 'degraded', ref: null, diagnostics: [versionStoreDiagnosticFixture] },
] satisfies readonly VersionRefReadResult[];

const workbookVersionRefMutationResultFixtures = [
  { status: 'success', ref: workbookVersionBranchRefFixture, diagnostics: [] },
  { status: 'degraded', ref: null, diagnostics: [versionStoreDiagnosticFixture] },
] satisfies readonly VersionRefMutationResult[];

const workbookVersionCheckoutTargets = [
  {
    kind: 'head',
  },
  {
    kind: 'commit',
    id: versionOursCommitId,
  },
  {
    kind: 'ref',
    name: versionBranchName,
  },
  {
    kind: 'ref',
    name: versionMainRefName,
  },
] satisfies readonly VersionCheckoutTarget[];

const workbookVersionCheckoutOptionsFixture = {
  includeDiagnostics: true,
  requireClean: true,
} satisfies VersionCheckoutOptions;

const workbookVersionCheckoutPlanFixture = {
  strategy: 'fullSnapshot',
  target: {
    kind: 'ref',
    refName: versionBranchRefName,
    commitId: versionOursCommitId,
    refRevision: versionCounterRevision,
    refIncarnationId: 'ref-incarnation:version-contract-basic',
  },
  commitId: versionOursCommitId,
  parentCommitIds: [versionBaseCommitId],
  requiredDependencies: [
    {
      role: 'snapshotRoot',
      objectType: 'version.snapshotRoot',
    },
    {
      role: 'semanticChangeSet',
      objectType: 'version.semanticChangeSet',
      index: 0,
    },
  ],
  requiredDependencyCount: 2,
} satisfies CheckoutVersionResult['plan'];

const workbookVersionCheckoutResultFixtures = [
  {
    status: 'success',
    materialization: 'planned',
    plan: workbookVersionCheckoutPlanFixture,
    diagnostics: [],
    mutationGuarantee: 'no-workbook-mutation',
  },
  {
    status: 'success',
    materialization: 'applied',
    plan: workbookVersionCheckoutPlanFixture,
    diagnostics: [versionStoreDiagnosticFixture],
    mutationGuarantee: 'workbook-state-materialized',
  },
] satisfies readonly CheckoutVersionResult[];

const versionMergeInputFixture = {
  base: versionBaseCommitId,
  ours: versionOursCommitId,
  theirs: versionTheirsCommitId,
} satisfies VersionMergeInput;

const versionMergeOptionsFixture = {
  mode: 'preview',
  includeDiagnostics: true,
  targetRef: versionMainRefName,
  expectedTargetHead: versionExpectedHeadFixture,
  persistReviewRecord: true,
} satisfies VersionMergeOptions;

const versionMergeChangeFixture = {
  structural: {
    kind: 'metadata',
    changeId: 'change:version-contract-basic',
    domain: 'cells.values',
    entityId: 'sheet:fixture!A1',
    propertyPath: ['value'],
  },
  base: {
    kind: 'value',
    value: null,
  },
  ours: {
    kind: 'value',
    value: 10,
  },
  theirs: {
    kind: 'value',
    value: 20,
  },
  merged: {
    kind: 'value',
    value: 20,
  },
  display: {
    address: {
      kind: 'value',
      value: 'Fixture!A1',
    },
  },
  diagnostics: [],
} satisfies VersionMergeChange;

const versionMergeConflictFixture = {
  conflictId: 'conflict:version-contract-basic',
  conflictDigest: 'conflict-digest:version-contract-basic',
  conflictKind: 'same-property',
  structural: versionMergeChangeFixture.structural,
  base: versionMergeChangeFixture.base,
  ours: versionMergeChangeFixture.ours,
  theirs: versionMergeChangeFixture.theirs,
  resolutionOptions: [
    {
      optionId: 'resolution:accept-ours',
      conflictId: 'conflict:version-contract-basic',
      kind: 'acceptOurs',
      value: versionMergeChangeFixture.ours,
      recalcRequired: false,
      diagnostics: [],
    },
    {
      optionId: 'resolution:accept-theirs',
      conflictId: 'conflict:version-contract-basic',
      kind: 'acceptTheirs',
      value: versionMergeChangeFixture.theirs,
      recalcRequired: true,
    },
    {
      optionId: 'resolution:accept-base',
      conflictId: 'conflict:version-contract-basic',
      kind: 'acceptBase',
      value: versionMergeChangeFixture.base,
      recalcRequired: false,
    },
  ],
  display: versionMergeChangeFixture.display,
  diagnostics: [],
} satisfies VersionMergeConflict;

const workbookVersionMergeResultFixtures = [
  {
    status: 'clean',
    base: versionBaseCommitId,
    ours: versionOursCommitId,
    theirs: versionTheirsCommitId,
    changes: [versionMergeChangeFixture],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
    resultId: versionMergeResultId,
    previewArtifactDigest: versionDigest,
    resultDigest: versionDigest,
    attemptPersistence: 'persisted',
    attemptKind: 'applyable',
    expiresAt: '2026-06-23T00:10:00.000Z',
    targetRef: versionMainRefName,
    expectedTargetHead: versionExpectedHeadFixture,
    applicationPlanDigest: versionDigest,
    applyEligibilityDigest: versionDigest,
  },
  {
    status: 'conflicted',
    base: versionBaseCommitId,
    ours: versionOursCommitId,
    theirs: versionTheirsCommitId,
    changes: [versionMergeChangeFixture],
    conflicts: [versionMergeConflictFixture],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
    resultId: versionMergeResultId,
    attemptPersistence: 'persisted',
    attemptKind: 'reviewOnly',
  },
  {
    status: 'fastForward',
    base: versionBaseCommitId,
    ours: versionOursCommitId,
    theirs: versionTheirsCommitId,
    changes: [],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  },
  {
    status: 'alreadyMerged',
    base: versionBaseCommitId,
    ours: versionOursCommitId,
    theirs: versionTheirsCommitId,
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
    diagnostics: [versionStoreDiagnosticFixture],
    mutationGuarantee: 'preview-only',
  },
] satisfies readonly VersionMergeResult[];

const versionApplyMergeResolutionFixture = {
  conflictId: versionMergeConflictFixture.conflictId,
  expectedConflictDigest: versionMergeConflictFixture.conflictDigest,
  optionId: 'resolution:accept-theirs',
  kind: 'acceptTheirs',
} satisfies VersionApplyMergeResolution;

const workbookVersionApplyMergeInputFixtures = [
  {
    base: versionBaseCommitId,
    ours: versionOursCommitId,
    theirs: versionTheirsCommitId,
    resolutions: [versionApplyMergeResolutionFixture],
  },
  {
    resultId: versionMergeResultId,
    resultDigest: versionDigest,
    previewArtifactDigest: versionDigest,
    resolutionSetDigest: versionDigest,
    resolvedAttemptDigest: versionDigest,
    resolutions: [versionApplyMergeResolutionFixture],
  },
] satisfies readonly VersionApplyMergeInput[];

const workbookVersionApplyMergeOptionFixtures = [
  {
    mode: 'preview',
    targetRef: versionMainRefName,
    expectedTargetHead: versionExpectedHeadFixture,
    includeDiagnostics: true,
  },
  {
    mode: 'apply',
    targetRef: versionBranchRefName,
    includeDiagnostics: true,
  },
] satisfies readonly VersionApplyMergeOptions[];

const versionMergeCommitRefFixture = {
  id: versionMergeCommitId,
  refName: versionMainRefName,
  resolvedFrom: 'HEAD',
  refRevision: versionCounterRevision,
} satisfies WorkbookCommitRef;

const workbookVersionApplyMergeResultFixtures = [
  {
    status: 'planned',
    base: versionBaseCommitId,
    ours: versionOursCommitId,
    theirs: versionTheirsCommitId,
    changes: [versionMergeChangeFixture],
    conflicts: [],
    diagnostics: [],
    resolutionCount: 1,
    mutationGuarantee: 'preview-only',
    resultId: versionMergeResultId,
    previewArtifactDigest: versionDigest,
    resultDigest: versionDigest,
    resolutionSetDigest: versionDigest,
    resolvedAttemptDigest: versionDigest,
    targetRef: versionMainRefName,
    headBefore: versionOursCommitId,
    applicationPlanDigest: versionDigest,
  },
  {
    status: 'applied',
    base: versionBaseCommitId,
    ours: versionOursCommitId,
    theirs: versionTheirsCommitId,
    commitRef: versionMergeCommitRefFixture,
    changes: [versionMergeChangeFixture],
    conflicts: [],
    diagnostics: [],
    resolutionCount: 1,
    mutationGuarantee: 'merge-commit-created',
    headBefore: versionOursCommitId,
    headAfter: versionMergeCommitId,
    applicationPlanDigest: versionDigest,
  },
  {
    status: 'fastForwarded',
    base: versionBaseCommitId,
    ours: versionOursCommitId,
    theirs: versionTheirsCommitId,
    commitRef: versionMergeCommitRefFixture,
    changes: [],
    conflicts: [],
    diagnostics: [],
    resolutionCount: 0,
    mutationGuarantee: 'ref-fast-forwarded',
  },
  {
    status: 'alreadyApplied',
    base: versionBaseCommitId,
    ours: versionOursCommitId,
    theirs: versionTheirsCommitId,
    commitRef: versionMergeCommitRefFixture,
    changes: [],
    conflicts: [],
    diagnostics: [],
    resolutionCount: 0,
    mutationGuarantee: 'ref-not-mutated',
  },
  {
    status: 'alreadyMerged',
    base: versionBaseCommitId,
    ours: versionOursCommitId,
    theirs: versionTheirsCommitId,
    commitRef: versionMergeCommitRefFixture,
    changes: [],
    conflicts: [],
    diagnostics: [],
    resolutionCount: 0,
    mutationGuarantee: 'ref-not-mutated',
  },
  {
    status: 'conflicted',
    base: versionBaseCommitId,
    ours: versionOursCommitId,
    theirs: versionTheirsCommitId,
    changes: [versionMergeChangeFixture],
    conflicts: [versionMergeConflictFixture],
    diagnostics: [],
    requiredResolutionCount: 1,
    mutationGuarantee: 'no-write-attempted',
  },
  {
    status: 'blocked',
    base: null,
    ours: null,
    theirs: null,
    changes: [],
    conflicts: [],
    diagnostics: [versionStoreDiagnosticFixture],
    mutationGuarantee: 'no-write-attempted',
  },
  {
    status: 'staleTargetHead',
    base: versionBaseCommitId,
    ours: versionOursCommitId,
    theirs: versionTheirsCommitId,
    changes: [],
    conflicts: [],
    diagnostics: [versionRefConflictDiagnosticFixture],
    mutationGuarantee: 'ref-not-mutated',
  },
] as const satisfies readonly VersionApplyMergeResult[];

const workbookVersionRevertResultFixtures = [
  {
    schemaVersion: 1,
    status: 'planned',
    target: { kind: 'commit', commitId: versionTheirsCommitId },
    diagnostics: [],
    mutationGuarantee: 'no-write-attempted',
  },
  {
    schemaVersion: 1,
    status: 'applied',
    target: { kind: 'commit', commitId: versionTheirsCommitId },
    commitRef: {
      id: versionRevertCommitId,
      refName: versionMainRefName,
      resolvedFrom: versionMainRefName,
      refRevision: versionCounterRevision,
    },
    diagnostics: [],
    mutationGuarantee: 'revert-commit-created',
  },
  {
    schemaVersion: 1,
    status: 'rejected',
    target: { kind: 'mergeCommit', commitId: versionMergeCommitId, mainlineParent: 1 },
    diagnostics: [versionRefConflictDiagnosticFixture],
    mutationGuarantee: 'ref-not-mutated',
  },
  {
    schemaVersion: 1,
    status: 'requires-review',
    target: {
      kind: 'range',
      baseCommitId: versionBaseCommitId,
      headCommitId: versionTheirsCommitId,
    },
    reviewInvalidationIds: ['review:version-contract-requires-review'],
    diagnostics: [versionRevertConflictDiagnosticFixture],
    mutationGuarantee: 'ref-not-mutated',
  },
] as const satisfies readonly VersionRevertResult[];

const workbookVersionBasicContractFixtures = {
  commitOptions: workbookVersionCommitOptionFixtures,
  commitSummary: workbookCommitSummaryFixture,
  branchCreateOptions: workbookVersionBranchCreateFixtures,
  branchRef: workbookVersionBranchRefFixture,
  refReadResults: workbookVersionRefReadResultFixtures,
  refMutationResults: workbookVersionRefMutationResultFixtures,
  checkoutTargets: workbookVersionCheckoutTargets,
  checkoutOptions: workbookVersionCheckoutOptionsFixture,
  checkoutResults: workbookVersionCheckoutResultFixtures,
  mergeInput: versionMergeInputFixture,
  mergeOptions: versionMergeOptionsFixture,
  mergeResults: workbookVersionMergeResultFixtures,
  applyMergeInputs: workbookVersionApplyMergeInputFixtures,
  applyMergeOptions: workbookVersionApplyMergeOptionFixtures,
  applyMergeResults: workbookVersionApplyMergeResultFixtures,
  revertResults: workbookVersionRevertResultFixtures,
} satisfies WorkbookVersionBasicContractFixtureSurface;

type _WorkbookVersionPublishesExpectedW8W9MethodSet = Assert<
  IsEqual<keyof WorkbookVersion, ExpectedWorkbookVersionMethodName>
>;
type _WorkbookVersionCoreMethodsKeepPublicContracts = Assert<
  IsMutuallyAssignable<
    Pick<WorkbookVersion, keyof ExpectedWorkbookVersionCoreMethods>,
    ExpectedWorkbookVersionCoreMethods
  >
>;
type _WorkbookVersionEmbedsReviewApiContract = Assert<
  IsMutuallyAssignable<
    Pick<WorkbookVersion, keyof WorkbookVersionReviewApi>,
    WorkbookVersionReviewApi
  >
>;
type _WorkbookVersionEmbedsProposalApiContract = Assert<
  IsMutuallyAssignable<Pick<WorkbookVersion, keyof VersionProposalApi>, VersionProposalApi>
>;
type _WorkbookVersionMethodReturnEnvelopesArePublic = Assert<
  IsMutuallyAssignable<WorkbookVersionReturnByMethod, ExpectedWorkbookVersionReturnByMethod>
>;
type _WorkbookVersionTargetUnavailableUsesPublicDiagnostics = Assert<
  IsEqual<VersionTargetUnavailableError['diagnostics'], readonly VersionDiagnostic[]>
>;
type _WorkbookVersionStoreDiagnosticsExposeUnsupportedRecoverability = Assert<
  IsEqual<Extract<VersionStoreDiagnostic['recoverability'], 'unsupported'>, 'unsupported'>
>;
type _WorkbookVersionApplyMergeFixturesCoverResultStatuses = Assert<
  IsEqual<
    (typeof workbookVersionApplyMergeResultFixtures)[number]['status'],
    VersionApplyMergeResult['status']
  >
>;
type _WorkbookVersionRevertFixturesCoverResultStatuses = Assert<
  IsEqual<
    (typeof workbookVersionRevertResultFixtures)[number]['status'],
    VersionRevertResult['status']
  >
>;
type _WorkbookVersionMergeEndpointsExposeDeniedStatuses = Assert<
  IsEqual<
    Extract<
      VersionMergeEndpointDeniedStatus,
      'authorizationDenied' | 'capabilityDisabled' | 'invalidInput' | 'blocked'
    >,
    'authorizationDenied' | 'capabilityDisabled' | 'invalidInput' | 'blocked'
  >
>;
type _WorkbookVersionDiagnosticsExposePermissionDeniedCode = Assert<
  IsEqual<Extract<VersionDiagnosticCode, 'VERSION_PERMISSION_DENIED'>, 'VERSION_PERMISSION_DENIED'>
>;
type _WorkbookVersionDiagnosticsExposeUnsupportedPageTokenCode = Assert<
  IsEqual<
    Extract<VersionDiagnosticCode, 'VERSION_UNSUPPORTED_PAGE_TOKEN'>,
    'VERSION_UNSUPPORTED_PAGE_TOKEN'
  >
>;
type _WorkbookVersionDiagnosticEnvelopesHaveNoPrivateFields = Assert<
  IsEqual<
    Extract<
      KeysOfUnion<
        | VersionDiagnostic
        | VersionDiagnosticPublicPayload
        | VersionStoreDiagnostic
        | WorkbookVersionDiagnostic
        | VersionError
      >,
      PublicVersionPrivateDiagnosticFieldName
    >,
    never
  >
>;
type _WorkbookVersionResultEnvelopeValuesHaveNoTopLevelPrivateFields = Assert<
  IsEqual<
    Extract<
      KeysOfUnion<
        UnwrapVersionResult<
          ExpectedWorkbookVersionResultByMethod[keyof ExpectedWorkbookVersionResultByMethod]
        >
      >,
      PublicVersionPrivateDiagnosticFieldName
    >,
    never
  >
>;
