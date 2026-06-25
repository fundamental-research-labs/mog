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
  VersionCounterRecordRevision as ApiRootCounterRecordRevision,
  VersionCreateBranchOptions as ApiRootCreateBranchOptions,
  VersionDeleteRefOptions as ApiRootDeleteRefOptions,
  VersionDiffEntry as ApiRootDiffEntry,
  VersionFastForwardBranchOptions as ApiRootFastForwardBranchOptions,
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
  VersionRefReadResult as ApiRootRefReadResult,
  VersionRevertInput as ApiRootRevertInput,
  VersionRevertOptions as ApiRootRevertOptions,
  VersionRevertResult as ApiRootRevertResult,
  VersionResult as ApiRootVersionResult,
  VersionSaveMergeResolutionsRequest as ApiRootSaveMergeResolutionsRequest,
  VersionHead as ApiRootVersionHead,
  VersionSemanticDiffPage as ApiRootSemanticDiffPage,
  VersionSemanticValue as ApiRootSemanticValue,
  VersionSealedResolutionPayloadRef as ApiRootSealedResolutionPayloadRef,
  VersionStoreDiagnostic as ApiRootStoreDiagnostic,
  VersionSymbolicRefReadResult as ApiRootSymbolicRefReadResult,
  VersionSurfaceDiagnosticCode as ApiRootSurfaceDiagnosticCode,
  VersionUpdateBranchOptions as ApiRootUpdateBranchOptions,
  WorkbookDiffPage as ApiRootDiffPage,
  WorkbookVersion as ApiRootWorkbookVersion,
  WorkbookVersionDiagnosticCode as ApiRootWorkbookVersionDiagnosticCode,
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
  VersionCounterRecordRevision as PackageApiCounterRecordRevision,
  VersionCreateBranchOptions as PackageApiCreateBranchOptions,
  VersionDeleteRefOptions as PackageApiDeleteRefOptions,
  VersionDiffEntry as PackageApiDiffEntry,
  VersionFastForwardBranchOptions as PackageApiFastForwardBranchOptions,
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
  VersionRefReadResult as PackageApiRefReadResult,
  VersionRevertInput as PackageApiRevertInput,
  VersionRevertOptions as PackageApiRevertOptions,
  VersionRevertResult as PackageApiRevertResult,
  VersionResult as PackageApiVersionResult,
  VersionSaveMergeResolutionsRequest as PackageApiSaveMergeResolutionsRequest,
  VersionHead as PackageApiVersionHead,
  VersionSemanticDiffPage as PackageApiSemanticDiffPage,
  VersionSemanticValue as PackageApiSemanticValue,
  VersionSealedResolutionPayloadRef as PackageApiSealedResolutionPayloadRef,
  VersionStoreDiagnostic as PackageApiStoreDiagnostic,
  VersionSymbolicRefReadResult as PackageApiSymbolicRefReadResult,
  VersionSurfaceDiagnosticCode as PackageApiSurfaceDiagnosticCode,
  VersionUpdateBranchOptions as PackageApiUpdateBranchOptions,
  WorkbookDiffPage as PackageApiDiffPage,
  WorkbookVersion as PackageApiWorkbookVersion,
  WorkbookVersionDiagnosticCode as PackageApiWorkbookVersionDiagnosticCode,
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
  VersionCounterRecordRevision as PackageWorkbookCounterRecordRevision,
  VersionCreateBranchOptions as PackageWorkbookCreateBranchOptions,
  VersionDeleteRefOptions as PackageWorkbookDeleteRefOptions,
  VersionDiffEntry as PackageWorkbookDiffEntry,
  VersionFastForwardBranchOptions as PackageWorkbookFastForwardBranchOptions,
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
  VersionRefReadResult as PackageWorkbookRefReadResult,
  VersionRevertInput as PackageWorkbookRevertInput,
  VersionRevertOptions as PackageWorkbookRevertOptions,
  VersionRevertResult as PackageWorkbookRevertResult,
  VersionResult as PackageWorkbookVersionResult,
  VersionSaveMergeResolutionsRequest as PackageWorkbookSaveMergeResolutionsRequest,
  VersionHead as PackageWorkbookVersionHead,
  VersionSemanticDiffPage as PackageWorkbookSemanticDiffPage,
  VersionSemanticValue as PackageWorkbookSemanticValue,
  VersionSealedResolutionPayloadRef as PackageWorkbookSealedResolutionPayloadRef,
  VersionStoreDiagnostic as PackageWorkbookStoreDiagnostic,
  VersionSymbolicRefReadResult as PackageWorkbookSymbolicRefReadResult,
  VersionSurfaceDiagnosticCode as PackageWorkbookSurfaceDiagnosticCode,
  VersionUpdateBranchOptions as PackageWorkbookUpdateBranchOptions,
  WorkbookDiffPage as PackageWorkbookDiffPage,
  WorkbookVersion as PackageWorkbookVersion,
  WorkbookVersionDiagnosticCode as PackageWorkbookVersionDiagnosticCode,
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
  VersionCounterRecordRevision as WorkbookNamespaceCounterRecordRevision,
  VersionCreateBranchOptions as WorkbookNamespaceCreateBranchOptions,
  VersionDeleteRefOptions as WorkbookNamespaceDeleteRefOptions,
  VersionDiffEntry as WorkbookNamespaceDiffEntry,
  VersionFastForwardBranchOptions as WorkbookNamespaceFastForwardBranchOptions,
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
  VersionRefReadResult as WorkbookNamespaceRefReadResult,
  VersionRevertInput as WorkbookNamespaceRevertInput,
  VersionRevertOptions as WorkbookNamespaceRevertOptions,
  VersionRevertResult as WorkbookNamespaceRevertResult,
  VersionResult as WorkbookNamespaceVersionResult,
  VersionSaveMergeResolutionsRequest as WorkbookNamespaceSaveMergeResolutionsRequest,
  VersionHead as WorkbookNamespaceVersionHead,
  VersionSemanticDiffPage as WorkbookNamespaceSemanticDiffPage,
  VersionSemanticValue as WorkbookNamespaceSemanticValue,
  VersionSealedResolutionPayloadRef as WorkbookNamespaceSealedResolutionPayloadRef,
  VersionStoreDiagnostic as WorkbookNamespaceStoreDiagnostic,
  VersionSymbolicRefReadResult as WorkbookNamespaceSymbolicRefReadResult,
  VersionSurfaceDiagnosticCode as WorkbookNamespaceSurfaceDiagnosticCode,
  VersionUpdateBranchOptions as WorkbookNamespaceUpdateBranchOptions,
  WorkbookDiffPage as WorkbookNamespaceDiffPage,
  WorkbookVersion as WorkbookNamespaceVersion,
  WorkbookVersionDiagnosticCode as WorkbookNamespaceVersionDiagnosticCode,
  WorkbookVersionStatus as WorkbookNamespaceVersionStatus,
} from './index';

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAssignable<A, B> = [A] extends [B] ? true : false;
type KnownStringLiteral<T> = T extends string ? (string extends T ? never : T) : never;
type OpaqueRecordRevision = { readonly kind: 'opaque'; readonly value: string };

