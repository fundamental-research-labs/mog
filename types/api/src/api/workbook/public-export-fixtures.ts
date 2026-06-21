import type {
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
  VersionMergeResult as ApiRootMergeResult,
  VersionMergeResultId as ApiRootMergeResultId,
  VersionRefMutationResult as ApiRootRefMutationResult,
  VersionResult as ApiRootVersionResult,
  VersionHead as ApiRootVersionHead,
  VersionSemanticDiffPage as ApiRootSemanticDiffPage,
  VersionSemanticValue as ApiRootSemanticValue,
  VersionStoreDiagnostic as ApiRootStoreDiagnostic,
  WorkbookDiffPage as ApiRootDiffPage,
  WorkbookVersion as ApiRootWorkbookVersion,
  WorkbookVersionStatus as ApiRootWorkbookVersionStatus,
} from '../index';
import type {
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
  VersionMergeResult as PackageApiMergeResult,
  VersionMergeResultId as PackageApiMergeResultId,
  VersionRefMutationResult as PackageApiRefMutationResult,
  VersionResult as PackageApiVersionResult,
  VersionHead as PackageApiVersionHead,
  VersionSemanticDiffPage as PackageApiSemanticDiffPage,
  VersionSemanticValue as PackageApiSemanticValue,
  VersionStoreDiagnostic as PackageApiStoreDiagnostic,
  WorkbookDiffPage as PackageApiDiffPage,
  WorkbookVersion as PackageApiWorkbookVersion,
  WorkbookVersionStatus as PackageApiWorkbookVersionStatus,
} from '@mog/types-api/api';
import type {
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
  VersionMergeResult as PackageWorkbookMergeResult,
  VersionMergeResultId as PackageWorkbookMergeResultId,
  VersionRefMutationResult as PackageWorkbookRefMutationResult,
  VersionResult as PackageWorkbookVersionResult,
  VersionHead as PackageWorkbookVersionHead,
  VersionSemanticDiffPage as PackageWorkbookSemanticDiffPage,
  VersionSemanticValue as PackageWorkbookSemanticValue,
  VersionStoreDiagnostic as PackageWorkbookStoreDiagnostic,
  WorkbookDiffPage as PackageWorkbookDiffPage,
  WorkbookVersion as PackageWorkbookVersion,
  WorkbookVersionStatus as PackageWorkbookVersionStatus,
} from '@mog/types-api/api/workbook';
import type {
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
  VersionMergeResult as WorkbookNamespaceMergeResult,
  VersionMergeResultId as WorkbookNamespaceMergeResultId,
  VersionRefMutationResult as WorkbookNamespaceRefMutationResult,
  VersionResult as WorkbookNamespaceVersionResult,
  VersionHead as WorkbookNamespaceVersionHead,
  VersionSemanticDiffPage as WorkbookNamespaceSemanticDiffPage,
  VersionSemanticValue as WorkbookNamespaceSemanticValue,
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
