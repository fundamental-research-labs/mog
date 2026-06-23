import type {
  ControlPlaneCompareAndSwapRequest,
  ControlPlaneDryRunRequest,
} from '../control-plane';
import {
  EMERGENCY_DISABLE_AUDIT_RECORD_FIELDS,
  EMERGENCY_DISABLE_POLICY_SCHEMA_VERSION,
} from './emergency-disable-policy';
import { RELEASE_ARTIFACT_MANIFEST_SCHEMA_VERSION } from './release-artifact-manifest';
import { MOG_WORKBOOK_VERSION_XLSX_METADATA_PART } from './xlsx-interop';
import type {
  CapturePolicy,
  DomainCapabilityPolicyManifest,
  DomainPresenceDetector,
  EmergencyDisablePolicy,
  EmergencyDisablePolicySchemaVersion,
  ObjectDigest,
  ReleaseArtifactManifest,
  ReleaseArtifactManifestSchemaVersion,
  VersionAgentProposalAcceptResult,
  VersionAgentProposalEvent,
  VersionAgentProposalId,
  VersionAgentProposalRecord,
  VersionAgentProposalStatus,
  VersionAppendAgentProposalEventInput,
  VersionAuthor,
  VersionCaptureDiagnosticsSink,
  VersionCaptureFailureDiagnosticCode,
  VersionCaptureFailureSinkRecord,
  VersionCaptureFailureStage,
  VersionWriteAdmissionMode,
  VersionCapabilityGate,
  VersionDomainCapabilityKey,
  VersionDomainCapabilityState,
  VersionDomainCapabilityStateMap,
  VersionDomainClass,
  VersionHistoryReadMode,
  VersionHistoryWriteMode,
  VersionMergePreviewRecord,
  VersionMergePreviewRecordStatus,
  VersionMetadataDiagnostic,
  VersionMutationSegment,
  VersionMutationSegmentFieldName,
  VersionOperationContext,
  VersionPendingRemotePromotionResultMetadata,
  VersionPendingRemotePromotionSkipReason,
  VersionPendingRemotePromotionStatus,
  VersionPendingRemoteSegmentId,
  VersionProposalVerificationSummary,
  VersionPublicContractPrivateFieldName,
  VersionRedactionKey,
  VersionRedactionKeySubject,
  VersionRedactionSummary,
  VersionRuntimeOperationContext,
  VersionRuntimeOperationContextFieldName,
} from './index';
import type {
  MogWorkbookVersionXlsxCommitId,
  MogWorkbookVersionXlsxMetadata,
  MogWorkbookVersionXlsxMetadataExpectedHead,
  MogWorkbookVersionXlsxMetadataTrustResult,
  MogWorkbookVersionXlsxMetadataTrustSummary,
  MogWorkbookVersionXlsxObjectDigest,
  Vc10XlsxInteropDiagnostic,
  XlsxExternalChangeBranchRecord,
  XlsxVersionImportRootProvenance,
} from './xlsx-interop';

type Assert<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type ExpectedDomainClass =
  | 'authored'
  | 'derived'
  | 'transient'
  | 'packageFidelity'
  | 'secret'
  | 'external';
type ExpectedDomainCapabilityState =
  | 'not-started'
  | 'contracted'
  | 'supported'
  | 'derived'
  | 'excluded'
  | 'opaque-preserved'
  | 'opaque-blocking';
type ExpectedDomainCapabilityKey =
  | 'capture'
  | 'replay'
  | 'diff'
  | 'reviewAccess'
  | 'checkout'
  | 'merge'
  | 'persistence'
  | 'import'
  | 'export';
type ExpectedCapturePolicy =
  | 'commitEligible'
  | 'excluded'
  | 'derivedOnly'
  | 'rootCreation'
  | 'historyGap'
  | 'shadowOnly';
type ExpectedWriteAdmissionMode =
  | 'capture'
  | 'shadowOnly'
  | 'captureDisabledNoHistory'
  | 'captureSuspendedWithGap'
  | 'block';
type ExpectedHistoryReadMode = 'none' | 'metadata-only' | 'full';
type ExpectedHistoryWriteMode = 'none' | 'shadow-only' | 'gated' | 'full';
type ExpectedRedactionKeySubject = 'author' | 'session' | 'provider' | 'debug';
type ExpectedCaptureFailureStage = 'admission' | 'capture';
type ExpectedCaptureFailureDiagnosticCode =
  | 'missing_redaction_key'
  | 'write_admission_blocked'
  | 'capture_serialization_failed'
  | 'diagnostics_sink_unavailable';
type ExpectedRuntimeOperationContextFieldName =
  | 'runtimeContextId'
  | 'operationContext'
  | 'entrypointIds'
  | 'command'
  | 'runtimeKind'
  | 'redactionPolicy'
  | 'actor'
  | 'diagnostics';
