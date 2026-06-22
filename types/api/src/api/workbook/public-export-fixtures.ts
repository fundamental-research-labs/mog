import type {
  AgentProposal as ApiRootAgentProposal,
  AgentProposalAcceptResult as ApiRootAgentProposalAcceptResult,
  AgentProposalWorkspaceHandle as ApiRootAgentProposalWorkspaceHandle,
  CreateAgentProposalInput as ApiRootCreateAgentProposalInput,
  Paged as ApiRootPaged,
  RedactionPolicy as ApiRootRedactionPolicy,
  VersionCapabilityError as ApiRootCapabilityError,
  CheckoutVersionResult as ApiRootCheckoutVersionResult,
  VersionApplyMergeInput as ApiRootApplyMergeInput,
  VersionApplyMergeAttemptMetadata as ApiRootApplyMergeAttemptMetadata,
  VersionApplyMergeMutationGuarantee as ApiRootApplyMergeMutationGuarantee,
  VersionApplyMergeOptions as ApiRootApplyMergeOptions,
  VersionApplyMergeResult as ApiRootApplyMergeResult,
  VersionBranchRefReadResult as ApiRootBranchRefReadResult,
  VersionCheckoutMutationGuarantee as ApiRootCheckoutMutationGuarantee,
  VersionCheckoutOptions as ApiRootCheckoutOptions,
  VersionCheckoutPlan as ApiRootCheckoutPlan,
  VersionCheckoutResult as ApiRootCheckoutResult,
  VersionCheckoutTarget as ApiRootCheckoutTarget,
  VersionCommitExpectedHead as ApiRootCommitExpectedHead,
  VersionCommitMode as ApiRootCommitMode,
  VersionCommitOptions as ApiRootCommitOptions,
  VersionCreateBranchOptions as ApiRootCreateBranchOptions,
  VersionDiffEntry as ApiRootDiffEntry,
  VersionMergeAttemptKind as ApiRootMergeAttemptKind,
  VersionMergeAttemptMetadata as ApiRootMergeAttemptMetadata,
  VersionMergeAttemptPersistence as ApiRootMergeAttemptPersistence,
  VersionMergeConflict as ApiRootMergeConflict,
  VersionMergeConflictResolutionOption as ApiRootMergeConflictResolutionOption,
  VersionGetMergeConflictDetailRequest as ApiRootGetMergeConflictDetailRequest,
  VersionMergeResult as ApiRootMergeResult,
  VersionMergeResultId as ApiRootMergeResultId,
  VersionPendingRemoteSegmentId as ApiRootPendingRemoteSegmentId,
  VersionPromotePendingRemoteDiagnostic as ApiRootPromotePendingRemoteDiagnostic,
  VersionPromotePendingRemoteDiagnosticCode as ApiRootPromotePendingRemoteDiagnosticCode,
  VersionPromotePendingRemoteOptions as ApiRootPromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult as ApiRootPromotePendingRemoteResult,
  VersionPromotePendingRemoteSkippedSegment as ApiRootPromotePendingRemoteSkippedSegment,
  VersionPromotePendingRemoteSkipReason as ApiRootPromotePendingRemoteSkipReason,
  VersionPromotePendingRemoteStatus as ApiRootPromotePendingRemoteStatus,
  VersionProposalApi as ApiRootVersionProposalApi,
  VersionPutMergeResolutionPayloadResult as ApiRootPutMergeResolutionPayloadResult,
  VersionRefMutationResult as ApiRootRefMutationResult,
  VersionResult as ApiRootVersionResult,
  VersionSaveMergeResolutionsRequest as ApiRootSaveMergeResolutionsRequest,
  VersionHead as ApiRootVersionHead,
  VersionSemanticDiffPage as ApiRootSemanticDiffPage,
  VersionSemanticValue as ApiRootSemanticValue,
  VersionSealedResolutionPayloadRef as ApiRootSealedResolutionPayloadRef,
  VersionStoreDiagnostic as ApiRootStoreDiagnostic,
  WorkbookDiffPage as ApiRootDiffPage,
  WorkbookVersion as ApiRootWorkbookVersion,
  WorkbookVersionStatus as ApiRootWorkbookVersionStatus,
} from '../index';
import type {
  AgentProposal as PackageApiAgentProposal,
  AgentProposalAcceptResult as PackageApiAgentProposalAcceptResult,
  AgentProposalWorkspaceHandle as PackageApiAgentProposalWorkspaceHandle,
  CreateAgentProposalInput as PackageApiCreateAgentProposalInput,
  Paged as PackageApiPaged,
  RedactionPolicy as PackageApiRedactionPolicy,
  VersionCapabilityError as PackageApiCapabilityError,
  CheckoutVersionResult as PackageApiCheckoutVersionResult,
  VersionApplyMergeInput as PackageApiApplyMergeInput,
  VersionApplyMergeAttemptMetadata as PackageApiApplyMergeAttemptMetadata,
  VersionApplyMergeMutationGuarantee as PackageApiApplyMergeMutationGuarantee,
  VersionApplyMergeOptions as PackageApiApplyMergeOptions,
  VersionApplyMergeResult as PackageApiApplyMergeResult,
  VersionBranchRefReadResult as PackageApiBranchRefReadResult,
  VersionCheckoutMutationGuarantee as PackageApiCheckoutMutationGuarantee,
  VersionCheckoutOptions as PackageApiCheckoutOptions,
  VersionCheckoutPlan as PackageApiCheckoutPlan,
  VersionCheckoutResult as PackageApiCheckoutResult,
  VersionCheckoutTarget as PackageApiCheckoutTarget,
  VersionCommitExpectedHead as PackageApiCommitExpectedHead,
  VersionCommitMode as PackageApiCommitMode,
  VersionCommitOptions as PackageApiCommitOptions,
  VersionCreateBranchOptions as PackageApiCreateBranchOptions,
  VersionDiffEntry as PackageApiDiffEntry,
  VersionMergeAttemptKind as PackageApiMergeAttemptKind,
  VersionMergeAttemptMetadata as PackageApiMergeAttemptMetadata,
  VersionMergeAttemptPersistence as PackageApiMergeAttemptPersistence,
  VersionMergeConflict as PackageApiMergeConflict,
  VersionMergeConflictResolutionOption as PackageApiMergeConflictResolutionOption,
  VersionGetMergeConflictDetailRequest as PackageApiGetMergeConflictDetailRequest,
  VersionMergeResult as PackageApiMergeResult,
  VersionMergeResultId as PackageApiMergeResultId,
  VersionPendingRemoteSegmentId as PackageApiPendingRemoteSegmentId,
  VersionPromotePendingRemoteDiagnostic as PackageApiPromotePendingRemoteDiagnostic,
  VersionPromotePendingRemoteDiagnosticCode as PackageApiPromotePendingRemoteDiagnosticCode,
  VersionPromotePendingRemoteOptions as PackageApiPromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult as PackageApiPromotePendingRemoteResult,
  VersionPromotePendingRemoteSkippedSegment as PackageApiPromotePendingRemoteSkippedSegment,
  VersionPromotePendingRemoteSkipReason as PackageApiPromotePendingRemoteSkipReason,
  VersionPromotePendingRemoteStatus as PackageApiPromotePendingRemoteStatus,
  VersionProposalApi as PackageApiVersionProposalApi,
  VersionPutMergeResolutionPayloadResult as PackageApiPutMergeResolutionPayloadResult,
  VersionRefMutationResult as PackageApiRefMutationResult,
  VersionResult as PackageApiVersionResult,
  VersionSaveMergeResolutionsRequest as PackageApiSaveMergeResolutionsRequest,
  VersionHead as PackageApiVersionHead,
  VersionSemanticDiffPage as PackageApiSemanticDiffPage,
  VersionSemanticValue as PackageApiSemanticValue,
  VersionSealedResolutionPayloadRef as PackageApiSealedResolutionPayloadRef,
  VersionStoreDiagnostic as PackageApiStoreDiagnostic,
  WorkbookDiffPage as PackageApiDiffPage,
  WorkbookVersion as PackageApiWorkbookVersion,
  WorkbookVersionStatus as PackageApiWorkbookVersionStatus,
} from '@mog/types-api/api';
import type {
  AgentProposal as PackageWorkbookAgentProposal,
  AgentProposalAcceptResult as PackageWorkbookAgentProposalAcceptResult,
  AgentProposalWorkspaceHandle as PackageWorkbookAgentProposalWorkspaceHandle,
  CreateAgentProposalInput as PackageWorkbookCreateAgentProposalInput,
  Paged as PackageWorkbookPaged,
  RedactionPolicy as PackageWorkbookRedactionPolicy,
  VersionCapabilityError as PackageWorkbookCapabilityError,
  CheckoutVersionResult as PackageWorkbookCheckoutVersionResult,
  VersionApplyMergeInput as PackageWorkbookApplyMergeInput,
  VersionApplyMergeAttemptMetadata as PackageWorkbookApplyMergeAttemptMetadata,
  VersionApplyMergeMutationGuarantee as PackageWorkbookApplyMergeMutationGuarantee,
  VersionApplyMergeOptions as PackageWorkbookApplyMergeOptions,
  VersionApplyMergeResult as PackageWorkbookApplyMergeResult,
  VersionBranchRefReadResult as PackageWorkbookBranchRefReadResult,
  VersionCheckoutMutationGuarantee as PackageWorkbookCheckoutMutationGuarantee,
  VersionCheckoutOptions as PackageWorkbookCheckoutOptions,
  VersionCheckoutPlan as PackageWorkbookCheckoutPlan,
  VersionCheckoutResult as PackageWorkbookCheckoutResult,
  VersionCheckoutTarget as PackageWorkbookCheckoutTarget,
  VersionCommitExpectedHead as PackageWorkbookCommitExpectedHead,
  VersionCommitMode as PackageWorkbookCommitMode,
  VersionCommitOptions as PackageWorkbookCommitOptions,
  VersionCreateBranchOptions as PackageWorkbookCreateBranchOptions,
  VersionDiffEntry as PackageWorkbookDiffEntry,
  VersionMergeAttemptKind as PackageWorkbookMergeAttemptKind,
  VersionMergeAttemptMetadata as PackageWorkbookMergeAttemptMetadata,
  VersionMergeAttemptPersistence as PackageWorkbookMergeAttemptPersistence,
  VersionMergeConflict as PackageWorkbookMergeConflict,
  VersionMergeConflictResolutionOption as PackageWorkbookMergeConflictResolutionOption,
  VersionGetMergeConflictDetailRequest as PackageWorkbookGetMergeConflictDetailRequest,
  VersionMergeResult as PackageWorkbookMergeResult,
  VersionMergeResultId as PackageWorkbookMergeResultId,
  VersionPendingRemoteSegmentId as PackageWorkbookPendingRemoteSegmentId,
  VersionPromotePendingRemoteDiagnostic as PackageWorkbookPromotePendingRemoteDiagnostic,
  VersionPromotePendingRemoteDiagnosticCode as PackageWorkbookPromotePendingRemoteDiagnosticCode,
  VersionPromotePendingRemoteOptions as PackageWorkbookPromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult as PackageWorkbookPromotePendingRemoteResult,
  VersionPromotePendingRemoteSkippedSegment as PackageWorkbookPromotePendingRemoteSkippedSegment,
  VersionPromotePendingRemoteSkipReason as PackageWorkbookPromotePendingRemoteSkipReason,
  VersionPromotePendingRemoteStatus as PackageWorkbookPromotePendingRemoteStatus,
  VersionProposalApi as PackageWorkbookVersionProposalApi,
  VersionPutMergeResolutionPayloadResult as PackageWorkbookPutMergeResolutionPayloadResult,
  VersionRefMutationResult as PackageWorkbookRefMutationResult,
  VersionResult as PackageWorkbookVersionResult,
  VersionSaveMergeResolutionsRequest as PackageWorkbookSaveMergeResolutionsRequest,
  VersionHead as PackageWorkbookVersionHead,
  VersionSemanticDiffPage as PackageWorkbookSemanticDiffPage,
  VersionSemanticValue as PackageWorkbookSemanticValue,
  VersionSealedResolutionPayloadRef as PackageWorkbookSealedResolutionPayloadRef,
  VersionStoreDiagnostic as PackageWorkbookStoreDiagnostic,
  WorkbookDiffPage as PackageWorkbookDiffPage,
  WorkbookVersion as PackageWorkbookVersion,
  WorkbookVersionStatus as PackageWorkbookVersionStatus,
} from '@mog/types-api/api/workbook';
import type {
  AgentProposal as WorkbookNamespaceAgentProposal,
  AgentProposalAcceptResult as WorkbookNamespaceAgentProposalAcceptResult,
  AgentProposalWorkspaceHandle as WorkbookNamespaceAgentProposalWorkspaceHandle,
  CreateAgentProposalInput as WorkbookNamespaceCreateAgentProposalInput,
  Paged as WorkbookNamespacePaged,
  RedactionPolicy as WorkbookNamespaceRedactionPolicy,
  VersionCapabilityError as WorkbookNamespaceCapabilityError,
  CheckoutVersionResult as WorkbookNamespaceCheckoutVersionResult,
  VersionApplyMergeInput as WorkbookNamespaceApplyMergeInput,
  VersionApplyMergeAttemptMetadata as WorkbookNamespaceApplyMergeAttemptMetadata,
  VersionApplyMergeMutationGuarantee as WorkbookNamespaceApplyMergeMutationGuarantee,
  VersionApplyMergeOptions as WorkbookNamespaceApplyMergeOptions,
  VersionApplyMergeResult as WorkbookNamespaceApplyMergeResult,
  VersionBranchRefReadResult as WorkbookNamespaceBranchRefReadResult,
  VersionCheckoutMutationGuarantee as WorkbookNamespaceCheckoutMutationGuarantee,
  VersionCheckoutOptions as WorkbookNamespaceCheckoutOptions,
  VersionCheckoutPlan as WorkbookNamespaceCheckoutPlan,
  VersionCheckoutResult as WorkbookNamespaceCheckoutResult,
  VersionCheckoutTarget as WorkbookNamespaceCheckoutTarget,
  VersionCommitExpectedHead as WorkbookNamespaceCommitExpectedHead,
  VersionCommitMode as WorkbookNamespaceCommitMode,
  VersionCommitOptions as WorkbookNamespaceCommitOptions,
  VersionCreateBranchOptions as WorkbookNamespaceCreateBranchOptions,
  VersionDiffEntry as WorkbookNamespaceDiffEntry,
  VersionMergeAttemptKind as WorkbookNamespaceMergeAttemptKind,
  VersionMergeAttemptMetadata as WorkbookNamespaceMergeAttemptMetadata,
  VersionMergeAttemptPersistence as WorkbookNamespaceMergeAttemptPersistence,
  VersionMergeConflict as WorkbookNamespaceMergeConflict,
  VersionMergeConflictResolutionOption as WorkbookNamespaceMergeConflictResolutionOption,
  VersionGetMergeConflictDetailRequest as WorkbookNamespaceGetMergeConflictDetailRequest,
  VersionMergeResult as WorkbookNamespaceMergeResult,
  VersionMergeResultId as WorkbookNamespaceMergeResultId,
  VersionPendingRemoteSegmentId as WorkbookNamespacePendingRemoteSegmentId,
  VersionPromotePendingRemoteDiagnostic as WorkbookNamespacePromotePendingRemoteDiagnostic,
  VersionPromotePendingRemoteDiagnosticCode as WorkbookNamespacePromotePendingRemoteDiagnosticCode,
  VersionPromotePendingRemoteOptions as WorkbookNamespacePromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult as WorkbookNamespacePromotePendingRemoteResult,
  VersionPromotePendingRemoteSkippedSegment as WorkbookNamespacePromotePendingRemoteSkippedSegment,
  VersionPromotePendingRemoteSkipReason as WorkbookNamespacePromotePendingRemoteSkipReason,
  VersionPromotePendingRemoteStatus as WorkbookNamespacePromotePendingRemoteStatus,
  VersionProposalApi as WorkbookNamespaceVersionProposalApi,
  VersionPutMergeResolutionPayloadResult as WorkbookNamespacePutMergeResolutionPayloadResult,
  VersionRefMutationResult as WorkbookNamespaceRefMutationResult,
  VersionResult as WorkbookNamespaceVersionResult,
  VersionSaveMergeResolutionsRequest as WorkbookNamespaceSaveMergeResolutionsRequest,
  VersionHead as WorkbookNamespaceVersionHead,
  VersionSemanticDiffPage as WorkbookNamespaceSemanticDiffPage,
  VersionSemanticValue as WorkbookNamespaceSemanticValue,
  VersionSealedResolutionPayloadRef as WorkbookNamespaceSealedResolutionPayloadRef,
  VersionStoreDiagnostic as WorkbookNamespaceStoreDiagnostic,
  WorkbookDiffPage as WorkbookNamespaceDiffPage,
  WorkbookVersion as WorkbookNamespaceVersion,
  WorkbookVersionStatus as WorkbookNamespaceVersionStatus,
} from './index';

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type _WorkbookNamespaceExportsVersionApi = Assert<
  IsEqual<WorkbookNamespaceVersion, PackageWorkbookVersion>
