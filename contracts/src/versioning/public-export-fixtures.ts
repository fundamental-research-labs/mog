import type {
  AcceptAgentProposalInput as ContractsApiAcceptAgentProposalInput,
  AgentProposal as ContractsApiAgentProposal,
  AgentProposalAcceptResolutionPolicy as ContractsApiAgentProposalAcceptResolutionPolicy,
  AgentProposalAcceptResult as ContractsApiAgentProposalAcceptResult,
  AgentProposalId as ContractsApiAgentProposalId,
  AgentProposalStatus as ContractsApiAgentProposalStatus,
  AgentProposalSummary as ContractsApiAgentProposalSummary,
  AgentProposalWorkspaceHandle as ContractsApiAgentProposalWorkspaceHandle,
  AgentProposalWorkspaceSession as ContractsApiAgentProposalWorkspaceSession,
  CommitProposalWorkspaceInput as ContractsApiCommitProposalWorkspaceInput,
  Paged as ContractsApiPaged,
  CreateAgentProposalInput as ContractsApiCreateAgentProposalInput,
  RedactionPolicy as ContractsApiRedactionPolicy,
  DisposeProposalWorkspaceInput as ContractsApiDisposeProposalWorkspaceInput,
  FailAgentProposalInput as ContractsApiFailAgentProposalInput,
  GetAgentProposalInput as ContractsApiGetAgentProposalInput,
  GetProposalWorkspaceInput as ContractsApiGetProposalWorkspaceInput,
  ListAgentProposalsInput as ContractsApiListAgentProposalsInput,
  MarkAgentProposalVerifiedInput as ContractsApiMarkAgentProposalVerifiedInput,
  OpenProposalReviewInput as ContractsApiOpenProposalReviewInput,
  RejectAgentProposalInput as ContractsApiRejectAgentProposalInput,
  StartProposalWorkspaceInput as ContractsApiStartProposalWorkspaceInput,
  SupersedeAgentProposalInput as ContractsApiSupersedeAgentProposalInput,
  VersionCapabilityError as ContractsApiCapabilityError,
  CheckoutVersionResult as ContractsApiCheckoutVersionResult,
  VersionBranchRefReadResult as ContractsApiBranchRefReadResult,
  VersionCheckoutMutationGuarantee as ContractsApiCheckoutMutationGuarantee,
  VersionCheckoutResult as ContractsApiCheckoutResult,
  VersionCheckoutTarget as ContractsApiCheckoutTarget,
  VersionCommitOptions as ContractsApiCommitOptions,
  VersionCreateBranchOptions as ContractsApiCreateBranchOptions,
  VersionDiffEntry as ContractsApiDiffEntry,
  VersionGetMergeConflictDetailRequest as ContractsApiGetMergeConflictDetailRequest,
  VersionPendingRemoteSegmentId as ContractsApiPendingRemoteSegmentId,
  VersionPromotePendingRemoteDiagnostic as ContractsApiPromotePendingRemoteDiagnostic,
  VersionPromotePendingRemoteDiagnosticCode as ContractsApiPromotePendingRemoteDiagnosticCode,
  VersionPromotePendingRemoteOptions as ContractsApiPromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult as ContractsApiPromotePendingRemoteResult,
  VersionPromotePendingRemoteSkippedSegment as ContractsApiPromotePendingRemoteSkippedSegment,
  VersionPromotePendingRemoteSkipReason as ContractsApiPromotePendingRemoteSkipReason,
  VersionPromotePendingRemoteStatus as ContractsApiPromotePendingRemoteStatus,
  VersionProposalApi as ContractsApiVersionProposalApi,
  VersionPutMergeResolutionPayloadResult as ContractsApiPutMergeResolutionPayloadResult,
  VersionRefMutationResult as ContractsApiRefMutationResult,
  VersionResult as ContractsApiVersionResult,
  VersionSaveMergeResolutionsRequest as ContractsApiSaveMergeResolutionsRequest,
  VersionHead as ContractsApiVersionHead,
  VersionSemanticDiffPage as ContractsApiSemanticDiffPage,
  VersionSemanticValue as ContractsApiSemanticValue,
  VersionSealedResolutionPayloadRef as ContractsApiSealedResolutionPayloadRef,
  VersionStoreDiagnostic as ContractsApiStoreDiagnostic,
  Workbook as ContractsApiWorkbook,
  WorkbookDiffPage as ContractsApiDiffPage,
  WorkbookVersion as ContractsApiWorkbookVersion,
  WorkbookVersionStatus as ContractsApiWorkbookVersionStatus,
  MogWorkbookVersionXlsxMetadataTrustResult as ContractsApiMogWorkbookVersionXlsxMetadataTrustResult,
  Vc10XlsxInteropDiagnostic as ContractsApiVc10XlsxInteropDiagnostic,
  XlsxExternalChangeBranchRecord as ContractsApiXlsxExternalChangeBranchRecord,
  XlsxVersionImportRootProvenance as ContractsApiXlsxVersionImportRootProvenance,
} from '@mog-sdk/contracts/api';
import type {
  AcceptAgentProposalInput as ContractsWorkbookAcceptAgentProposalInput,
  AgentProposal as ContractsWorkbookAgentProposal,
  AgentProposalAcceptResolutionPolicy as ContractsWorkbookAgentProposalAcceptResolutionPolicy,
  AgentProposalAcceptResult as ContractsWorkbookAgentProposalAcceptResult,
  AgentProposalId as ContractsWorkbookAgentProposalId,
  AgentProposalStatus as ContractsWorkbookAgentProposalStatus,
  AgentProposalSummary as ContractsWorkbookAgentProposalSummary,
  AgentProposalWorkspaceHandle as ContractsWorkbookAgentProposalWorkspaceHandle,
  AgentProposalWorkspaceSession as ContractsWorkbookAgentProposalWorkspaceSession,
  CommitProposalWorkspaceInput as ContractsWorkbookCommitProposalWorkspaceInput,
  Paged as ContractsWorkbookPaged,
  CreateAgentProposalInput as ContractsWorkbookCreateAgentProposalInput,
  RedactionPolicy as ContractsWorkbookRedactionPolicy,
  DisposeProposalWorkspaceInput as ContractsWorkbookDisposeProposalWorkspaceInput,
  FailAgentProposalInput as ContractsWorkbookFailAgentProposalInput,
  GetAgentProposalInput as ContractsWorkbookGetAgentProposalInput,
  GetProposalWorkspaceInput as ContractsWorkbookGetProposalWorkspaceInput,
  ListAgentProposalsInput as ContractsWorkbookListAgentProposalsInput,
  MarkAgentProposalVerifiedInput as ContractsWorkbookMarkAgentProposalVerifiedInput,
  OpenProposalReviewInput as ContractsWorkbookOpenProposalReviewInput,
  RejectAgentProposalInput as ContractsWorkbookRejectAgentProposalInput,
  StartProposalWorkspaceInput as ContractsWorkbookStartProposalWorkspaceInput,
  SupersedeAgentProposalInput as ContractsWorkbookSupersedeAgentProposalInput,
  VersionCapabilityError as ContractsWorkbookCapabilityError,
  CheckoutVersionResult as ContractsWorkbookCheckoutVersionResult,
  VersionBranchRefReadResult as ContractsWorkbookBranchRefReadResult,
  VersionCheckoutMutationGuarantee as ContractsWorkbookCheckoutMutationGuarantee,
  VersionCheckoutResult as ContractsWorkbookCheckoutResult,
  VersionCheckoutTarget as ContractsWorkbookCheckoutTarget,
  VersionCommitOptions as ContractsWorkbookCommitOptions,
  VersionCreateBranchOptions as ContractsWorkbookCreateBranchOptions,
  VersionDiffEntry as ContractsWorkbookDiffEntry,
  VersionGetMergeConflictDetailRequest as ContractsWorkbookGetMergeConflictDetailRequest,
  VersionPendingRemoteSegmentId as ContractsWorkbookPendingRemoteSegmentId,
  VersionPromotePendingRemoteDiagnostic as ContractsWorkbookPromotePendingRemoteDiagnostic,
  VersionPromotePendingRemoteDiagnosticCode as ContractsWorkbookPromotePendingRemoteDiagnosticCode,
  VersionPromotePendingRemoteOptions as ContractsWorkbookPromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult as ContractsWorkbookPromotePendingRemoteResult,
  VersionPromotePendingRemoteSkippedSegment as ContractsWorkbookPromotePendingRemoteSkippedSegment,
  VersionPromotePendingRemoteSkipReason as ContractsWorkbookPromotePendingRemoteSkipReason,
  VersionPromotePendingRemoteStatus as ContractsWorkbookPromotePendingRemoteStatus,
  VersionProposalApi as ContractsWorkbookVersionProposalApi,
  VersionPutMergeResolutionPayloadResult as ContractsWorkbookPutMergeResolutionPayloadResult,
  VersionRefMutationResult as ContractsWorkbookRefMutationResult,
  VersionResult as ContractsWorkbookVersionResult,
  VersionSaveMergeResolutionsRequest as ContractsWorkbookSaveMergeResolutionsRequest,
  VersionHead as ContractsWorkbookVersionHead,
  VersionSemanticDiffPage as ContractsWorkbookSemanticDiffPage,
  VersionSemanticValue as ContractsWorkbookSemanticValue,
  VersionSealedResolutionPayloadRef as ContractsWorkbookSealedResolutionPayloadRef,
  VersionStoreDiagnostic as ContractsWorkbookStoreDiagnostic,
  WorkbookDiffPage as ContractsWorkbookDiffPage,
  WorkbookVersion as ContractsWorkbookVersion,
  WorkbookVersionStatus as ContractsWorkbookVersionStatus,
  MogWorkbookVersionXlsxMetadataTrustResult as ContractsWorkbookMogWorkbookVersionXlsxMetadataTrustResult,
  Vc10XlsxInteropDiagnostic as ContractsWorkbookVc10XlsxInteropDiagnostic,
  XlsxExternalChangeBranchRecord as ContractsWorkbookXlsxExternalChangeBranchRecord,
  XlsxVersionImportRootProvenance as ContractsWorkbookXlsxVersionImportRootProvenance,
} from '@mog-sdk/contracts/api/workbook';
import type {
  CapturePolicy,
  DomainCapabilityPolicyManifest,
  DomainMutationReceipt,
  EmergencyDisablePolicy,
  ObjectDigest,
  PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS as ContractsVersioningDomainExportRequiredMatrixRowIds,
  PUBLIC_VERSION_DOMAIN_POLICY_IDS as ContractsVersioningDomainPolicyIds,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY as ContractsVersioningDomainPolicyRegistry,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_ALL_ROWS as ContractsVersioningDomainPolicyRegistryExportSupportsAllRows,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_REQUIRED_ROWS as ContractsVersioningDomainPolicyRegistryExportSupportsRequiredRows,
  PUBLIC_VERSION_DOMAIN_POLICY_ROW_COUNT as ContractsVersioningDomainPolicyRowCount,
  VERSION_MUTATION_SEGMENT_FIELD_NAMES as ContractsVersioningMutationSegmentFieldNames,
  VERSION_PUBLIC_CONTRACT_PRIVATE_FIELD_DENY_LIST as ContractsVersioningPrivateFieldDenyList,
  VERSION_RUNTIME_OPERATION_CONTEXT_FIELD_NAMES as ContractsVersioningRuntimeOperationContextFieldNames,
  ReleaseArtifactManifest,
  VersionAgentProposalAcceptResolutionPolicy,
  VersionAgentProposalAcceptResult as VersioningAgentProposalAcceptResult,
  VersionAgentProposalEvent,
  VersionAgentProposalId as VersioningAgentProposalId,
  VersionAgentProposalRecord,
  VersionAgentProposalStatus,
  VersionAgentProposalSummary,
  VersionAppendAgentProposalEventInput,
  VersionAuthor,
  VersionDomainCapabilityStateMap,
  VersionDomainCapabilityState,
  VersionDomainPolicyRegistry,
  VersionExportMetadataSummary,
  VersionJsonValue,
  VersionMergePreviewRecord,
  VersionMergePreviewRecordStatus,
  VersionMetadataDiagnostic,
  MogWorkbookVersionXlsxCommitId,
  MogWorkbookVersionXlsxDiagnosticPublicPayload,
  MogWorkbookVersionXlsxImportRootProvenance,
  MogWorkbookVersionXlsxImportRootSource,
  MogWorkbookVersionXlsxMetadata,
  MogWorkbookVersionXlsxMetadataExpectedHead,
  MogWorkbookVersionXlsxMetadataHead,
  MogWorkbookVersionXlsxMetadataPart,
  MogWorkbookVersionXlsxMetadataRedactionPolicy,
  MogWorkbookVersionXlsxMetadataSchemaVersion,
  MogWorkbookVersionXlsxMetadataTrustContext,
  MogWorkbookVersionXlsxMetadataTrustReason,
  MogWorkbookVersionXlsxMetadataTrustResult,
  MogWorkbookVersionXlsxMetadataTrustStatus,
  MogWorkbookVersionXlsxMetadataTrustSummary,
  MogWorkbookVersionXlsxObjectDigest,
  MogWorkbookVersionXlsxRefRevision,
  Vc10XlsxInteropDiagnostic,
  VersionMutationSegment,
  VersionObjectHeader,
  VersionObjectKind,
  VersionOperationContext,
  VersionPendingRemotePromotionDiagnostic,
  VersionPendingRemotePromotionDiagnosticCode,
  VersionPendingRemotePromotionResultMetadata,
  VersionPendingRemotePromotionSkipReason,
  VersionPendingRemotePromotionSkippedSegment,
  VersionPendingRemotePromotionStatus,
  VersionPendingRemoteSegmentId as VersioningPendingRemoteSegmentId,
  VersionProposalVerificationSummary,
  VersionRuntimeOperationContext,
  VersionShadowObservationRecord,
  VersionShadowObservationSink,
  VersionSyncOperationContext,
  VersionSyncProvenanceEnvelope,
  VersionWriteAdmissionMode,
  WorkbookCommitPersistedShape,
  XlsxExternalChangeBranchRecord,
  XlsxVersionImportRootProvenance,
} from '@mog-sdk/contracts/versioning';
import {
  PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS,
  PUBLIC_VERSION_DOMAIN_POLICY_IDS,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_ALL_ROWS,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_REQUIRED_ROWS,
  PUBLIC_VERSION_DOMAIN_POLICY_ROW_COUNT,
} from './domain-policy-registry';
import { VERSIONING_CONTRACT_FIXTURES } from './fixtures';
import {
  VERSION_MUTATION_SEGMENT_FIELD_NAMES,
  VERSION_PUBLIC_CONTRACT_PRIVATE_FIELD_DENY_LIST,
  VERSION_RUNTIME_OPERATION_CONTEXT_FIELD_NAMES,
} from './runtime-contracts';

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type _ContractsApiWorkbookEntryExportsVersionApi = Assert<
  IsEqual<ContractsApiWorkbookVersion, ContractsWorkbookVersion>
