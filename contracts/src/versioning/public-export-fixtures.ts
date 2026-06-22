import type {
  Paged as ContractsApiPaged,
  RedactionPolicy as ContractsApiRedactionPolicy,
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
} from '@mog-sdk/contracts/api';
import type {
  Paged as ContractsWorkbookPaged,
  RedactionPolicy as ContractsWorkbookRedactionPolicy,
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
} from '@mog-sdk/contracts/api/workbook';
import type {
  CapturePolicy,
  DomainMutationReceipt,
  ObjectDigest,
  VersionAuthor,
  VersionDomainCapabilityState,
  VersionExportMetadataSummary,
  VersionMutationSegment,
  VersionObjectHeader,
  VersionObjectKind,
  VersionOperationContext,
  VersionSyncOperationContext,
  VersionSyncProvenanceEnvelope,
  VersionWriteAdmissionMode,
  WorkbookCommitPersistedShape,
} from '@mog-sdk/contracts/versioning';

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type _ContractsApiWorkbookEntryExportsVersionApi = Assert<
  IsEqual<ContractsApiWorkbookVersion, ContractsWorkbookVersion>
>;
type _ContractsApiWorkbookEntryExportsStatus = Assert<
  IsEqual<ContractsApiWorkbookVersionStatus, ContractsWorkbookVersionStatus>
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
  IsEqual<ContractsApiPutMergeResolutionPayloadResult, ContractsWorkbookPutMergeResolutionPayloadResult>
>;
type _ContractsApiWorkbookEntryExportsSealedResolutionPayloadRef = Assert<
  IsEqual<ContractsApiSealedResolutionPayloadRef, ContractsWorkbookSealedResolutionPayloadRef>
>;

type PublicVersionApiSurface = {
  readonly workbook: ContractsApiWorkbook;
  readonly version: ContractsApiWorkbookVersion;
  readonly status: ContractsApiWorkbookVersionStatus;
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
  readonly page: ContractsApiPaged<string>;
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
const digest: ObjectDigest = Object.freeze({
  algorithm: 'sha256',
  value: 'sha256:vc03-05-public-export-surface',
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

export const VERSIONING_PUBLIC_EXPORT_FIXTURES = Object.freeze({
  vc03ExportSurfaceDomainIds,
  operationContext,
  domainReceipt,
  exportMetadata,
  syncProvenance,
  persistedCommit,
});

export type { PublicVersionApiSurface };