>;
type _WorkbookNamespaceExportsStatus = Assert<
  IsEqual<WorkbookNamespaceVersionStatus, PackageWorkbookVersionStatus>
>;
type _WorkbookNamespaceExportsAgentProposal = Assert<
  IsEqual<WorkbookNamespaceAgentProposal, PackageWorkbookAgentProposal>
>;
type _WorkbookNamespaceExportsAgentProposalAcceptResult = Assert<
  IsEqual<WorkbookNamespaceAgentProposalAcceptResult, PackageWorkbookAgentProposalAcceptResult>
>;
type _WorkbookNamespaceExportsAgentProposalWorkspaceHandle = Assert<
  IsEqual<WorkbookNamespaceAgentProposalWorkspaceHandle, PackageWorkbookAgentProposalWorkspaceHandle>
>;
type _WorkbookNamespaceExportsCreateAgentProposalInput = Assert<
  IsEqual<WorkbookNamespaceCreateAgentProposalInput, PackageWorkbookCreateAgentProposalInput>
>;
type _WorkbookNamespaceExportsVersionProposalApi = Assert<
  IsEqual<WorkbookNamespaceVersionProposalApi, PackageWorkbookVersionProposalApi>
>;
type _WorkbookNamespaceExportsApplyMergeResult = Assert<
  IsEqual<WorkbookNamespaceApplyMergeResult, PackageWorkbookApplyMergeResult>