>;
type _ContractsApiWorkbookEntryExportsStatus = Assert<
  IsEqual<ContractsApiWorkbookVersionStatus, ContractsWorkbookVersionStatus>
>;
type _ContractsApiWorkbookEntryExportsAgentProposalId = Assert<
  IsEqual<ContractsApiAgentProposalId, ContractsWorkbookAgentProposalId>
>;
type _ContractsApiWorkbookEntryExportsAgentProposalStatus = Assert<
  IsEqual<ContractsApiAgentProposalStatus, ContractsWorkbookAgentProposalStatus>
>;
type _ContractsApiWorkbookEntryExportsAgentProposal = Assert<
  IsEqual<ContractsApiAgentProposal, ContractsWorkbookAgentProposal>
>;
type _ContractsApiWorkbookEntryExportsAgentProposalSummary = Assert<
  IsEqual<ContractsApiAgentProposalSummary, ContractsWorkbookAgentProposalSummary>
>;
type _ContractsApiWorkbookEntryExportsAgentProposalWorkspaceHandle = Assert<
  IsEqual<ContractsApiAgentProposalWorkspaceHandle, ContractsWorkbookAgentProposalWorkspaceHandle>
>;
type _ContractsApiWorkbookEntryExportsAgentProposalWorkspaceSession = Assert<
  IsEqual<ContractsApiAgentProposalWorkspaceSession, ContractsWorkbookAgentProposalWorkspaceSession>