type ExpectedMutationSegmentFieldName =
  | 'segmentId'
  | 'domainId'
  | 'domainClass'
  | 'capabilityState'
  | 'operationKind'
  | 'objectIds'
  | 'beforeDigest'
  | 'afterDigest'
  | 'redactionPolicy'
  | 'attachment';
type ExpectedPublicContractPrivateFieldName =
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
  | 'payload'
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
type ExpectedPendingRemotePromotionStatus = 'success' | 'partial' | 'failed';
type ExpectedPendingRemotePromotionSkipReason =
  | 'batch-status-read-failed'
  | 'batch-status-terminal'
  | 'completion-failed'
  | 'graph-ref-unavailable'
  | 'graph-write-failed'
  | 'inconsistent-group'
  | 'ineligible-operation-context'
  | 'ineligible-state'
  | 'invalid-required-object'
  | 'missing-required-object'
  | 'missing-semantic-change-set'
  | 'missing-snapshot-root'
  | 'provider-authority-stale'
  | 'provider-authority-unknown'
  | 'provider-read-failed';
type ExpectedAgentProposalStatus =
  | 'draft'
  | 'workspace_open'
  | 'committed'
  | 'verified'
  | 'ready_for_review'
  | 'rejected'
  | 'stale'
  | 'superseded'
  | 'merge_conflicted'
  | 'failed'
  | 'applied';
type ExpectedMergePreviewRecordStatus = 'clean' | 'conflicted' | 'applied' | 'superseded';

type _NoExpectedFailingDomainCapabilityState = Assert<
  IsNever<Extract<VersionDomainCapabilityState, 'expected-failing'>>
>;
type _ExactDomainClassSet = Assert<IsEqual<VersionDomainClass, ExpectedDomainClass>>;
type _ExactDomainCapabilityStateSet = Assert<
  IsEqual<VersionDomainCapabilityState, ExpectedDomainCapabilityState>
>;
type _ExactDomainCapabilityKeySet = Assert<
  IsEqual<VersionDomainCapabilityKey, ExpectedDomainCapabilityKey>
>;
type _ExactCapturePolicySet = Assert<IsEqual<CapturePolicy, ExpectedCapturePolicy>>;
type _ExactWriteAdmissionModeSet = Assert<
  IsEqual<VersionWriteAdmissionMode, ExpectedWriteAdmissionMode>
>;
type _ExactHistoryReadModeSet = Assert<IsEqual<VersionHistoryReadMode, ExpectedHistoryReadMode>>;
type _ExactHistoryWriteModeSet = Assert<IsEqual<VersionHistoryWriteMode, ExpectedHistoryWriteMode>>;
type _ExactRedactionKeySubjectSet = Assert<
  IsEqual<VersionRedactionKeySubject, ExpectedRedactionKeySubject>
>;
type _ExactCaptureFailureStageSet = Assert<
  IsEqual<VersionCaptureFailureStage, ExpectedCaptureFailureStage>
>;
type _ExactCaptureFailureDiagnosticCodeSet = Assert<
  IsEqual<VersionCaptureFailureDiagnosticCode, ExpectedCaptureFailureDiagnosticCode>
>;
type _ExactRuntimeOperationContextFieldNameSet = Assert<
  IsEqual<VersionRuntimeOperationContextFieldName, ExpectedRuntimeOperationContextFieldName>
>;
type _ExactMutationSegmentFieldNameSet = Assert<
  IsEqual<VersionMutationSegmentFieldName, ExpectedMutationSegmentFieldName>
>;
type _ExactPrivateFieldDenyListSet = Assert<
  IsEqual<VersionPublicContractPrivateFieldName, ExpectedPublicContractPrivateFieldName>
>;
type _RuntimeOperationContextFieldsCoverPublicKeys = Assert<
  IsEqual<VersionRuntimeOperationContextFieldName, keyof VersionRuntimeOperationContext>
>;
type _MutationSegmentFieldsCoverPublicKeys = Assert<
  IsEqual<VersionMutationSegmentFieldName, keyof VersionMutationSegment>
>;
type _RuntimeOperationContextHasNoPrivatePrincipalOrRawPayloadFields = Assert<
  IsNever<Extract<keyof VersionRuntimeOperationContext, VersionPublicContractPrivateFieldName>>
>;
type _MutationSegmentHasNoPrivatePrincipalOrRawPayloadFields = Assert<
  IsNever<Extract<keyof VersionMutationSegment, VersionPublicContractPrivateFieldName>>
>;
type _ExactPendingRemotePromotionStatusSet = Assert<
  IsEqual<VersionPendingRemotePromotionStatus, ExpectedPendingRemotePromotionStatus>
>;
type _ExactPendingRemotePromotionSkipReasonSet = Assert<
  IsEqual<VersionPendingRemotePromotionSkipReason, ExpectedPendingRemotePromotionSkipReason>