>;
type _WorkbookNamespaceExportsApplyMergeInput = Assert<
  IsEqual<WorkbookNamespaceApplyMergeInput, PackageWorkbookApplyMergeInput>
>;
type _WorkbookNamespaceExportsApplyMergeAttemptMetadata = Assert<
  IsEqual<WorkbookNamespaceApplyMergeAttemptMetadata, PackageWorkbookApplyMergeAttemptMetadata>
>;
type _WorkbookNamespaceExportsApplyMergeOptions = Assert<
  IsEqual<WorkbookNamespaceApplyMergeOptions, PackageWorkbookApplyMergeOptions>
>;
type _WorkbookNamespaceExportsApplyMergeGuarantee = Assert<
  IsEqual<WorkbookNamespaceApplyMergeMutationGuarantee, PackageWorkbookApplyMergeMutationGuarantee>
>;
type _WorkbookNamespaceExportsCommitOptions = Assert<
  IsEqual<WorkbookNamespaceCommitOptions, PackageWorkbookCommitOptions>
>;
type _WorkbookNamespaceExportsCommitExpectedHead = Assert<
  IsEqual<WorkbookNamespaceCommitExpectedHead, PackageWorkbookCommitExpectedHead>
>;
type _WorkbookNamespaceExportsCommitMode = Assert<
  IsEqual<WorkbookNamespaceCommitMode, PackageWorkbookCommitMode>