>;
type _ContractsApiWorkbookEntryExportsAgentProposalAcceptResolutionPolicy = Assert<
  IsEqual<
    ContractsApiAgentProposalAcceptResolutionPolicy,
    ContractsWorkbookAgentProposalAcceptResolutionPolicy
  >
>;
type _ContractsApiWorkbookEntryExportsAgentProposalAcceptResult = Assert<
  IsEqual<ContractsApiAgentProposalAcceptResult, ContractsWorkbookAgentProposalAcceptResult>
>;
type _ContractsApiWorkbookEntryExportsCreateAgentProposalInput = Assert<
  IsEqual<ContractsApiCreateAgentProposalInput, ContractsWorkbookCreateAgentProposalInput>
>;
type _ContractsApiWorkbookEntryExportsStartProposalWorkspaceInput = Assert<
  IsEqual<ContractsApiStartProposalWorkspaceInput, ContractsWorkbookStartProposalWorkspaceInput>
>;
type _ContractsApiWorkbookEntryExportsCommitProposalWorkspaceInput = Assert<
  IsEqual<ContractsApiCommitProposalWorkspaceInput, ContractsWorkbookCommitProposalWorkspaceInput>
>;
type _ContractsApiWorkbookEntryExportsGetProposalWorkspaceInput = Assert<
  IsEqual<ContractsApiGetProposalWorkspaceInput, ContractsWorkbookGetProposalWorkspaceInput>
>;
type _ContractsApiWorkbookEntryExportsDisposeProposalWorkspaceInput = Assert<
  IsEqual<ContractsApiDisposeProposalWorkspaceInput, ContractsWorkbookDisposeProposalWorkspaceInput>
>;
type _ContractsApiWorkbookEntryExportsFailAgentProposalInput = Assert<
  IsEqual<ContractsApiFailAgentProposalInput, ContractsWorkbookFailAgentProposalInput>
>;
type _ContractsApiWorkbookEntryExportsGetAgentProposalInput = Assert<
  IsEqual<ContractsApiGetAgentProposalInput, ContractsWorkbookGetAgentProposalInput>
>;
type _ContractsApiWorkbookEntryExportsListAgentProposalsInput = Assert<
  IsEqual<ContractsApiListAgentProposalsInput, ContractsWorkbookListAgentProposalsInput>
>;
type _ContractsApiWorkbookEntryExportsMarkAgentProposalVerifiedInput = Assert<
  IsEqual<
    ContractsApiMarkAgentProposalVerifiedInput,
    ContractsWorkbookMarkAgentProposalVerifiedInput
  >
>;
type _ContractsApiWorkbookEntryExportsOpenProposalReviewInput = Assert<
  IsEqual<ContractsApiOpenProposalReviewInput, ContractsWorkbookOpenProposalReviewInput>
>;
type _ContractsApiWorkbookEntryExportsAcceptAgentProposalInput = Assert<
  IsEqual<ContractsApiAcceptAgentProposalInput, ContractsWorkbookAcceptAgentProposalInput>
>;
type _ContractsApiWorkbookEntryExportsRejectAgentProposalInput = Assert<
  IsEqual<ContractsApiRejectAgentProposalInput, ContractsWorkbookRejectAgentProposalInput>
>;
type _ContractsApiWorkbookEntryExportsSupersedeAgentProposalInput = Assert<
  IsEqual<ContractsApiSupersedeAgentProposalInput, ContractsWorkbookSupersedeAgentProposalInput>
>;
type _ContractsApiWorkbookEntryExportsVersionProposalApi = Assert<
  IsEqual<ContractsApiVersionProposalApi, ContractsWorkbookVersionProposalApi>
>;
type _ContractsApiWorkbookEntryExportsCommit = Assert<
  IsEqual<ContractsApiCommitOptions, ContractsWorkbookCommitOptions>
>;
type _ContractsApiWorkbookEntryExportsStoreDiagnostic = Assert<
  IsEqual<ContractsApiStoreDiagnostic, ContractsWorkbookStoreDiagnostic>
>;
type _ContractsApiWorkbookEntryExportsDiffEntry = Assert<
  IsEqual<ContractsApiDiffEntry, ContractsWorkbookDiffEntry>