>;
type _ExactAgentProposalStatusSet = Assert<
  IsEqual<VersionAgentProposalStatus, ExpectedAgentProposalStatus>
>;
type _ExactMergePreviewRecordStatusSet = Assert<
  IsEqual<VersionMergePreviewRecordStatus, ExpectedMergePreviewRecordStatus>
>;
type _EmergencyDisablePolicySchemaVersionField = Assert<
  IsEqual<EmergencyDisablePolicy['schemaVersion'], EmergencyDisablePolicySchemaVersion>
>;
type _ReleaseArtifactManifestSchemaVersionField = Assert<
  IsEqual<ReleaseArtifactManifest['schemaVersion'], ReleaseArtifactManifestSchemaVersion>
>;
type _CapabilityStatesFieldUsesCapabilityMap = Assert<
  IsEqual<DomainCapabilityPolicyManifest['capabilityStates'], VersionDomainCapabilityStateMap>
>;
type _MatrixRowIdFieldUsesString = Assert<
  IsEqual<DomainCapabilityPolicyManifest['matrixRowId'], string>
>;
type _DetectorMatrixRowIdFieldUsesString = Assert<
  IsEqual<DomainPresenceDetector['matrixRowId'], string>
>;
type _LegacyCapabilityStateFieldUsesCapabilityUnion = Assert<
  IsEqual<
    Exclude<DomainCapabilityPolicyManifest['capabilityState'], undefined>,
    VersionDomainCapabilityState
  >
>;
type PublicDomainPolicyIdentityFixture = Pick<
  DomainCapabilityPolicyManifest,
  'domainPolicyId' | 'matrixRowId' | 'domainId'
>;
type _PublicDomainPolicyIdentityFixtureHasNoLegacyCapabilityState = Assert<
  IsNever<Extract<keyof PublicDomainPolicyIdentityFixture, 'capabilityState'>>
>;
type _DomainClassFieldUsesDomainClassUnion = Assert<
  IsEqual<DomainCapabilityPolicyManifest['domainClass'], VersionDomainClass>
>;
type _CapturePolicyFieldUsesCapturePolicyUnion = Assert<
  IsEqual<DomainCapabilityPolicyManifest['capturePolicy'], CapturePolicy>
>;
type _CapabilityStateUnionIsNotDomainClassUnion = Assert<
  IsEqual<VersionDomainCapabilityState, VersionDomainClass> extends true ? false : true
>;
type _CapabilityStateUnionIsNotCapturePolicyUnion = Assert<
  IsEqual<VersionDomainCapabilityState, CapturePolicy> extends true ? false : true
>;

const digest: ObjectDigest = Object.freeze({
  algorithm: 'sha256',
  value: 'sha256:vc02-batch-a-public-contract-spine',
});

const versionCapabilityGate: VersionCapabilityGate = Object.freeze({
  gateId: 'versioning.batch-a',
  capabilityId: 'versioning.public-contract-spine',
  rolloutStage: 'shadow-only',
  scope: Object.freeze({
    domainIds: Object.freeze(['authored-grid']),
    featureId: 'versioning',
  }),
  preflightDigest: Object.freeze({
    algorithm: 'sha256',
    value: digest.value,
  }),
  casToken: Object.freeze({
    token: 'vc02-fixture-token',
    version: '1',
  }),
});

const contractedCapabilityStates: VersionDomainCapabilityStateMap = Object.freeze({
  capture: 'contracted',
  replay: 'contracted',
  diff: 'contracted',
  reviewAccess: 'contracted',
  checkout: 'contracted',
  merge: 'contracted',
  persistence: 'contracted',
  import: 'contracted',
  export: 'contracted',
});

const historyReadModes: readonly VersionHistoryReadMode[] = Object.freeze([
  'none',
  'metadata-only',
  'full',
]);
const historyWriteModes: readonly VersionHistoryWriteMode[] = Object.freeze([
  'none',
  'shadow-only',
  'gated',
  'full',
]);

const domainPolicy: DomainCapabilityPolicyManifest = Object.freeze({
  domainPolicyId: 'authored-grid',
  matrixRowId: 'authored-grid',
  domainId: 'authored-grid',
  domainClass: 'authored',
  capabilityStates: contractedCapabilityStates,
  capturePolicy: 'shadowOnly',
  writeAdmissionMode: 'shadowOnly',
  rolloutStage: versionCapabilityGate.rolloutStage,
  historyAccess: Object.freeze({
    readMode: 'metadata-only',
    writeMode: 'shadow-only',
    redactionPolicy: 'metadata-only',
  }),
  redactionPolicy: 'metadata-only',
});