>;
type _WorkbookNamespaceExportsDiffEntry = Assert<
  IsEqual<WorkbookNamespaceDiffEntry, PackageWorkbookDiffEntry>
>;
type _WorkbookNamespaceExportsMergeConflict = Assert<
  IsEqual<WorkbookNamespaceMergeConflict, PackageWorkbookMergeConflict>
>;
type _WorkbookNamespaceExportsMergeConflictResolutionOption = Assert<
  IsEqual<WorkbookNamespaceMergeConflictResolutionOption, PackageWorkbookMergeConflictResolutionOption>
>;
type _WorkbookNamespaceExportsMergeResult = Assert<
  IsEqual<WorkbookNamespaceMergeResult, PackageWorkbookMergeResult>
>;
type _WorkbookNamespaceExportsMergeAttemptMetadata = Assert<
  IsEqual<WorkbookNamespaceMergeAttemptMetadata, PackageWorkbookMergeAttemptMetadata>
>;
type _WorkbookNamespaceExportsMergeAttemptKind = Assert<
  IsEqual<WorkbookNamespaceMergeAttemptKind, PackageWorkbookMergeAttemptKind>
>;
type _WorkbookNamespaceExportsMergeAttemptPersistence = Assert<
  IsEqual<WorkbookNamespaceMergeAttemptPersistence, PackageWorkbookMergeAttemptPersistence>