>;
type _ContractsApiWorkbookEntryExportsDiffPage = Assert<
  IsEqual<ContractsApiDiffPage, ContractsWorkbookDiffPage>
>;
type _ContractsApiWorkbookEntryExportsCheckoutTarget = Assert<
  IsEqual<ContractsApiCheckoutTarget, ContractsWorkbookCheckoutTarget>
>;
type _ContractsApiWorkbookEntryExportsCheckoutResult = Assert<
  IsEqual<ContractsApiCheckoutResult, ContractsWorkbookCheckoutResult>
>;
type _ContractsApiWorkbookEntryExportsCheckoutVersionResult = Assert<
  IsEqual<ContractsApiCheckoutVersionResult, ContractsWorkbookCheckoutVersionResult>
>;
type _ContractsApiWorkbookEntryExportsCheckoutGuarantee = Assert<
  IsEqual<ContractsApiCheckoutMutationGuarantee, ContractsWorkbookCheckoutMutationGuarantee>
>;
type _ContractsApiWorkbookEntryExportsBranchCreate = Assert<
  IsEqual<ContractsApiCreateBranchOptions, ContractsWorkbookCreateBranchOptions>
>;
type _ContractsApiWorkbookEntryExportsBranchRead = Assert<
  IsEqual<ContractsApiBranchRefReadResult, ContractsWorkbookBranchRefReadResult>
>;
type _ContractsApiWorkbookEntryExportsBranchMutation = Assert<
  IsEqual<ContractsApiRefMutationResult, ContractsWorkbookRefMutationResult>
>;
type _ContractsApiWorkbookEntryExportsSemanticValue = Assert<
  IsEqual<ContractsApiSemanticValue, ContractsWorkbookSemanticValue>
>;
type _ContractsApiWorkbookEntryExportsRedactionPolicy = Assert<
  IsEqual<ContractsApiRedactionPolicy, ContractsWorkbookRedactionPolicy>
>;
type _ContractsApiWorkbookEntryExportsCapabilityError = Assert<
  IsEqual<ContractsApiCapabilityError, ContractsWorkbookCapabilityError>
>;
type _ContractsApiWorkbookEntryExportsVersionResult = Assert<
  IsEqual<ContractsApiVersionResult<string>, ContractsWorkbookVersionResult<string>>
>;
type _ContractsApiWorkbookEntryExportsVersionHead = Assert<
  IsEqual<ContractsApiVersionHead, ContractsWorkbookVersionHead>
>;
type _ContractsApiWorkbookEntryExportsSemanticDiffPage = Assert<
  IsEqual<ContractsApiSemanticDiffPage, ContractsWorkbookSemanticDiffPage>
>;
type _ContractsApiWorkbookEntryExportsPaged = Assert<
  IsEqual<ContractsApiPaged<string>, ContractsWorkbookPaged<string>>
>;
type _ContractsApiWorkbookEntryExportsSaveMergeResolutionsRequest = Assert<
  IsEqual<ContractsApiSaveMergeResolutionsRequest, ContractsWorkbookSaveMergeResolutionsRequest>
>;
type _ContractsApiWorkbookEntryExportsGetMergeConflictDetailRequest = Assert<
  IsEqual<ContractsApiGetMergeConflictDetailRequest, ContractsWorkbookGetMergeConflictDetailRequest>
>;
type _ContractsApiWorkbookEntryExportsPutMergeResolutionPayloadResult = Assert<
  IsEqual<
    ContractsApiPutMergeResolutionPayloadResult,
    ContractsWorkbookPutMergeResolutionPayloadResult
  >
>;
type _ContractsApiWorkbookEntryExportsSealedResolutionPayloadRef = Assert<
  IsEqual<ContractsApiSealedResolutionPayloadRef, ContractsWorkbookSealedResolutionPayloadRef>
>;
type _ContractsApiWorkbookEntryExportsPendingRemoteSegmentId = Assert<
  IsEqual<ContractsApiPendingRemoteSegmentId, ContractsWorkbookPendingRemoteSegmentId>
>;
type _ContractsApiWorkbookEntryExportsPromotePendingRemoteOptions = Assert<
  IsEqual<ContractsApiPromotePendingRemoteOptions, ContractsWorkbookPromotePendingRemoteOptions>
>;
type _ContractsApiWorkbookEntryExportsPromotePendingRemoteResult = Assert<
  IsEqual<ContractsApiPromotePendingRemoteResult, ContractsWorkbookPromotePendingRemoteResult>
>;
type _ContractsApiWorkbookEntryExportsPromotePendingRemoteSkippedSegment = Assert<
  IsEqual<
    ContractsApiPromotePendingRemoteSkippedSegment,
    ContractsWorkbookPromotePendingRemoteSkippedSegment
  >
>;
type _ContractsApiWorkbookEntryExportsPromotePendingRemoteStatus = Assert<
  IsEqual<ContractsApiPromotePendingRemoteStatus, ContractsWorkbookPromotePendingRemoteStatus>
>;
type _ContractsApiWorkbookEntryExportsPromotePendingRemoteSkipReason = Assert<
  IsEqual<
    ContractsApiPromotePendingRemoteSkipReason,
    ContractsWorkbookPromotePendingRemoteSkipReason
  >
>;
type _ContractsApiWorkbookEntryExportsPromotePendingRemoteDiagnostic = Assert<
  IsEqual<
    ContractsApiPromotePendingRemoteDiagnostic,
    ContractsWorkbookPromotePendingRemoteDiagnostic
  >
>;
type _ContractsApiWorkbookEntryExportsPromotePendingRemoteDiagnosticCode = Assert<
  IsEqual<
    ContractsApiPromotePendingRemoteDiagnosticCode,
    ContractsWorkbookPromotePendingRemoteDiagnosticCode
  >
>;
type _ContractsApiWorkbookEntryExportsXlsxTrustResult = Assert<
  IsEqual<
    ContractsApiMogWorkbookVersionXlsxMetadataTrustResult,
    ContractsWorkbookMogWorkbookVersionXlsxMetadataTrustResult
  >
>;
type _ContractsApiWorkbookEntryExportsXlsxVersionImportRootProvenance = Assert<
  IsEqual<
    ContractsApiXlsxVersionImportRootProvenance,
    ContractsWorkbookXlsxVersionImportRootProvenance
  >
>;
type _ContractsApiWorkbookEntryExportsVc10XlsxInteropDiagnostic = Assert<
  IsEqual<ContractsApiVc10XlsxInteropDiagnostic, ContractsWorkbookVc10XlsxInteropDiagnostic>
>;
type _ContractsApiWorkbookEntryExportsXlsxExternalChangeBranchRecord = Assert<
  IsEqual<
    ContractsApiXlsxExternalChangeBranchRecord,
    ContractsWorkbookXlsxExternalChangeBranchRecord
  >