type KernelSurfaceStatusDiagnosticCode =
  | 'version.surfaceStatus.featureGateDefaultEnabled'
  | 'version.surfaceStatus.featureGateDisabled'
  | 'version.surfaceStatus.editingDisabled'
  | 'version.surfaceStatus.hostCapabilityDenied'
  | 'version.surfaceStatus.storageUnavailable'
  | 'version.surfaceStatus.storageReady'
  | 'version.surfaceStatus.storageBackendUnknown'
  | 'version.surfaceStatus.readUnavailable'
  | 'version.surfaceStatus.currentReadFailed'
  | 'version.surfaceStatus.currentRefHeadUnavailable'
  | 'version.surfaceStatus.dirtyTokenUnavailable'
  | 'version.surfaceStatus.dirtyStatusInvalid'
  | 'version.surfaceStatus.dirtyStatusFailed'
  | 'version.surfaceStatus.checkoutSessionInvalid'
  | 'version.surfaceStatus.checkoutSessionReadFailed'
  | 'version.surfaceStatus.dirtyWorkingState'
  | 'version.surfaceStatus.pendingRecalc'
  | 'version.surfaceStatus.checkoutInProgress'
  | 'version.surfaceStatus.pendingProviderWrites'
  | 'version.surfaceStatus.pendingProviderWritesReadFailed'
  | 'version.surfaceStatus.liveCollaborationActive'
  | 'version.surfaceStatus.liveCollaborationUnknown'
  | 'version.surfaceStatus.diffUnavailable'
  | 'version.surfaceStatus.commitUnavailable'
  | 'version.surfaceStatus.branchUnavailable'
  | 'version.surfaceStatus.checkoutUnavailable'
  | 'version.surfaceStatus.reviewUnavailable'
  | 'version.surfaceStatus.proposalUnavailable'
  | 'version.surfaceStatus.mergeCapabilityDisabled'
  | 'version.surfaceStatus.mergeKillSwitchActive'
  | 'version.surfaceStatus.mergePreviewUnavailable'
  | 'version.surfaceStatus.mergeApplyUnavailable'
  | 'version.surfaceStatus.revertUnavailable'
  | 'version.surfaceStatus.provenanceUnavailable';

