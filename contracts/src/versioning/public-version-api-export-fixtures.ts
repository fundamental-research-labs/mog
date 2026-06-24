import type {
  VersionBranchRefReadResult as ContractsApiBranchRefReadResult,
  VersionRefReadResult as ContractsApiRefReadResult,
  VersionRevertCasAdmission as ContractsApiRevertCasAdmission,
  VersionRevertDomainAdmission as ContractsApiRevertDomainAdmission,
  VersionRevertHistoryGapAdmission as ContractsApiRevertHistoryGapAdmission,
  VersionRevertInput as ContractsApiRevertInput,
  VersionRevertMutationGuarantee as ContractsApiRevertMutationGuarantee,
  VersionRevertOptions as ContractsApiRevertOptions,
  VersionRevertPreflightAdmission as ContractsApiRevertPreflightAdmission,
  VersionRevertResult as ContractsApiRevertResult,
  VersionRevertReviewInvalidationAdmission as ContractsApiRevertReviewInvalidationAdmission,
  VersionRevertStaleHeadAdmission as ContractsApiRevertStaleHeadAdmission,
  VersionRevertTarget as ContractsApiRevertTarget,
  VersionSymbolicRefReadResult as ContractsApiSymbolicRefReadResult,
} from '@mog-sdk/contracts/api';
import type {
  VersionBranchRefReadResult as ContractsWorkbookBranchRefReadResult,
  VersionRefReadResult as ContractsWorkbookRefReadResult,
  VersionRevertCasAdmission as ContractsWorkbookRevertCasAdmission,
  VersionRevertDomainAdmission as ContractsWorkbookRevertDomainAdmission,
  VersionRevertHistoryGapAdmission as ContractsWorkbookRevertHistoryGapAdmission,
  VersionRevertInput as ContractsWorkbookRevertInput,
  VersionRevertMutationGuarantee as ContractsWorkbookRevertMutationGuarantee,
  VersionRevertOptions as ContractsWorkbookRevertOptions,
  VersionRevertPreflightAdmission as ContractsWorkbookRevertPreflightAdmission,
  VersionRevertResult as ContractsWorkbookRevertResult,
  VersionRevertReviewInvalidationAdmission as ContractsWorkbookRevertReviewInvalidationAdmission,
  VersionRevertStaleHeadAdmission as ContractsWorkbookRevertStaleHeadAdmission,
  VersionRevertTarget as ContractsWorkbookRevertTarget,
  VersionSymbolicRefReadResult as ContractsWorkbookSymbolicRefReadResult,
} from '@mog-sdk/contracts/api/workbook';

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type _ContractsApiWorkbookEntryExportsBranchRead = Assert<
  IsEqual<ContractsApiBranchRefReadResult, ContractsWorkbookBranchRefReadResult>
>;
type _ContractsApiWorkbookEntryExportsRefRead = Assert<
  IsEqual<ContractsApiRefReadResult, ContractsWorkbookRefReadResult>
>;
type _ContractsApiWorkbookEntryExportsSymbolicRefRead = Assert<
  IsEqual<ContractsApiSymbolicRefReadResult, ContractsWorkbookSymbolicRefReadResult>
>;
type _ContractsApiWorkbookEntryExportsRevertTarget = Assert<
  IsEqual<ContractsApiRevertTarget, ContractsWorkbookRevertTarget>
>;
type _ContractsApiWorkbookEntryExportsRevertDomainAdmission = Assert<
  IsEqual<ContractsApiRevertDomainAdmission, ContractsWorkbookRevertDomainAdmission>
>;
type _ContractsApiWorkbookEntryExportsRevertHistoryGapAdmission = Assert<
  IsEqual<ContractsApiRevertHistoryGapAdmission, ContractsWorkbookRevertHistoryGapAdmission>
>;
type _ContractsApiWorkbookEntryExportsRevertStaleHeadAdmission = Assert<
  IsEqual<ContractsApiRevertStaleHeadAdmission, ContractsWorkbookRevertStaleHeadAdmission>
>;
type _ContractsApiWorkbookEntryExportsRevertCasAdmission = Assert<
  IsEqual<ContractsApiRevertCasAdmission, ContractsWorkbookRevertCasAdmission>
>;
type _ContractsApiWorkbookEntryExportsRevertReviewInvalidationAdmission = Assert<
  IsEqual<
    ContractsApiRevertReviewInvalidationAdmission,
    ContractsWorkbookRevertReviewInvalidationAdmission
  >
>;
type _ContractsApiWorkbookEntryExportsRevertPreflightAdmission = Assert<
  IsEqual<ContractsApiRevertPreflightAdmission, ContractsWorkbookRevertPreflightAdmission>
>;
type _ContractsApiWorkbookEntryExportsRevertInput = Assert<
  IsEqual<ContractsApiRevertInput, ContractsWorkbookRevertInput>
>;
type _ContractsApiWorkbookEntryExportsRevertOptions = Assert<
  IsEqual<ContractsApiRevertOptions, ContractsWorkbookRevertOptions>
>;
type _ContractsApiWorkbookEntryExportsRevertMutationGuarantee = Assert<
  IsEqual<ContractsApiRevertMutationGuarantee, ContractsWorkbookRevertMutationGuarantee>
>;
type _ContractsApiWorkbookEntryExportsRevertResult = Assert<
  IsEqual<ContractsApiRevertResult, ContractsWorkbookRevertResult>
>;