>;
type _ContractsApiXlsxTrustResultMatchesVersioning = Assert<
  IsEqual<
    ContractsApiMogWorkbookVersionXlsxMetadataTrustResult,
    MogWorkbookVersionXlsxMetadataTrustResult
  >
>;
type _ContractsApiXlsxVersionImportRootProvenanceMatchesVersioning = Assert<
  IsEqual<ContractsApiXlsxVersionImportRootProvenance, XlsxVersionImportRootProvenance>
>;
type _ContractsApiVc10XlsxInteropDiagnosticMatchesVersioning = Assert<
  IsEqual<ContractsApiVc10XlsxInteropDiagnostic, Vc10XlsxInteropDiagnostic>
>;
type _ContractsApiXlsxExternalChangeBranchRecordMatchesVersioning = Assert<
  IsEqual<ContractsApiXlsxExternalChangeBranchRecord, XlsxExternalChangeBranchRecord>
>;
type _ContractsVersioningExportsDomainPolicyRegistryValue = Assert<
  IsEqual<
    typeof ContractsVersioningDomainPolicyRegistry,
    typeof PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY
  >
>;
type _ContractsVersioningExportsDomainPolicyIdsValue = Assert<
  IsEqual<typeof ContractsVersioningDomainPolicyIds, typeof PUBLIC_VERSION_DOMAIN_POLICY_IDS>
>;
type _ContractsVersioningExportsDomainPolicyRowCountValue = Assert<
  IsEqual<
    typeof ContractsVersioningDomainPolicyRowCount,
    typeof PUBLIC_VERSION_DOMAIN_POLICY_ROW_COUNT
  >
>;
type _ContractsVersioningExportsDomainExportRequiredRowsValue = Assert<
  IsEqual<
    typeof ContractsVersioningDomainExportRequiredMatrixRowIds,
    typeof PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS
  >
>;
type _ContractsVersioningExportsDomainPolicyRequiredExportSupportValue = Assert<
  IsEqual<
    typeof ContractsVersioningDomainPolicyRegistryExportSupportsRequiredRows,
    typeof PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_REQUIRED_ROWS
  >
>;
type _ContractsVersioningExportsDomainPolicyAllRowsExportSupportValue = Assert<
  IsEqual<
    typeof ContractsVersioningDomainPolicyRegistryExportSupportsAllRows,
    typeof PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_ALL_ROWS
  >
>;
type _ContractsVersioningExportsRuntimeContractValues = Assert<
  IsEqual<
    [
      typeof ContractsVersioningRuntimeOperationContextFieldNames,
      typeof ContractsVersioningMutationSegmentFieldNames,
      typeof ContractsVersioningPrivateFieldDenyList,
    ],
    [
      typeof VERSION_RUNTIME_OPERATION_CONTEXT_FIELD_NAMES,
      typeof VERSION_MUTATION_SEGMENT_FIELD_NAMES,
      typeof VERSION_PUBLIC_CONTRACT_PRIVATE_FIELD_DENY_LIST,
    ]
  >
>;

const PUBLIC_DOMAIN_POLICY_INTERNAL_FIELD_NAMES = Object.freeze([
  'ownerWorkstream',
  'requiredOracles',
  'requiredOracleByCapability',
  'supportEvidenceByCapability',
  'scenarioIds',
  'notes',
  'reportPath',
  'acceptedRisk',
  'evidenceDigest',
] as const);
type PublicDomainPolicyInternalFieldName =
  (typeof PUBLIC_DOMAIN_POLICY_INTERNAL_FIELD_NAMES)[number];
type _DomainCapabilityPolicyManifestHasNoInternalOracleFields = Assert<
  IsEqual<Extract<keyof DomainCapabilityPolicyManifest, PublicDomainPolicyInternalFieldName>, never>
>;

type PublicVersionApiSurface = {
  readonly workbook: ContractsApiWorkbook;
  readonly version: ContractsApiWorkbookVersion;
  readonly status: ContractsApiWorkbookVersionStatus;
  readonly agentProposalId: ContractsApiAgentProposalId;
  readonly agentProposalStatus: ContractsApiAgentProposalStatus;
  readonly agentProposal: ContractsApiAgentProposal;
  readonly agentProposalSummary: ContractsApiAgentProposalSummary;
  readonly agentProposalWorkspaceHandle: ContractsApiAgentProposalWorkspaceHandle;
  readonly agentProposalWorkspaceSession: ContractsApiAgentProposalWorkspaceSession;
  readonly agentProposalAcceptResolutionPolicy: ContractsApiAgentProposalAcceptResolutionPolicy;
  readonly agentProposalAcceptResult: ContractsApiAgentProposalAcceptResult;
  readonly createAgentProposalInput: ContractsApiCreateAgentProposalInput;
  readonly startProposalWorkspaceInput: ContractsApiStartProposalWorkspaceInput;
  readonly commitProposalWorkspaceInput: ContractsApiCommitProposalWorkspaceInput;
  readonly getProposalWorkspaceInput: ContractsApiGetProposalWorkspaceInput;
  readonly disposeProposalWorkspaceInput: ContractsApiDisposeProposalWorkspaceInput;
  readonly failAgentProposalInput: ContractsApiFailAgentProposalInput;
  readonly getAgentProposalInput: ContractsApiGetAgentProposalInput;
  readonly listAgentProposalsInput: ContractsApiListAgentProposalsInput;
  readonly markAgentProposalVerifiedInput: ContractsApiMarkAgentProposalVerifiedInput;
  readonly openProposalReviewInput: ContractsApiOpenProposalReviewInput;
  readonly acceptAgentProposalInput: ContractsApiAcceptAgentProposalInput;
  readonly rejectAgentProposalInput: ContractsApiRejectAgentProposalInput;
  readonly supersedeAgentProposalInput: ContractsApiSupersedeAgentProposalInput;
  readonly proposalApi: ContractsApiVersionProposalApi;
  readonly commit: ContractsApiCommitOptions;
  readonly storeDiagnostic: ContractsApiStoreDiagnostic;
  readonly diffEntry: ContractsApiDiffEntry;
  readonly diffPage: ContractsApiDiffPage;
  readonly checkoutTarget: ContractsApiCheckoutTarget;
  readonly checkoutResult: ContractsApiCheckoutResult;
  readonly checkoutVersionResult: ContractsApiCheckoutVersionResult;
  readonly checkoutGuarantee: ContractsApiCheckoutMutationGuarantee;
  readonly createBranch: ContractsApiCreateBranchOptions;
  readonly branchRead: ContractsApiBranchRefReadResult;
  readonly branchMutation: ContractsApiRefMutationResult;
  readonly semanticValue: ContractsApiSemanticValue;
  readonly redactionPolicy: ContractsApiRedactionPolicy;
  readonly capabilityError: ContractsApiCapabilityError;
  readonly versionResult: ContractsApiVersionResult<string>;
  readonly versionHead: ContractsApiVersionHead;
  readonly semanticDiffPage: ContractsApiSemanticDiffPage;
  readonly saveMergeResolutionsRequest: ContractsApiSaveMergeResolutionsRequest;
  readonly getMergeConflictDetailRequest: ContractsApiGetMergeConflictDetailRequest;
  readonly putMergeResolutionPayloadResult: ContractsApiPutMergeResolutionPayloadResult;
  readonly sealedResolutionPayloadRef: ContractsApiSealedResolutionPayloadRef;
  readonly pendingRemoteSegmentId: ContractsApiPendingRemoteSegmentId;
  readonly promotePendingRemoteOptions: ContractsApiPromotePendingRemoteOptions;
  readonly promotePendingRemoteResult: ContractsApiPromotePendingRemoteResult;
  readonly promotePendingRemoteSkippedSegment: ContractsApiPromotePendingRemoteSkippedSegment;
  readonly promotePendingRemoteStatus: ContractsApiPromotePendingRemoteStatus;
  readonly promotePendingRemoteSkipReason: ContractsApiPromotePendingRemoteSkipReason;
  readonly promotePendingRemoteDiagnostic: ContractsApiPromotePendingRemoteDiagnostic;
  readonly promotePendingRemoteDiagnosticCode: ContractsApiPromotePendingRemoteDiagnosticCode;
  readonly page: ContractsApiPaged<string>;
};

