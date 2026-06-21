import type {
  RedactionPolicy as ApiRootRedactionPolicy,
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
  VersionRefMutationResult as ApiRootRefMutationResult,
  VersionSemanticValue as ApiRootSemanticValue,
  VersionStoreDiagnostic as ApiRootStoreDiagnostic,
  WorkbookDiffPage as ApiRootDiffPage,
  WorkbookVersion as ApiRootWorkbookVersion,
  WorkbookVersionStatus as ApiRootWorkbookVersionStatus,
} from '../index';
import type {
  RedactionPolicy as PackageApiRedactionPolicy,
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
  VersionRefMutationResult as PackageApiRefMutationResult,
  VersionSemanticValue as PackageApiSemanticValue,
  VersionStoreDiagnostic as PackageApiStoreDiagnostic,
  WorkbookDiffPage as PackageApiDiffPage,
  WorkbookVersion as PackageApiWorkbookVersion,
  WorkbookVersionStatus as PackageApiWorkbookVersionStatus,
} from '@mog/types-api/api';
import type {
  RedactionPolicy as PackageWorkbookRedactionPolicy,
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
  VersionRefMutationResult as PackageWorkbookRefMutationResult,
  VersionSemanticValue as PackageWorkbookSemanticValue,
  VersionStoreDiagnostic as PackageWorkbookStoreDiagnostic,
  WorkbookDiffPage as PackageWorkbookDiffPage,
  WorkbookVersion as PackageWorkbookVersion,
  WorkbookVersionStatus as PackageWorkbookVersionStatus,
} from '@mog/types-api/api/workbook';
import type {
  RedactionPolicy as WorkbookNamespaceRedactionPolicy,
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
  VersionRefMutationResult as WorkbookNamespaceRefMutationResult,
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

type _ApiRootExportsVersionApi = Assert<IsEqual<ApiRootWorkbookVersion, PackageApiWorkbookVersion>>;
type _ApiRootExportsStatus = Assert<
  IsEqual<ApiRootWorkbookVersionStatus, PackageApiWorkbookVersionStatus>
>;
type _ApiRootExportsCommitOptions = Assert<
  IsEqual<ApiRootCommitOptions, PackageApiCommitOptions>
>;
type _ApiRootExportsCommitExpectedHead = Assert<
  IsEqual<ApiRootCommitExpectedHead, PackageApiCommitExpectedHead>
>;
type _ApiRootExportsCommitMode = Assert<IsEqual<ApiRootCommitMode, PackageApiCommitMode>>;
type _ApiRootExportsDiffEntry = Assert<IsEqual<ApiRootDiffEntry, PackageApiDiffEntry>>;
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