>;
type _WorkbookNamespaceExportsMergeResultId = Assert<
  IsEqual<WorkbookNamespaceMergeResultId, PackageWorkbookMergeResultId>
>;
type _WorkbookNamespaceExportsPendingRemoteSegmentId = Assert<
  IsEqual<WorkbookNamespacePendingRemoteSegmentId, PackageWorkbookPendingRemoteSegmentId>
>;
type _WorkbookNamespaceExportsPromotePendingRemoteOptions = Assert<
  IsEqual<WorkbookNamespacePromotePendingRemoteOptions, PackageWorkbookPromotePendingRemoteOptions>
>;
type _WorkbookNamespaceExportsPromotePendingRemoteResult = Assert<
  IsEqual<WorkbookNamespacePromotePendingRemoteResult, PackageWorkbookPromotePendingRemoteResult>
>;
type _WorkbookNamespaceExportsPromotePendingRemoteSkippedSegment = Assert<
  IsEqual<WorkbookNamespacePromotePendingRemoteSkippedSegment, PackageWorkbookPromotePendingRemoteSkippedSegment>
>;
type _WorkbookNamespaceExportsPromotePendingRemoteStatus = Assert<
  IsEqual<WorkbookNamespacePromotePendingRemoteStatus, PackageWorkbookPromotePendingRemoteStatus>
>;
type _WorkbookNamespaceExportsPromotePendingRemoteSkipReason = Assert<
  IsEqual<WorkbookNamespacePromotePendingRemoteSkipReason, PackageWorkbookPromotePendingRemoteSkipReason>