type PublicVersioningDomainPolicySurface = {
  readonly registry: VersionDomainPolicyRegistry;
  readonly policy: DomainCapabilityPolicyManifest;
  readonly capabilityStates: VersionDomainCapabilityStateMap;
  readonly policyIds: readonly string[];
  readonly rowCount: number;
  readonly requiredExportMatrixRowIds: readonly string[];
  readonly requiredRowsExportSupported: boolean;
  readonly allRowsExportSupported: boolean;
  readonly internalOracleFieldLeakCount: 0;
};

type PublicVersioningMetadataSurface = {
  readonly json: VersionJsonValue;
  readonly metadataDiagnostic: VersionMetadataDiagnostic;
  readonly pendingRemoteSegmentId: VersioningPendingRemoteSegmentId;
  readonly pendingRemotePromotionStatus: VersionPendingRemotePromotionStatus;
  readonly pendingRemotePromotionSkipReason: VersionPendingRemotePromotionSkipReason;
  readonly pendingRemotePromotionDiagnosticCode: VersionPendingRemotePromotionDiagnosticCode;
  readonly pendingRemotePromotionDiagnostic: VersionPendingRemotePromotionDiagnostic;
  readonly pendingRemotePromotionSkippedSegment: VersionPendingRemotePromotionSkippedSegment;
  readonly pendingRemotePromotionResultMetadata: VersionPendingRemotePromotionResultMetadata;
  readonly agentProposalId: VersioningAgentProposalId;
  readonly agentProposalStatus: VersionAgentProposalStatus;
  readonly agentProposalSummary: VersionAgentProposalSummary;
  readonly agentProposalAcceptResolutionPolicy: VersionAgentProposalAcceptResolutionPolicy;
  readonly proposalVerificationSummary: VersionProposalVerificationSummary;
  readonly agentProposalAcceptResult: VersioningAgentProposalAcceptResult;
  readonly agentProposalRecord: VersionAgentProposalRecord;
  readonly agentProposalEvent: VersionAgentProposalEvent;
  readonly appendAgentProposalEventInput: VersionAppendAgentProposalEventInput;
  readonly mergePreviewRecordStatus: VersionMergePreviewRecordStatus;
  readonly mergePreviewRecord: VersionMergePreviewRecord;
  readonly releaseArtifactManifest: ReleaseArtifactManifest;
  readonly emergencyDisablePolicy: EmergencyDisablePolicy;
  readonly xlsxMetadataSchemaVersion: MogWorkbookVersionXlsxMetadataSchemaVersion;
  readonly xlsxMetadataPart: MogWorkbookVersionXlsxMetadataPart;
  readonly xlsxCommitId: MogWorkbookVersionXlsxCommitId;
  readonly xlsxObjectDigest: MogWorkbookVersionXlsxObjectDigest;
  readonly xlsxRefRevision: MogWorkbookVersionXlsxRefRevision;
  readonly xlsxDiagnosticPublicPayload: MogWorkbookVersionXlsxDiagnosticPublicPayload;
  readonly xlsxMetadataHead: MogWorkbookVersionXlsxMetadataHead;
  readonly xlsxMetadata: MogWorkbookVersionXlsxMetadata;
  readonly xlsxRedactionPolicy: MogWorkbookVersionXlsxMetadataRedactionPolicy;
  readonly xlsxTrustStatus: MogWorkbookVersionXlsxMetadataTrustStatus;
  readonly xlsxTrustReason: MogWorkbookVersionXlsxMetadataTrustReason;
  readonly xlsxTrustSummary: MogWorkbookVersionXlsxMetadataTrustSummary;
  readonly xlsxExpectedHead: MogWorkbookVersionXlsxMetadataExpectedHead;
  readonly xlsxTrustContext: MogWorkbookVersionXlsxMetadataTrustContext;
  readonly xlsxTrustResult: MogWorkbookVersionXlsxMetadataTrustResult;
  readonly xlsxImportRootSource: MogWorkbookVersionXlsxImportRootSource;
  readonly xlsxImportRootProvenance: MogWorkbookVersionXlsxImportRootProvenance;
  readonly xlsxVersionImportRootProvenance: XlsxVersionImportRootProvenance;
  readonly xlsxInteropDiagnostic: Vc10XlsxInteropDiagnostic;
  readonly xlsxExternalChangeBranchRecord: XlsxExternalChangeBranchRecord;
};

const vc03ExportSurfaceDomainIds = Object.freeze([
  'workbook-metadata',
  'sheets',
  'cells.values',
  'cells.formulas',
  'rows-columns',
] as const);

const contractedCapabilityState: VersionDomainCapabilityState = 'contracted';
const capturePolicy: CapturePolicy = 'commitEligible';
const writeAdmissionMode: VersionWriteAdmissionMode = 'capture';
const publicDomainPolicyRegistry: VersionDomainPolicyRegistry =
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY;

function requirePublicDomainPolicy(matrixRowId: string): DomainCapabilityPolicyManifest {
  const row = publicDomainPolicyRegistry.domains.find(
    (candidate) => candidate.matrixRowId === matrixRowId,
  );
  if (!row) {
    throw new Error(`Missing public version domain policy fixture row: ${matrixRowId}`);
  }
  return row;
}

const publicDomainPolicy = requirePublicDomainPolicy('workbook-metadata');
const publicDomainCapabilityStates: VersionDomainCapabilityStateMap =
  publicDomainPolicy.capabilityStates;
const publicDomainPolicyInternalOracleFieldLeakCount = publicDomainPolicyRegistry.domains.reduce(
  (count, row) => {
    const leakedFieldCount = PUBLIC_DOMAIN_POLICY_INTERNAL_FIELD_NAMES.filter((field) =>
      Object.prototype.hasOwnProperty.call(row, field),
    ).length;
    return count + leakedFieldCount;
  },
  0,
);