const domainPresenceDetector: DomainPresenceDetector = Object.freeze({
  detectorId: 'detector.authored-grid',
  matrixRowId: domainPolicy.matrixRowId,
  domainId: domainPolicy.domainId,
  domainClass: domainPolicy.domainClass,
  detectsObjectKinds: Object.freeze(['worksheet.cell']),
  capabilityStatesWhenPresent: contractedCapabilityStates,
});

const controlPlanePreflight: ControlPlaneDryRunRequest = Object.freeze({
  casKey: versionCapabilityGate.gateId,
  expectedPriorStage: versionCapabilityGate.rolloutStage,
  targetStage: 'headless-local',
  priorScope: versionCapabilityGate.scope ?? Object.freeze({}),
  targetScope: versionCapabilityGate.scope ?? Object.freeze({}),
  scopeDelta: Object.freeze({
    summary: 'VC-02 Batch A public contract preflight fixture',
  }),
  preflightDigest:
    versionCapabilityGate.preflightDigest ??
    Object.freeze({
      algorithm: 'opaque',
      value: 'missing',
    }),
  clientRequestId: 'vc02-preflight-fixture',
});

const controlPlaneCompareAndSwap: ControlPlaneCompareAndSwapRequest = Object.freeze({
  ...controlPlanePreflight,
  expectedPriorCasToken:
    versionCapabilityGate.casToken ??
    Object.freeze({
      token: 'missing',
      version: '0',
    }),
});

const metadataDiagnostic: VersionMetadataDiagnostic = Object.freeze({
  severity: 'info',
  code: 'VERSION_FIXTURE_METADATA_ONLY',
  message: 'Fixture proves public-safe version metadata export closure.',
  data: Object.freeze({
    redacted: true,
  }),
});

const publicContractPrivateFieldDenyList = Object.freeze([
  'principal',
  'principalId',
  'principalIds',
  'principalRef',
  'principalScope',
  'principalTag',
  'principalTags',
  'principal_tags',
  'rawPayload',
  'raw_payload',
  'rawPayloadBytes',
  'raw_payload_bytes',
  'payload',
  'payloadBytes',
  'payload_bytes',
  'providerPayload',
  'provider_payload',
  'rawWorkbookBytes',
  'raw_workbook_bytes',
  'workbookBytes',
  'workbook_bytes',
  'credential',
  'credentials',
  'accessToken',
  'access_token',
  'secret',
  'secrets',
] as const satisfies readonly VersionPublicContractPrivateFieldName[]);

function countForbiddenPrivateFieldKeys(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countForbiddenPrivateFieldKeys(item), 0);
  }
  if (value === null || typeof value !== 'object') {
    return 0;
  }
  return Object.entries(value as Readonly<Record<string, unknown>>).reduce(
    (count, [key, item]) =>
      count +
      (publicContractPrivateFieldDenyList.includes(key as VersionPublicContractPrivateFieldName)
        ? 1
        : 0) +
      countForbiddenPrivateFieldKeys(item),
    0,
  );
}

const runtimeAuthor: VersionAuthor = Object.freeze({
  authorId: 'author:sha256:vc02-runtime-public-fixture',
  actorKind: 'automation',
  displayName: 'VC02 Runtime Public Fixture',
});

const operationContext: VersionOperationContext = Object.freeze({
  operationId: 'operation:vc02-runtime-public-fixture',
  kind: 'mutation',
  author: runtimeAuthor,
  createdAt: '2026-06-22T00:00:00.000Z',
  workbookId: 'workbook:vc02-runtime-public-fixture',
  sheetIds: Object.freeze(['sheet:runtime-public-fixture']),
  domainIds: Object.freeze(['cells.values']),
  capturePolicy: 'commitEligible',
  writeAdmissionMode: 'capture',
  rolloutStage: versionCapabilityGate.rolloutStage,
  capabilityGate: versionCapabilityGate,
  clientRequestId: 'client-request:vc02-runtime-public-fixture',
});

const runtimeOperationContext: VersionRuntimeOperationContext = Object.freeze({
  runtimeContextId: 'runtime-context:vc02-public-contract-spine',
  operationContext,
  entrypointIds: Object.freeze(['compute_batch_set_cells_by_position']),
  command: 'compute_batch_set_cells_by_position',
  runtimeKind: 'node',
  redactionPolicy: 'metadata-only',
  actor: Object.freeze({
    actorKind: runtimeAuthor.actorKind,
    redactedAuthorClass: runtimeAuthor.actorKind,
  }),
  diagnostics: Object.freeze([metadataDiagnostic]),
});

const mutationSegment: VersionMutationSegment = Object.freeze({
  segmentId: 'mutation-segment:vc02-public-contract-spine',
  domainId: 'cells.values',
  domainClass: 'authored',
  capabilityState: 'contracted',
  operationKind: operationContext.kind,
  objectIds: Object.freeze(['cell:sheet-runtime-public-fixture:A1']),
  beforeDigest: digest,
  afterDigest: digest,
  redactionPolicy: runtimeOperationContext.redactionPolicy,
});