>;
type _WorkbookNamespaceExportsPromotePendingRemoteDiagnostic = Assert<
  IsEqual<WorkbookNamespacePromotePendingRemoteDiagnostic, PackageWorkbookPromotePendingRemoteDiagnostic>
>;
type _WorkbookNamespaceExportsPromotePendingRemoteDiagnosticCode = Assert<
  IsEqual<WorkbookNamespacePromotePendingRemoteDiagnosticCode, PackageWorkbookPromotePendingRemoteDiagnosticCode>
>;
type _WorkbookNamespaceExportsSaveMergeResolutionsRequest = Assert<
  IsEqual<WorkbookNamespaceSaveMergeResolutionsRequest, PackageWorkbookSaveMergeResolutionsRequest>
>;
type _WorkbookNamespaceExportsGetMergeConflictDetailRequest = Assert<
  IsEqual<WorkbookNamespaceGetMergeConflictDetailRequest, PackageWorkbookGetMergeConflictDetailRequest>
>;
type _WorkbookNamespaceExportsPutMergeResolutionPayloadResult = Assert<
  IsEqual<WorkbookNamespacePutMergeResolutionPayloadResult, PackageWorkbookPutMergeResolutionPayloadResult>
>;
type _WorkbookNamespaceExportsSealedResolutionPayloadRef = Assert<
  IsEqual<WorkbookNamespaceSealedResolutionPayloadRef, PackageWorkbookSealedResolutionPayloadRef>
>;
type _WorkbookNamespaceExportsDiffPage = Assert<
  IsEqual<WorkbookNamespaceDiffPage, PackageWorkbookDiffPage>
>;
type _WorkbookNamespaceExportsCheckoutTarget = Assert<
  IsEqual<WorkbookNamespaceCheckoutTarget, PackageWorkbookCheckoutTarget>
>;
type _WorkbookNamespaceExportsCheckoutOptions = Assert<
  IsEqual<WorkbookNamespaceCheckoutOptions, PackageWorkbookCheckoutOptions>
>;
type _WorkbookNamespaceExportsCheckoutPlan = Assert<
  IsEqual<WorkbookNamespaceCheckoutPlan, PackageWorkbookCheckoutPlan>
>;
type _WorkbookNamespaceExportsCheckoutResult = Assert<
  IsEqual<WorkbookNamespaceCheckoutResult, PackageWorkbookCheckoutResult>
>;
type _WorkbookNamespaceExportsCheckoutVersionResult = Assert<
  IsEqual<WorkbookNamespaceCheckoutVersionResult, PackageWorkbookCheckoutVersionResult>
>;
type _WorkbookNamespaceExportsCheckoutGuarantee = Assert<
  IsEqual<WorkbookNamespaceCheckoutMutationGuarantee, PackageWorkbookCheckoutMutationGuarantee>
>;
type _WorkbookNamespaceExportsBranchCreateOptions = Assert<
  IsEqual<WorkbookNamespaceCreateBranchOptions, PackageWorkbookCreateBranchOptions>
>;
type _WorkbookNamespaceExportsBranchRead = Assert<
  IsEqual<WorkbookNamespaceBranchRefReadResult, PackageWorkbookBranchRefReadResult>
>;
type _WorkbookNamespaceExportsBranchMutation = Assert<
  IsEqual<WorkbookNamespaceRefMutationResult, PackageWorkbookRefMutationResult>
>;
type _WorkbookNamespaceExportsStoreDiagnostic = Assert<
  IsEqual<WorkbookNamespaceStoreDiagnostic, PackageWorkbookStoreDiagnostic>
>;
type _WorkbookNamespaceExportsSemanticValue = Assert<
  IsEqual<WorkbookNamespaceSemanticValue, PackageWorkbookSemanticValue>
>;
type _WorkbookNamespaceExportsRedactionPolicy = Assert<
  IsEqual<WorkbookNamespaceRedactionPolicy, PackageWorkbookRedactionPolicy>
>;
type _WorkbookNamespaceExportsCapabilityError = Assert<
  IsEqual<WorkbookNamespaceCapabilityError, PackageWorkbookCapabilityError>
>;
type _WorkbookNamespaceExportsVersionResult = Assert<
  IsEqual<WorkbookNamespaceVersionResult<string>, PackageWorkbookVersionResult<string>>
>;
type _WorkbookNamespaceExportsVersionHead = Assert<
  IsEqual<WorkbookNamespaceVersionHead, PackageWorkbookVersionHead>