type KernelWorkbookVersionStatusDiagnosticCode =
  | 'version.objectStore.foundationPresent'
  | 'version.objectStore.serviceUnavailable'
  | 'version.refLifecycle.foundationPresent'
  | 'version.refLifecycle.serviceUnavailable'
  | 'version.commitApi.pending'
  | 'version.commitApi.serviceAttached'
  | 'version.checkout.pending'
  | 'version.checkout.serviceAttached'
  | 'version.merge.pending'
  | 'version.merge.serviceAttached'
  | 'version.provenanceAdmission.present'
  | 'version.provenanceAdmission.vc09TruthUnavailable'
  | 'version.provenanceAdmission.mutationAdmissionFoundationPresent'
  | 'version.provenanceAdmission.mutationAdmissionFoundationUnavailable'
  | 'version.provenancePromotion.serviceAttached'
  | 'version.head.serviceUnavailable';

type _SurfaceDiagnosticCodesCoverKernelStatus = Assert<
  IsEqual<
    Exclude<
      KernelSurfaceStatusDiagnosticCode,
      KnownStringLiteral<PackageWorkbookSurfaceDiagnosticCode>
    >,
    never
  >
>;
type _WorkbookDiagnosticCodesCoverKernelStatus = Assert<
  IsEqual<
    Exclude<
      KernelWorkbookVersionStatusDiagnosticCode,
      KnownStringLiteral<PackageWorkbookVersionDiagnosticCode>
    >,
    never
  >
>;
type _SurfaceDiagnosticCodeAllowsExtensions = Assert<
  IsAssignable<'version.surfaceStatus.futureCode', PackageWorkbookSurfaceDiagnosticCode>
>;

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
  IsEqual<
    WorkbookNamespaceAgentProposalWorkspaceHandle,
    PackageWorkbookAgentProposalWorkspaceHandle
  >
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
  IsEqual<
    WorkbookNamespaceMergeConflictResolutionOption,
    PackageWorkbookMergeConflictResolutionOption
  >
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
  IsEqual<
    WorkbookNamespacePromotePendingRemoteSkippedSegment,
    PackageWorkbookPromotePendingRemoteSkippedSegment
  >
>;
type _WorkbookNamespaceExportsPromotePendingRemoteStatus = Assert<
  IsEqual<WorkbookNamespacePromotePendingRemoteStatus, PackageWorkbookPromotePendingRemoteStatus>
>;
type _WorkbookNamespaceExportsPromotePendingRemoteSkipReason = Assert<
  IsEqual<
    WorkbookNamespacePromotePendingRemoteSkipReason,
    PackageWorkbookPromotePendingRemoteSkipReason
  >
>;
type _WorkbookNamespaceExportsPromotePendingRemoteDiagnostic = Assert<
  IsEqual<
    WorkbookNamespacePromotePendingRemoteDiagnostic,
    PackageWorkbookPromotePendingRemoteDiagnostic
  >
>;
type _WorkbookNamespaceExportsPromotePendingRemoteDiagnosticCode = Assert<
  IsEqual<
    WorkbookNamespacePromotePendingRemoteDiagnosticCode,
    PackageWorkbookPromotePendingRemoteDiagnosticCode
  >