const publicContractPrivateFieldLeakCount = countForbiddenPrivateFieldKeys(
  Object.freeze([runtimeOperationContext, mutationSegment]),
);
if (publicContractPrivateFieldLeakCount !== 0) {
  throw new Error(
    'VC-02 public runtime context fixtures contain private principal/raw payload keys.',
  );
}
const publicContractPrivateFieldLeakCountZero = publicContractPrivateFieldLeakCount as 0;

const pendingRemoteSegmentId =
  'pending-remote-segment:sha256:vc18-public-contract-fixture' as VersionPendingRemoteSegmentId;

const pendingRemotePromotionResult: VersionPendingRemotePromotionResultMetadata = Object.freeze({
  schemaVersion: 1,
  promotionId: 'pending-remote-promotion:vc18-public-contract-fixture',
  status: 'success',
  promotedSegmentIds: Object.freeze([pendingRemoteSegmentId]),
  commitIds: Object.freeze(['commit:sha256:vc18-pending-remote-promotion']),
  skipped: Object.freeze([]),
  diagnostics: Object.freeze([metadataDiagnostic]),
  promotedAt: '2026-06-22T00:00:00.000Z',
});

const proposalAuthor: VersionAuthor = Object.freeze({
  authorId: 'vc18-agent-proposal-fixture',
  actorKind: 'automation',
  displayName: 'VC18 Agent Proposal Fixture',
});

const proposalId = 'proposal:sha256:vc18-public-contract-fixture' as VersionAgentProposalId;

const proposalVerification: VersionProposalVerificationSummary = Object.freeze({
  status: 'passed',
  checks: Object.freeze([
    Object.freeze({
      name: 'contract-export-closure',
      status: 'passed',
      diagnostics: Object.freeze([]),
    }),
  ]),
  createdAt: pendingRemotePromotionResult.promotedAt,
  trust: 'trusted',
  attestationDigest: digest,
});

const proposalRedaction: VersionRedactionSummary = Object.freeze({
  redactionId: 'redaction:vc18-agent-proposal-fixture',
  policy: 'metadata-only',
  redactedObjectCount: 0,
  redactedFieldCount: 0,
  preservedDigests: Object.freeze([digest]),
});

const authorRedactionKey: VersionRedactionKey = Object.freeze({
  keyId: 'redaction-key:author:sha256:vc02-author-redaction-key',
  subject: 'author',
  sourceField: 'operation.author.authorId',
  digest,
  policy: 'metadata-only',
});

const providerRedactionKey: VersionRedactionKey = Object.freeze({
  keyId: 'redaction-key:provider:sha256:vc02-provider-redaction-key',
  subject: 'provider',
  sourceField: 'operation.collaboration.providerId',
  digest,
  policy: 'metadata-only',
});

const captureFailureSinkRecord: VersionCaptureFailureSinkRecord = Object.freeze({
  schemaVersion: 1,
  recordKind: 'version-capture-failure',
  diagnosticId: 'diagnostic:vc02-capture-redaction-key',
  observedAt: pendingRemotePromotionResult.promotedAt,
  stage: 'admission',
  code: 'missing_redaction_key',
  severity: 'warning',
  message: 'Capture admission requires redaction keys for sensitive provenance.',
  operationId: 'operation:vc02-capture-redaction-key',
  domainIds: Object.freeze(['runtime-diagnostics.sync-provider-admission']),
  capturePolicy: 'shadowOnly',
  writeAdmissionMode: 'shadowOnly',
  redactionPolicy: 'metadata-only',
  redactionKeys: Object.freeze([authorRedactionKey, providerRedactionKey]),
  missingRedactionFields: Object.freeze(['operation.author.sessionId']),
  debug: Object.freeze({
    boundary: 'sync-admission',
    redacted: true,
  }),
});

const captureDiagnosticsSink: VersionCaptureDiagnosticsSink = Object.freeze({
  recordCaptureFailure: (_record: VersionCaptureFailureSinkRecord) => undefined,
});

const agentProposalAcceptResult: VersionAgentProposalAcceptResult = Object.freeze({
  status: 'fast_forwarded',
  proposalId,
  appliedCommitId: 'commit:sha256:vc18-agent-proposal-applied',
  targetRef: 'main',
  newHeadId: 'commit:sha256:vc18-agent-proposal-applied',
  refUpdateReceiptId: 'ref-update:vc18-agent-proposal',
});