>;
type _WorkbookNamespaceExportsSemanticDiffPage = Assert<
  IsEqual<WorkbookNamespaceSemanticDiffPage, PackageWorkbookSemanticDiffPage>
>;
type _WorkbookNamespaceExportsPaged = Assert<
  IsEqual<WorkbookNamespacePaged<string>, PackageWorkbookPaged<string>>
>;

type _ApiRootExportsVersionApi = Assert<IsEqual<ApiRootWorkbookVersion, PackageApiWorkbookVersion>>;
type _ApiRootExportsStatus = Assert<
  IsEqual<ApiRootWorkbookVersionStatus, PackageApiWorkbookVersionStatus>
>;
type _ApiRootExportsAgentProposal = Assert<
  IsEqual<ApiRootAgentProposal, PackageApiAgentProposal>
>;
type _ApiRootExportsAgentProposalAcceptResult = Assert<
  IsEqual<ApiRootAgentProposalAcceptResult, PackageApiAgentProposalAcceptResult>
>;
type _ApiRootExportsAgentProposalWorkspaceHandle = Assert<
  IsEqual<ApiRootAgentProposalWorkspaceHandle, PackageApiAgentProposalWorkspaceHandle>
>;
type _ApiRootExportsCreateAgentProposalInput = Assert<
  IsEqual<ApiRootCreateAgentProposalInput, PackageApiCreateAgentProposalInput>
>;
type _ApiRootExportsVersionProposalApi = Assert<
  IsEqual<ApiRootVersionProposalApi, PackageApiVersionProposalApi>
>;
type _ApiRootExportsApplyMergeResult = Assert<
  IsEqual<ApiRootApplyMergeResult, PackageApiApplyMergeResult>
>;
type _ApiRootExportsApplyMergeInput = Assert<
  IsEqual<ApiRootApplyMergeInput, PackageApiApplyMergeInput>
>;
type _ApiRootExportsApplyMergeAttemptMetadata = Assert<
  IsEqual<ApiRootApplyMergeAttemptMetadata, PackageApiApplyMergeAttemptMetadata>
>;
type _ApiRootExportsApplyMergeOptions = Assert<
  IsEqual<ApiRootApplyMergeOptions, PackageApiApplyMergeOptions>
>;
type _ApiRootExportsApplyMergeGuarantee = Assert<
  IsEqual<ApiRootApplyMergeMutationGuarantee, PackageApiApplyMergeMutationGuarantee>
>;
type _ApiRootExportsCommitOptions = Assert<
  IsEqual<ApiRootCommitOptions, PackageApiCommitOptions>
>;
type _ApiRootExportsCommitExpectedHead = Assert<
  IsEqual<ApiRootCommitExpectedHead, PackageApiCommitExpectedHead>
>;
type _ApiRootExportsCommitMode = Assert<IsEqual<ApiRootCommitMode, PackageApiCommitMode>>;
type _ApiRootExportsDiffEntry = Assert<IsEqual<ApiRootDiffEntry, PackageApiDiffEntry>>;
type _ApiRootExportsMergeConflict = Assert<
  IsEqual<ApiRootMergeConflict, PackageApiMergeConflict>
>;
type _ApiRootExportsMergeConflictResolutionOption = Assert<
  IsEqual<ApiRootMergeConflictResolutionOption, PackageApiMergeConflictResolutionOption>
>;
type _ApiRootExportsMergeResult = Assert<IsEqual<ApiRootMergeResult, PackageApiMergeResult>>;
type _ApiRootExportsMergeAttemptMetadata = Assert<
  IsEqual<ApiRootMergeAttemptMetadata, PackageApiMergeAttemptMetadata>
>;
type _ApiRootExportsMergeAttemptKind = Assert<
  IsEqual<ApiRootMergeAttemptKind, PackageApiMergeAttemptKind>
>;
type _ApiRootExportsMergeAttemptPersistence = Assert<
  IsEqual<ApiRootMergeAttemptPersistence, PackageApiMergeAttemptPersistence>
>;
type _ApiRootExportsMergeResultId = Assert<IsEqual<ApiRootMergeResultId, PackageApiMergeResultId>>;
type _ApiRootExportsPendingRemoteSegmentId = Assert<
  IsEqual<ApiRootPendingRemoteSegmentId, PackageApiPendingRemoteSegmentId>
>;
type _ApiRootExportsPromotePendingRemoteOptions = Assert<
  IsEqual<ApiRootPromotePendingRemoteOptions, PackageApiPromotePendingRemoteOptions>
>;
type _ApiRootExportsPromotePendingRemoteResult = Assert<
  IsEqual<ApiRootPromotePendingRemoteResult, PackageApiPromotePendingRemoteResult>