>;
type _WorkbookNamespaceExportsSaveMergeResolutionsRequest = Assert<
  IsEqual<WorkbookNamespaceSaveMergeResolutionsRequest, PackageWorkbookSaveMergeResolutionsRequest>
>;
type _WorkbookNamespaceExportsGetMergeConflictDetailRequest = Assert<
  IsEqual<
    WorkbookNamespaceGetMergeConflictDetailRequest,
    PackageWorkbookGetMergeConflictDetailRequest
  >
>;
type _WorkbookNamespaceExportsPutMergeResolutionPayloadResult = Assert<
  IsEqual<
    WorkbookNamespacePutMergeResolutionPayloadResult,
    PackageWorkbookPutMergeResolutionPayloadResult
  >
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
type _WorkbookNamespaceExportsCounterRecordRevision = Assert<
  IsEqual<WorkbookNamespaceCounterRecordRevision, PackageWorkbookCounterRecordRevision>
>;
type _WorkbookNamespaceExportsBranchFastForwardOptions = Assert<
  IsEqual<WorkbookNamespaceFastForwardBranchOptions, PackageWorkbookFastForwardBranchOptions>
>;
type _WorkbookNamespaceExportsBranchUpdateOptions = Assert<
  IsEqual<WorkbookNamespaceUpdateBranchOptions, PackageWorkbookUpdateBranchOptions>
>;
type _WorkbookNamespaceExportsBranchDeleteOptions = Assert<
  IsEqual<WorkbookNamespaceDeleteRefOptions, PackageWorkbookDeleteRefOptions>
>;
type _WorkbookNamespaceFastForwardExpectedRefRevisionIsCounter = Assert<
  IsEqual<
    WorkbookNamespaceFastForwardBranchOptions['expectedRefRevision'],
    WorkbookNamespaceCounterRecordRevision
  >
>;
type _WorkbookNamespaceUpdateExpectedRefRevisionIsCounter = Assert<
  IsEqual<
    WorkbookNamespaceUpdateBranchOptions['expectedRefRevision'],
    WorkbookNamespaceCounterRecordRevision
  >
>;
type _WorkbookNamespaceDeleteExpectedRefRevisionIsRequired = Assert<
  IsEqual<
    undefined extends WorkbookNamespaceDeleteRefOptions['expectedRefRevision'] ? true : false,
    false
  >
>;
type _WorkbookNamespaceDeleteExpectedRefRevisionRejectsOpaque = Assert<
  IsEqual<
    IsAssignable<OpaqueRecordRevision, WorkbookNamespaceDeleteRefOptions['expectedRefRevision']>,
    false
  >
>;
type _WorkbookNamespaceExportsBranchRead = Assert<
  IsEqual<WorkbookNamespaceBranchRefReadResult, PackageWorkbookBranchRefReadResult>
>;
type _WorkbookNamespaceExportsRefRead = Assert<
  IsEqual<WorkbookNamespaceRefReadResult, PackageWorkbookRefReadResult>
>;
type _WorkbookNamespaceExportsSymbolicRefRead = Assert<
  IsEqual<WorkbookNamespaceSymbolicRefReadResult, PackageWorkbookSymbolicRefReadResult>
>;
type _WorkbookNamespaceExportsBranchMutation = Assert<
  IsEqual<WorkbookNamespaceRefMutationResult, PackageWorkbookRefMutationResult>
>;
type _WorkbookNamespaceExportsRevertInput = Assert<
  IsEqual<WorkbookNamespaceRevertInput, PackageWorkbookRevertInput>
>;
type _WorkbookNamespaceExportsRevertOptions = Assert<
  IsEqual<WorkbookNamespaceRevertOptions, PackageWorkbookRevertOptions>
>;
type _WorkbookNamespaceExportsRevertResult = Assert<
  IsEqual<WorkbookNamespaceRevertResult, PackageWorkbookRevertResult>
>;
type _WorkbookNamespaceExportsStoreDiagnostic = Assert<
  IsEqual<WorkbookNamespaceStoreDiagnostic, PackageWorkbookStoreDiagnostic>
>;
type _WorkbookNamespaceExportsSurfaceDiagnosticCode = Assert<
  IsEqual<WorkbookNamespaceSurfaceDiagnosticCode, PackageWorkbookSurfaceDiagnosticCode>