if (publicDomainPolicyInternalOracleFieldLeakCount !== 0) {
  throw new Error('Public version domain policy registry contains internal oracle fields.');
}
const publicDomainPolicyInternalOracleFieldLeakCountZero =
  publicDomainPolicyInternalOracleFieldLeakCount as 0;

const publicDomainPolicyExportSurface: PublicVersioningDomainPolicySurface = Object.freeze({
  registry: publicDomainPolicyRegistry,
  policy: publicDomainPolicy,
  capabilityStates: publicDomainCapabilityStates,
  policyIds: PUBLIC_VERSION_DOMAIN_POLICY_IDS,
  rowCount: PUBLIC_VERSION_DOMAIN_POLICY_ROW_COUNT,
  requiredExportMatrixRowIds: PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS,
  requiredRowsExportSupported: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_REQUIRED_ROWS,
  allRowsExportSupported: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_ALL_ROWS,
  internalOracleFieldLeakCount: publicDomainPolicyInternalOracleFieldLeakCountZero,
});
const digest: ObjectDigest = Object.freeze({
  algorithm: 'sha256',
  value: 'sha256:vc03-05-public-export-surface',
});
const releaseArtifactManifest: ReleaseArtifactManifest = Object.freeze({
  schemaVersion: 'mog.versioning.releaseArtifactManifest.v1',
  manifestId: 'release-artifact-manifest:public-export-fixture',
  releaseId: 'vc11-public-export-fixture',
  createdAt: '2026-06-22T00:00:00.000Z',
  manifestBodyDigest: digest,
  releaseArtifactDigest: digest,
  sourceRepoShas: Object.freeze({
    mog: 'e'.repeat(40),
  }),
  buildEnvironmentDigest: digest,
  artifacts: Object.freeze([
    Object.freeze({
      artifactId: 'mog-sdk-contracts-vc11-public-export',
      kind: 'npm-package',
      digest,
      packageName: '@mog-sdk/contracts',
      packageVersion: '0.10.0',
    }),
  ]),
  packageVersions: Object.freeze({
    '@mog-sdk/contracts': '0.10.0',
  }),
  deployments: Object.freeze([
    Object.freeze({
      deployOrChannelId: 'sdk-release-candidate',
      kind: 'registry',
      artifactIds: Object.freeze(['mog-sdk-contracts-vc11-public-export']),
      runtimeRange: Object.freeze({
        runtimeKind: 'node',
        packageName: '@mog-sdk/contracts',
        packageVersion: '0.10.0',
      }),
      digest,
    }),
  ]),
  testedClientRuntimeRange: '>=0.10.0 <0.11.0',
  capabilityGateTargetRuntimeRange: '>=0.10.0 <0.11.0',
  capabilityGateTargets: Object.freeze([
    Object.freeze({
      gateId: 'versioning.public-export-fixture',
      targetStage: 'shadow-only',
      scope: Object.freeze({
        featureId: 'versioning',
        artifactIds: Object.freeze(['mog-sdk-contracts-vc11-public-export']),
      }),
      releaseArtifactDigest: digest,
    }),
  ]),
  provenanceAttestationDigest: digest,
  rollback: Object.freeze({
    strategy: 'disable-gate',
    targetArtifactId: 'mog-sdk-contracts-vc11-previous',
    targetDigest: digest,
    preserveOrBlockNewerObjects: true,
  }),
  retention: Object.freeze({
    retentionClass: 'candidate',
    quarantineBehavior: 'block-promotion',
  }),
});
const emergencyDisablePolicy: EmergencyDisablePolicy = Object.freeze({
  schemaVersion: 'mog.versioning.emergencyDisablePolicy.v1',
  policyId: 'emergency-disable-policy:public-export-fixture',
  policyDigest: digest,
  createdAt: releaseArtifactManifest.createdAt,
  appliesTo: Object.freeze({
    featureId: 'versioning',
    artifactIds: Object.freeze(['mog-sdk-contracts-vc11-public-export']),
  }),
  rolloutStages: Object.freeze(['shadow-only', 'headless-local', 'ui-beta'] as const),
  authority: Object.freeze({
    authorities: Object.freeze([
      Object.freeze({
        authorityId: 'vc11-release-owner',
        kind: 'release-operator',
      }),
      Object.freeze({
        authorityId: 'vc11-security-owner',
        kind: 'security',
      }),
    ]),
    requiredApprovalCount: 2,
    minimumDistinctAuthorityKinds: 2,
    allowedIncidentCategories: Object.freeze([
      'security',
      'privacy',
      'integrity',
      'release',
    ] as const),
  }),
  signature: Object.freeze({
    acceptedPublicKeyIds: Object.freeze(['emergency-disable-public-key:public-export-fixture']),
    signatureAlgorithm: 'ed25519',
    keyCustodyDigest: digest,
  }),
  distribution: Object.freeze({
    channels: Object.freeze([
      Object.freeze({
        channelId: 'break-glass.public-export-fixture',
        kind: 'offline-signed-material',
        independentOfNormalConfig: true,
      }),
    ]),
    maxPropagationMinutes: 15,
    configRefreshIntervalMinutes: 15,
  }),
  replayProtection: Object.freeze({
    monotonicIncidentIdRequired: true,
    expiryRequired: true,
    nonceRequired: true,
    maxSignalAgeMinutes: 15,
  }),
  offlineBehavior: Object.freeze({
    versionApis: 'fail-closed',
    metadataImportExport: 'fail-closed',
    staleGateCache: 'override-with-break-glass',
  }),
  inFlight: Object.freeze({
    defaultTransition: 'abort-before-mutation',
    allowedTransitions: Object.freeze(['abort-before-mutation', 'record-history-gap'] as const),
  }),
  audit: Object.freeze({
    recordKind: 'version-emergency-disable',
    requiredFields: Object.freeze([
      'recordKind',
      'incidentId',
      'policyId',
      'scopeDigest',
      'createdAt',
      'signerKeyIds',
      'signalDigest',
      'reconciliationStatus',
    ] as const),
    redactionPolicy: 'metadata-only',
  }),
  drill: Object.freeze({
    requiredCadenceDays: 30,
    maxObservedPropagationMinutes: 15,
    requiredChecks: Object.freeze([
      'enabled-clients-observe-disable',
      'stale-gate-cache-overridden',
      'offline-version-apis-fail-closed',
    ] as const),
  }),
});
const author: VersionAuthor = Object.freeze({
  authorId: 'vc03-05-export-surface-fixture',
  actorKind: 'system',
  displayName: 'VC03-05 public export fixture',
});
const syncOperationContext: VersionSyncOperationContext = Object.freeze({
  sourceKind: 'providerLiveInbound',
  originKind: 'provider',
  stableOriginId: 'provider-stable-fixture',
  updateId: 'provider-update-fixture',
  payloadHash: '0'.repeat(64),
  trustStatus: 'verified',
  authorState: 'singleRemote',
  replay: false,
  system: false,
  commitGrouping: 'pendingRemote',
  validationDiagnosticCount: 0,
});
const operationContext: VersionOperationContext = Object.freeze({
  operationId: 'vc03-05-public-export-surface',
  kind: 'sync-export',
  author,
  createdAt: '2026-06-21T00:00:00.000Z',
  domainIds: vc03ExportSurfaceDomainIds,
  capturePolicy,
  writeAdmissionMode,
  collaboration: syncOperationContext,
});
const runtimeOperationContext: VersionRuntimeOperationContext =
  VERSIONING_CONTRACT_FIXTURES.runtimeOperationContext;
