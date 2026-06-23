import type {
  AgentProposal,
  AgentProposalAcceptResult,
  AgentProposalSummary,
  AgentProposalWorkspaceHandle,
  CheckoutVersionResult,
  GetVersionHeadInput,
  ListVersionCommitsInput,
  ListVersionRefsInput,
  Paged,
  VersionApplyMergeInput,
  VersionApplyMergeOptions,
  VersionApplyMergeResult,
  VersionBranchName,
  VersionBranchRefReadResult,
  VersionCheckoutOptions,
  VersionCheckoutTarget,
  VersionCommitish,
  VersionCommitOptions,
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
  VersionMergeInput,
  VersionMergeOptions,
  VersionMergeResult,
  VersionPromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult,
  VersionProposalApi,
  VersionPutMergeResolutionPayloadRequest,
  VersionPutMergeResolutionPayloadResult,
  VersionRef,
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