>;
type _ApiRootExportsPromotePendingRemoteSkippedSegment = Assert<
  IsEqual<ApiRootPromotePendingRemoteSkippedSegment, PackageApiPromotePendingRemoteSkippedSegment>
>;
type _ApiRootExportsPromotePendingRemoteStatus = Assert<
  IsEqual<ApiRootPromotePendingRemoteStatus, PackageApiPromotePendingRemoteStatus>
>;
type _ApiRootExportsPromotePendingRemoteSkipReason = Assert<
  IsEqual<ApiRootPromotePendingRemoteSkipReason, PackageApiPromotePendingRemoteSkipReason>
>;
type _ApiRootExportsPromotePendingRemoteDiagnostic = Assert<
  IsEqual<ApiRootPromotePendingRemoteDiagnostic, PackageApiPromotePendingRemoteDiagnostic>
>;
type _ApiRootExportsPromotePendingRemoteDiagnosticCode = Assert<
  IsEqual<ApiRootPromotePendingRemoteDiagnosticCode, PackageApiPromotePendingRemoteDiagnosticCode>
>;
type _ApiRootExportsSaveMergeResolutionsRequest = Assert<
  IsEqual<ApiRootSaveMergeResolutionsRequest, PackageApiSaveMergeResolutionsRequest>
>;
type _ApiRootExportsGetMergeConflictDetailRequest = Assert<
  IsEqual<ApiRootGetMergeConflictDetailRequest, PackageApiGetMergeConflictDetailRequest>
>;
type _ApiRootExportsPutMergeResolutionPayloadResult = Assert<
  IsEqual<ApiRootPutMergeResolutionPayloadResult, PackageApiPutMergeResolutionPayloadResult>
>;
type _ApiRootExportsSealedResolutionPayloadRef = Assert<
  IsEqual<ApiRootSealedResolutionPayloadRef, PackageApiSealedResolutionPayloadRef>
>;
type _ApiRootExportsCapabilityError = Assert<
  IsEqual<ApiRootCapabilityError, PackageApiCapabilityError>
>;
type _ApiRootExportsVersionResult = Assert<
  IsEqual<ApiRootVersionResult<string>, PackageApiVersionResult<string>>
>;
type _ApiRootExportsVersionHead = Assert<IsEqual<ApiRootVersionHead, PackageApiVersionHead>>;
type _ApiRootExportsSemanticDiffPage = Assert<
  IsEqual<ApiRootSemanticDiffPage, PackageApiSemanticDiffPage>
>;
type _ApiRootExportsPaged = Assert<IsEqual<ApiRootPaged<string>, PackageApiPaged<string>>>;
type _ApiRootExportsDiffPage = Assert<IsEqual<ApiRootDiffPage, PackageApiDiffPage>>;
type _ApiRootExportsCheckoutTarget = Assert<
  IsEqual<ApiRootCheckoutTarget, PackageApiCheckoutTarget>
>;
type _ApiRootExportsCheckoutOptions = Assert<
  IsEqual<ApiRootCheckoutOptions, PackageApiCheckoutOptions>
>;
type _ApiRootExportsCheckoutPlan = Assert<IsEqual<ApiRootCheckoutPlan, PackageApiCheckoutPlan>>;
type _ApiRootExportsCheckoutResult = Assert<
  IsEqual<ApiRootCheckoutResult, PackageApiCheckoutResult>
>;
type _ApiRootExportsCheckoutVersionResult = Assert<
  IsEqual<ApiRootCheckoutVersionResult, PackageApiCheckoutVersionResult>
>;
type _ApiRootExportsCheckoutGuarantee = Assert<
  IsEqual<ApiRootCheckoutMutationGuarantee, PackageApiCheckoutMutationGuarantee>
>;
type _ApiRootExportsBranchCreateOptions = Assert<
  IsEqual<ApiRootCreateBranchOptions, PackageApiCreateBranchOptions>
>;
type _ApiRootExportsBranchRead = Assert<
  IsEqual<ApiRootBranchRefReadResult, PackageApiBranchRefReadResult>
>;
type _ApiRootExportsBranchMutation = Assert<
  IsEqual<ApiRootRefMutationResult, PackageApiRefMutationResult>
>;
type _ApiRootExportsStoreDiagnostic = Assert<
  IsEqual<ApiRootStoreDiagnostic, PackageApiStoreDiagnostic>
>;
type _ApiRootExportsSemanticValue = Assert<
  IsEqual<ApiRootSemanticValue, PackageApiSemanticValue>
>;
type _ApiRootExportsRedactionPolicy = Assert<
  IsEqual<ApiRootRedactionPolicy, PackageApiRedactionPolicy>
>;