const agentProposalRecord: VersionAgentProposalRecord = Object.freeze({
  schemaVersion: 1,
  id: proposalId,
  documentId: 'workbook:vc18-public-contract-fixture',
  title: 'Public contract closure fixture',
  targetRef: agentProposalAcceptResult.targetRef,
  baseCommitId: 'commit:sha256:vc18-agent-proposal-base',
  targetHeadIdAtCreation: 'commit:sha256:vc18-agent-proposal-base',
  proposalBranchName: 'proposal-branch-fixture',
  proposalBranchNameHint: 'agent-proposal-fixture',
  proposalCommitId: agentProposalAcceptResult.appliedCommitId,
  status: 'applied',
  revision: 4,
  agentRunId: 'agent-run:vc18-public-contract-fixture',
  agent: proposalAuthor,
  updatedAt: pendingRemotePromotionResult.promotedAt,
  createdAt: pendingRemotePromotionResult.promotedAt,
  createdBy: proposalAuthor,
  lastActor: proposalAuthor,
  reviewId: 'review:vc18-agent-proposal',
  verification: proposalVerification,
  accepted: agentProposalAcceptResult,
  redaction: proposalRedaction,
  diagnostics: Object.freeze([metadataDiagnostic]),
});

const agentProposalAcceptedEvent: VersionAgentProposalEvent = Object.freeze({
  kind: 'accepted',
  clientRequestId: 'client-request:vc18-agent-proposal-accepted',
  actor: proposalAuthor,
  result: agentProposalAcceptResult,
  reviewApplied: true,
  createdAt: pendingRemotePromotionResult.promotedAt,
});

const appendAgentProposalEventInput: VersionAppendAgentProposalEventInput = Object.freeze({
  proposalId,
  expectedRevision: 3,
  event: agentProposalAcceptedEvent,
});

const mergePreviewRecord: VersionMergePreviewRecord = Object.freeze({
  schemaVersion: 1,
  mergePreviewId: 'merge-preview:vc18-public-contract-fixture',
  documentId: agentProposalRecord.documentId,
  targetRef: agentProposalRecord.targetRef,
  baseCommitId: agentProposalRecord.baseCommitId,
  oursCommitId: agentProposalRecord.targetHeadIdAtCreation,
  theirsCommitId: agentProposalAcceptResult.appliedCommitId,
  status: 'clean',
  revision: 1,
  conflictIds: Object.freeze([]),
  createdAt: pendingRemotePromotionResult.promotedAt,
  updatedAt: pendingRemotePromotionResult.promotedAt,
  resultDigest: digest,
  resultObjectRef: digest,
  resolutionState: Object.freeze({
    kind: 'fixture',
    resolutionCount: 0,
  }),
  diagnostics: Object.freeze([metadataDiagnostic]),
});

const vc11ReleaseArtifactDigest: ObjectDigest = Object.freeze({
  algorithm: 'sha256',
  value: 'sha256:vc11-public-release-artifact-fixture',
});

const releaseArtifactManifest: ReleaseArtifactManifest = Object.freeze({
  schemaVersion: RELEASE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  manifestId: 'release-artifact-manifest:vc11-public-fixture',
  releaseId: 'vc11-default-on-public-fixture',
  createdAt: pendingRemotePromotionResult.promotedAt,
  manifestBodyDigest: digest,
  releaseArtifactDigest: vc11ReleaseArtifactDigest,
  sourceRepoShas: Object.freeze({
    mog: 'f'.repeat(40),
  }),
  buildEnvironmentDigest: digest,
  artifacts: Object.freeze([
    Object.freeze({
      artifactId: 'mog-web-default-on-2026-06-22',
      kind: 'web-bundle',
      digest: vc11ReleaseArtifactDigest,
      packageName: '@mog-sdk/spreadsheet-app',
      packageVersion: '0.10.0',
      fileName: 'mog-web-default-on.tgz',
      mediaType: 'application/gzip',
    }),
  ]),
  packageVersions: Object.freeze({
    '@mog-sdk/contracts': '0.10.0',
    '@mog-sdk/spreadsheet-app': '0.10.0',
  }),
  deployments: Object.freeze([
    Object.freeze({
      deployOrChannelId: 'public-web-default-on',
      kind: 'channel',
      artifactIds: Object.freeze(['mog-web-default-on-2026-06-22']),
      runtimeRange: Object.freeze({
        runtimeKind: 'browser',
        channelId: 'public-web-default-on',
        minClientVersion: '0.10.0',
      }),
      digest: vc11ReleaseArtifactDigest,
    }),
  ]),
  testedClientRuntimeRange: '>=0.10.0 <0.11.0',
  capabilityGateTargetRuntimeRange: '>=0.10.0 <0.11.0',
  capabilityGateTargets: Object.freeze([
    Object.freeze({
      gateId: 'versioning.default-on.public-web',
      targetStage: 'default-on',
      scope: Object.freeze({
        featureId: 'versioning',
        channelIds: Object.freeze(['public-web-default-on']),
      }),
      runtimeRange: Object.freeze({
        runtimeKind: 'browser',
        channelId: 'public-web-default-on',
        minClientVersion: '0.10.0',
      }),
      releaseArtifactDigest: vc11ReleaseArtifactDigest,
    }),
  ]),
  provenanceAttestationDigest: digest,
  rollback: Object.freeze({
    strategy: 'disable-gate',
    targetDeployOrChannelId: 'public-web-collab-interop-beta',
    targetDigest: digest,
    preserveOrBlockNewerObjects: true,
  }),
  retention: Object.freeze({
    retentionClass: 'release',
    quarantineBehavior: 'disable-channel',
  }),
  diagnostics: Object.freeze([metadataDiagnostic]),
});