>;
type _WorkbookNamespaceExportsWorkbookVersionDiagnosticCode = Assert<
  IsEqual<WorkbookNamespaceVersionDiagnosticCode, PackageWorkbookVersionDiagnosticCode>
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
type _ApiRootExportsAgentProposal = Assert<IsEqual<ApiRootAgentProposal, PackageApiAgentProposal>>;
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
type _ApiRootExportsCommitOptions = Assert<IsEqual<ApiRootCommitOptions, PackageApiCommitOptions>>;
type _ApiRootExportsCommitExpectedHead = Assert<
  IsEqual<ApiRootCommitExpectedHead, PackageApiCommitExpectedHead>
>;
type _ApiRootExportsCommitMode = Assert<IsEqual<ApiRootCommitMode, PackageApiCommitMode>>;
type _ApiRootExportsDiffEntry = Assert<IsEqual<ApiRootDiffEntry, PackageApiDiffEntry>>;
type _ApiRootExportsMergeConflict = Assert<IsEqual<ApiRootMergeConflict, PackageApiMergeConflict>>;
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
type _ApiRootExportsCounterRecordRevision = Assert<
  IsEqual<ApiRootCounterRecordRevision, PackageApiCounterRecordRevision>
>;
type _ApiRootExportsBranchFastForwardOptions = Assert<
  IsEqual<ApiRootFastForwardBranchOptions, PackageApiFastForwardBranchOptions>
>;
type _ApiRootExportsBranchUpdateOptions = Assert<
  IsEqual<ApiRootUpdateBranchOptions, PackageApiUpdateBranchOptions>
>;
type _ApiRootExportsBranchDeleteOptions = Assert<
  IsEqual<ApiRootDeleteRefOptions, PackageApiDeleteRefOptions>
>;
type _ApiRootFastForwardExpectedRefRevisionIsCounter = Assert<
  IsEqual<ApiRootFastForwardBranchOptions['expectedRefRevision'], ApiRootCounterRecordRevision>
>;
type _ApiRootDeleteExpectedRefRevisionIsRequired = Assert<
  IsEqual<undefined extends ApiRootDeleteRefOptions['expectedRefRevision'] ? true : false, false>
>;
type _ApiRootDeleteExpectedRefRevisionRejectsOpaque = Assert<
  IsEqual<IsAssignable<OpaqueRecordRevision, ApiRootDeleteRefOptions['expectedRefRevision']>, false>
>;
type _ApiRootExportsBranchRead = Assert<
  IsEqual<ApiRootBranchRefReadResult, PackageApiBranchRefReadResult>
>;
type _ApiRootExportsRefRead = Assert<IsEqual<ApiRootRefReadResult, PackageApiRefReadResult>>;
type _ApiRootExportsSymbolicRefRead = Assert<
  IsEqual<ApiRootSymbolicRefReadResult, PackageApiSymbolicRefReadResult>
>;
type _ApiRootExportsBranchMutation = Assert<
  IsEqual<ApiRootRefMutationResult, PackageApiRefMutationResult>
>;
type _ApiRootExportsRevertInput = Assert<IsEqual<ApiRootRevertInput, PackageApiRevertInput>>;
type _ApiRootExportsRevertOptions = Assert<IsEqual<ApiRootRevertOptions, PackageApiRevertOptions>>;
type _ApiRootExportsRevertResult = Assert<IsEqual<ApiRootRevertResult, PackageApiRevertResult>>;
type _ApiRootExportsStoreDiagnostic = Assert<
  IsEqual<ApiRootStoreDiagnostic, PackageApiStoreDiagnostic>
>;
type _ApiRootExportsSurfaceDiagnosticCode = Assert<
  IsEqual<ApiRootSurfaceDiagnosticCode, PackageApiSurfaceDiagnosticCode>
>;
type _ApiRootExportsWorkbookVersionDiagnosticCode = Assert<
  IsEqual<ApiRootWorkbookVersionDiagnosticCode, PackageApiWorkbookVersionDiagnosticCode>
>;
type _ApiRootExportsSemanticValue = Assert<IsEqual<ApiRootSemanticValue, PackageApiSemanticValue>>;
type _ApiRootExportsRedactionPolicy = Assert<
  IsEqual<ApiRootRedactionPolicy, PackageApiRedactionPolicy>
>;