const mutationSegment: VersionMutationSegment = Object.freeze({
  segmentId: 'vc03-05-public-export-surface-segment',
  domainId: 'cells.values',
  domainClass: 'authored',
  capabilityState: contractedCapabilityState,
  operationKind: operationContext.kind,
  beforeDigest: digest,
  afterDigest: digest,
  redactionPolicy: 'metadata-only',
});
const publicContractPrivateFieldLeakCount =
  VERSIONING_CONTRACT_FIXTURES.publicContractPrivateFieldLeakCount;
const domainReceipt: DomainMutationReceipt = Object.freeze({
  receiptId: 'vc03-05-public-export-surface-receipt',
  domainId: mutationSegment.domainId,
  domainClass: mutationSegment.domainClass,
  operationId: operationContext.operationId,
  accepted: true,
  capabilityState: contractedCapabilityState,
  capturePolicy,
  writeAdmissionMode,
  segments: Object.freeze([mutationSegment]),
});
const exportMetadata: VersionExportMetadataSummary = Object.freeze({
  exportId: 'vc03-05-public-export-surface',
  format: 'public-typescript-barrel',
  createdAt: operationContext.createdAt,
  includedDomainIds: vc03ExportSurfaceDomainIds,
  redactionPolicy: 'metadata-only',
  digest,
});
const syncProvenance: VersionSyncProvenanceEnvelope = Object.freeze({
  syncId: 'vc03-05-public-export-surface',
  sourceSystem: '@mog-sdk/contracts/api',
  importedAt: operationContext.createdAt,
  sourceVersion: 'vc03-05-export-surface',
  mappingDigest: digest,
  domainReceipts: Object.freeze([domainReceipt]),
});
const objectKind: VersionObjectKind = 'workbook-commit';
const objectHeader: VersionObjectHeader = Object.freeze({
  objectId: 'commit:sha256:vc03-05-public-export-surface',
  objectKind,
  schemaVersion: 'workbook-commit.v1',
  createdAt: operationContext.createdAt,
  digest,
  redactionPolicy: 'metadata-only',
  domainId: 'workbook-metadata',
});
const persistedCommit: WorkbookCommitPersistedShape = Object.freeze({
  header: objectHeader,
  summary: Object.freeze({
    commitId: objectHeader.objectId,
    workbookId: 'vc03-05-export-surface-workbook',
    parentCommitIds: Object.freeze([]),
    author,
    createdAt: operationContext.createdAt,
    rootDigest: digest,
    operationGroupId: operationContext.operationId,
    domainReceipts: Object.freeze([domainReceipt]),
    historyGapStatus: 'none',
  }),
  mutationSegments: Object.freeze([mutationSegment]),
  exportMetadata,
  syncProvenance,
});
const shadowObservation: VersionShadowObservationRecord = Object.freeze({
  schemaVersion: 1,
  recordKind: 'version-shadow-observation',
  observationId: 'shadow-observation:vc11-public-export-surface',
  observedAt: operationContext.createdAt,
  environmentId: 'headless-local',
  documentId: 'vc03-05-export-surface-workbook',
  rolloutStage: 'shadow-only',
  captureMode: 'shadow',
  sampleStatus: 'observed',
  operation: Object.freeze({
    command: 'compute_batch_set_cells_by_position',
    operationId: operationContext.operationId,
    kind: operationContext.kind,
    entrypointIds: Object.freeze(['compute_batch_set_cells_by_position']),
    domainIds: vc03ExportSurfaceDomainIds,
    sheetIds: Object.freeze(['sheet-1']),
    capturePolicy,
    writeAdmissionMode,
    domainClass: 'authored',
    invocation: 'public-mutation',
  }),
  actor: Object.freeze({
    actorKind: author.actorKind,
    redactedAuthorClass: author.actorKind,
  }),
  result: Object.freeze({
    changedCellCount: 1,
    directEditCount: 1,
    directEditRangeCount: 0,
    affectedSheetIds: Object.freeze(['sheet-1']),
    sheetChangeCount: 0,
    tableChangeCount: 0,
    pivotChangeCount: 0,
    chartChangeCount: 0,
    validationAnnotationCount: 0,
    diagnosticCodes: Object.freeze([]),
  }),
  redaction: Object.freeze({
    policy: 'metadata-only',
    policyDigest: digest.value,
    omitted: Object.freeze(['cellValues', 'authorId', 'providerPayload']),
  }),
  sourceArtifactRefs: Object.freeze([
    Object.freeze({
      artifactId: 'operation-context',
      kind: 'operation-context',
      digest,
      redactionPolicy: 'metadata-only',
    }),
  ]),
});
const shadowObservationSink: VersionShadowObservationSink = Object.freeze({
  recordObservation: (_record: VersionShadowObservationRecord) => undefined,
});

export const VERSIONING_PUBLIC_EXPORT_FIXTURES = Object.freeze({
  vc03ExportSurfaceDomainIds,
  operationContext,
  runtimeOperationContext,
  runtimeContractFieldNames: Object.freeze({
    runtimeOperationContext: VERSION_RUNTIME_OPERATION_CONTEXT_FIELD_NAMES,
    mutationSegment: VERSION_MUTATION_SEGMENT_FIELD_NAMES,
    privateFieldDenyList: VERSION_PUBLIC_CONTRACT_PRIVATE_FIELD_DENY_LIST,
  }),
  publicContractPrivateFieldLeakCount,
  mutationSegment,
  domainReceipt,
  exportMetadata,
  publicDomainPolicyExportSurface,
  syncProvenance,
  persistedCommit,
  shadowObservation,
  shadowObservationSink,
  releaseArtifactManifest,
  emergencyDisablePolicy,
  xlsxVersionImportRootProvenance: VERSIONING_CONTRACT_FIXTURES.xlsxImportRootProvenance,
  xlsxInteropDiagnostic: VERSIONING_CONTRACT_FIXTURES.xlsxInteropDiagnostic,
  xlsxExternalChangeBranchRecord: VERSIONING_CONTRACT_FIXTURES.xlsxExternalChangeBranchRecord,
});

export type {
  PublicVersionApiSurface,
  PublicVersioningDomainPolicySurface,
  PublicVersioningMetadataSurface,
};