const emergencyDisablePolicy: EmergencyDisablePolicy = Object.freeze({
  schemaVersion: EMERGENCY_DISABLE_POLICY_SCHEMA_VERSION,
  policyId: 'emergency-disable-policy:vc11-public-fixture',
  policyDigest: digest,
  createdAt: pendingRemotePromotionResult.promotedAt,
  appliesTo: Object.freeze({
    featureId: 'versioning',
    channelIds: Object.freeze(['public-web-default-on']),
    domainIds: Object.freeze(['workbook-metadata', 'cells.values', 'cells.formulas']),
  }),
  rolloutStages: Object.freeze(['ui-beta', 'collab-interop-beta', 'default-on'] as const),
  authority: Object.freeze({
    authorities: Object.freeze([
      Object.freeze({
        authorityId: 'vc-release-oncall',
        kind: 'release-operator',
        displayName: 'Version release on-call',
      }),
      Object.freeze({
        authorityId: 'vc-security-oncall',
        kind: 'security',
        displayName: 'Version security on-call',
      }),
    ]),
    requiredApprovalCount: 2,
    minimumDistinctAuthorityKinds: 2,
    allowedIncidentCategories: Object.freeze([
      'security',
      'privacy',
      'integrity',
      'availability',
      'release',
    ] as const),
    authorizedScopes: Object.freeze([
      Object.freeze({
        featureId: 'versioning',
      }),
    ]),
  }),
  signature: Object.freeze({
    acceptedPublicKeyIds: Object.freeze(['emergency-disable-public-key:vc11-public-fixture']),
    signatureAlgorithm: 'ed25519',
    keyCustodyDigest: digest,
  }),
  distribution: Object.freeze({
    channels: Object.freeze([
      Object.freeze({
        channelId: 'break-glass.versioning.public',
        kind: 'offline-signed-material',
        independentOfNormalConfig: true,
        scope: Object.freeze({
          featureId: 'versioning',
        }),
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
    clockSkewAllowanceMinutes: 2,
  }),
  offlineBehavior: Object.freeze({
    versionApis: 'fail-closed',
    metadataImportExport: 'fail-closed',
    staleGateCache: 'override-with-break-glass',
  }),
  inFlight: Object.freeze({
    defaultTransition: 'record-history-gap',
    allowedTransitions: Object.freeze([
      'finalize-if-committed',
      'abort-before-mutation',
      'record-history-gap',
      'quarantine-provider-update',
      'create-reconcile-root',
    ] as const),
  }),
  audit: Object.freeze({
    recordKind: 'version-emergency-disable',
    requiredFields: EMERGENCY_DISABLE_AUDIT_RECORD_FIELDS,
    redactionPolicy: 'metadata-only',
  }),
  drill: Object.freeze({
    requiredCadenceDays: 30,
    maxObservedPropagationMinutes: 15,
    requiredChecks: Object.freeze([
      'enabled-clients-observe-disable',
      'stale-gate-cache-overridden',
      'normal-config-channel-impaired',
      'offline-version-apis-fail-closed',
      'in-flight-transition-reconciled',
    ] as const),
  }),
  diagnostics: Object.freeze([metadataDiagnostic]),
});

const xlsxSemanticChangeSetDigest: MogWorkbookVersionXlsxObjectDigest = Object.freeze({
  algorithm: 'sha256',
  digest: '1'.repeat(64),
});
const xlsxSnapshotRootDigest: MogWorkbookVersionXlsxObjectDigest = Object.freeze({
  algorithm: 'sha256',
  digest: '2'.repeat(64),
});
const xlsxExpectedHead: MogWorkbookVersionXlsxMetadataExpectedHead = Object.freeze({
  commitId: `commit:sha256:${'a'.repeat(64)}` as MogWorkbookVersionXlsxCommitId,
  refName: 'refs/heads/main',
  resolvedFrom: 'HEAD',
  refRevision: Object.freeze({
    kind: 'counter',
    value: '1',
  }),
  semanticChangeSetDigest: xlsxSemanticChangeSetDigest,
  snapshotRootDigest: xlsxSnapshotRootDigest,
});
const xlsxMetadata: MogWorkbookVersionXlsxMetadata = Object.freeze({
  schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
  exportedAt: '2026-06-22T00:00:00.000Z',
  documentId: 'vc10-xlsx-public-contract-fixture',
  head: xlsxExpectedHead,
  diagnostics: Object.freeze([
    Object.freeze({
      code: 'VERSION_XLSX_METADATA_PUBLIC_CONTRACT_FIXTURE',
      severity: 'info',
      message: 'Public VC10 XLSX metadata contract fixture.',
    }),
  ]),
  redaction: Object.freeze({
    policy: 'commit-document-and-object-digests-only',
    omitted: Object.freeze([
      'authors',
      'agentTraces',
      'rawWorkbookBytes',
      'credentials',
      'externalDataSecrets',
      'objectStoreNamespace',
      'workspaceId',
      'principalScope',
    ]),
  }),
});
const xlsxTrustedMetadataTrust: MogWorkbookVersionXlsxMetadataTrustSummary = Object.freeze({
  status: 'trusted',
  sidecarPart: MOG_WORKBOOK_VERSION_XLSX_METADATA_PART,
  redacted: true,
});
const xlsxTrustResult: MogWorkbookVersionXlsxMetadataTrustResult = Object.freeze({
  status: 'trusted',
  metadata: xlsxMetadata,
  trust: xlsxTrustedMetadataTrust,
  diagnostics: Object.freeze([]),
});
const xlsxImportRootProvenance: XlsxVersionImportRootProvenance = Object.freeze({
  kind: 'xlsx',
  source: Object.freeze({
    sourceType: 'bytes',
    byteLength: 4096,
  }),
  diagnostics: Object.freeze([]),
  versionMetadataTrust: xlsxTrustedMetadataTrust,
});
const xlsxInteropDiagnostic: Vc10XlsxInteropDiagnostic = Object.freeze({
  diagnosticId: 'vc10-xlsx-interop:external-change-branch-recorded',
  code: 'VC10_XLSX_EXTERNAL_CHANGE_BRANCH_RECORDED',
  severity: 'info',
  phase: 'external-change-branch',
  message: 'A redacted branch record was captured for XLSX external changes.',
  redacted: true,
  payload: Object.freeze({
    branchCreated: true,
    sourcePathRedacted: true,
    diagnosticCount: 0,
  }),
});
const xlsxExternalChangeBranchRecord: XlsxExternalChangeBranchRecord = Object.freeze({
  schemaVersion: 1,
  recordKind: 'xlsx-external-change-branch',
  branchRecordId: 'xlsx-external-change-branch:vc10-public-contract-fixture',
  documentId: xlsxMetadata.documentId,
  status: 'created',
  reason: 'external-workbook-changed',
  importRoot: xlsxImportRootProvenance,
  baseCommitId: xlsxExpectedHead.commitId,
  branchName: 'refs/heads/import/xlsx-external-change',
  branchCommitId: `commit:sha256:${'b'.repeat(64)}` as MogWorkbookVersionXlsxCommitId,
  recordedAt: xlsxMetadata.exportedAt,
  sourcePackageDigest: Object.freeze({
    algorithm: 'sha256',
    digest: '3'.repeat(64),
    byteLength: 4096,
  }),
  externalChangeDigest: Object.freeze({
    algorithm: 'sha256',
    digest: '4'.repeat(64),
  }),
  versionMetadataTrust: xlsxTrustedMetadataTrust,
  diagnostics: Object.freeze([xlsxInteropDiagnostic]),
  redaction: Object.freeze({
    policy: 'commit-document-and-object-digests-only',
    omitted: Object.freeze([
      'sourcePath',
      'sourceFileName',
      'rawWorkbookBytes',
      'authorIdentity',
      'externalDataSecrets',
      'credentials',
    ]),
    sourcePathRedacted: true,
  }),
});

export const VERSIONING_CONTRACT_FIXTURES = Object.freeze({
  digest,
  historyReadModes,
  historyWriteModes,
  versionCapabilityGate,
  domainPolicy,
  domainPresenceDetector,
  controlPlanePreflight,
  controlPlaneCompareAndSwap,
  metadataDiagnostic,
  operationContext,
  runtimeOperationContext,
  mutationSegment,
  publicContractPrivateFieldLeakCount: publicContractPrivateFieldLeakCountZero,
  pendingRemotePromotionResult,
  authorRedactionKey,
  providerRedactionKey,
  captureFailureSinkRecord,
  captureDiagnosticsSink,
  agentProposalRecord,
  agentProposalAcceptedEvent,
  appendAgentProposalEventInput,
  mergePreviewRecord,
  releaseArtifactManifest,
  emergencyDisablePolicy,
  xlsxMetadata,
  xlsxTrustResult,
  xlsxImportRootProvenance,
  xlsxInteropDiagnostic,
  xlsxExternalChangeBranchRecord,
});
