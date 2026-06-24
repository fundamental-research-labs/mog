import type {
  ControlPlaneCapabilityGateRolloutStage,
  ControlPlaneCapabilityGateScope,
  ControlPlaneCasToken,
  ControlPlaneRuntimeKind,
  GateEvidencePreflightDigest,
} from '../control-plane';
import type { VersionHistoryAccessPolicy, VersionRedactionPolicy } from './access-policy';
import type { VersionSyncOperationContext } from './sync-provenance';

export {
  VERSION_HISTORY_DENIED_SUMMARY_KINDS,
  VERSION_HISTORY_DIAGNOSTIC_PROJECTION_MODES,
  VERSION_HISTORY_READ_MODES,
  VERSION_HISTORY_SUMMARY_ONLY_DIAGNOSTIC_PROJECTION_POLICY,
  VERSION_HISTORY_WRITE_MODES,
  VERSION_REDACTION_POLICIES,
} from './access-policy';
export type {
  VersionHistoryAccessDeniedSummary,
  VersionHistoryAccessPolicy,
  VersionHistoryDeniedDiagnosticSummaryPolicy,
  VersionHistoryDeniedSummaryKind,
  VersionHistoryDiagnosticProjectionMode,
  VersionHistoryDiagnosticProjectionPolicy,
  VersionHistoryReadMode,
  VersionHistoryWriteMode,
  VersionRedactionPolicy,
} from './access-policy';
export * from './runtime-contracts';
export {
  VERSION_DIFF_DEFAULT_PAGE_LIMIT,
  VERSION_DIFF_MAX_PAGE_LIMIT,
  VERSION_DIFF_PAGE_ORDER,
  VERSION_DIFF_PAGE_ORDER_VERSION,
  VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH,
  VERSION_DIFF_PUBLIC_CURSOR_ORDER_KEY,
  VERSION_DIFF_PUBLIC_CURSOR_PREFIX,
  VERSION_DIFF_PUBLIC_CURSOR_SCHEMA_VERSION,
  VERSION_DIFF_RESOURCE_LIMITS,
  isPublicVersionDiffCursor,
} from './diff-pagination';
export * from './version-capability-gate';

export const VERSION_OPERATION_KINDS = Object.freeze([
  'mutation',
  'semantic-operation',
  'derived-output-promotion',
  'sync-import',
  'sync-export',
  'merge',
  'revert',
  'review',
] as const);
export type VersionOperationKind = (typeof VERSION_OPERATION_KINDS)[number];

export const CAPTURE_POLICIES = Object.freeze([
  'commitEligible',
  'excluded',
  'derivedOnly',
  'rootCreation',
  'historyGap',
  'shadowOnly',
] as const);
export type CapturePolicy = (typeof CAPTURE_POLICIES)[number];

export const VERSION_WRITE_ADMISSION_MODES = Object.freeze([
  'capture',
  'shadowOnly',
  'captureDisabledNoHistory',
  'captureSuspendedWithGap',
  'block',
] as const);
export type VersionWriteAdmissionMode = (typeof VERSION_WRITE_ADMISSION_MODES)[number];

export const VERSION_DOMAIN_CLASSES = Object.freeze([
  'authored',
  'derived',
  'transient',
  'packageFidelity',
  'secret',
  'external',
] as const);
export type VersionDomainClass = (typeof VERSION_DOMAIN_CLASSES)[number];
export type SemanticDomainClass = VersionDomainClass;

export const VERSION_DOMAIN_CAPABILITY_STATES = Object.freeze([
  'not-started',
  'contracted',
  'supported',
  'derived',
  'excluded',
  'opaque-preserved',
  'opaque-blocking',
] as const);
export type VersionDomainCapabilityState = (typeof VERSION_DOMAIN_CAPABILITY_STATES)[number];

export const VERSION_DOMAIN_CAPABILITY_KEYS = Object.freeze([
  'capture',
  'replay',
  'diff',
  'reviewAccess',
  'checkout',
  'merge',
  'persistence',
  'import',
  'export',
] as const);
export type VersionDomainCapabilityKey = (typeof VERSION_DOMAIN_CAPABILITY_KEYS)[number];
export type VersionDomainCapabilityStateMap = Readonly<
  Record<VersionDomainCapabilityKey, VersionDomainCapabilityState>
>;

export const VERSION_ROLLOUT_STAGES = Object.freeze([
  'disabled',
  'shadow-only',
  'headless-local',
  'ui-beta',
  'collab-interop-beta',
  'default-on',
] as const satisfies readonly ControlPlaneCapabilityGateRolloutStage[]);
export type VersionRolloutStage = (typeof VERSION_ROLLOUT_STAGES)[number];

export const VERSION_HISTORY_GAP_STATUSES = Object.freeze([
  'none',
  'known-gap',
  'unverified-range',
  'truncated',
  'externalized',
] as const);
export type VersionHistoryGapStatus = (typeof VERSION_HISTORY_GAP_STATUSES)[number];

export type VersionActorKind = 'user' | 'service' | 'system' | 'migration' | 'automation';
export type VersionObjectDigestAlgorithm = 'sha256' | 'sha512' | 'blake3' | 'opaque';

export interface ObjectDigest {
  readonly algorithm: VersionObjectDigestAlgorithm;
  readonly value: string;
  readonly byteLength?: number;
}

export interface VersionAuthor {
  readonly authorId: string;
  readonly actorKind: VersionActorKind;
  readonly displayName?: string;
  readonly clientId?: string;
  readonly sessionId?: string;
}

export interface VersionCapabilityGate {
  readonly gateId: string;
  readonly capabilityId: string;
  readonly rolloutStage: VersionRolloutStage;
  readonly scope?: ControlPlaneCapabilityGateScope;
  readonly preflightDigest?: GateEvidencePreflightDigest;
  readonly casToken?: ControlPlaneCasToken;
}

export interface VersionOperationContext {
  readonly operationId: string;
  readonly kind: VersionOperationKind;
  readonly author: VersionAuthor;
  readonly createdAt: string;
  readonly workbookId?: string;
  readonly sheetIds?: readonly string[];
  readonly domainIds: readonly string[];
  readonly groupId?: string;
  readonly capturePolicy: CapturePolicy;
  readonly writeAdmissionMode: VersionWriteAdmissionMode;
  readonly rolloutStage?: VersionRolloutStage;
  readonly capabilityGate?: VersionCapabilityGate;
  readonly clientRequestId?: string;
  readonly collaboration?: VersionSyncOperationContext;
}

export const VERSION_SHADOW_OBSERVATION_CAPTURE_MODES = Object.freeze([
  'shadow',
  'headless-replay',
  'corpus-replay',
  'app-eval',
  'provider-shadow',
] as const);
export type VersionShadowObservationCaptureMode =
  (typeof VERSION_SHADOW_OBSERVATION_CAPTURE_MODES)[number];

export const VERSION_SHADOW_SAMPLE_STATUSES = Object.freeze([
  'observed',
  'skipped',
  'blocked',
  'divergent',
  'pass',
] as const);
export type VersionShadowSampleStatus = (typeof VERSION_SHADOW_SAMPLE_STATUSES)[number];

export interface VersionShadowObservationOptions {
  readonly rolloutStage?: VersionRolloutStage;
  readonly captureMode?: VersionShadowObservationCaptureMode;
  readonly environmentId?: string;
  readonly redactionPolicy?: VersionRedactionPolicy;
  readonly redactionPolicyDigest?: string;
}

export interface VersionShadowObservationArtifactRef {
  readonly artifactId: string;
  readonly kind:
    | 'operation-context'
    | 'admission-classification'
    | 'mutation-result'
    | 'diagnostics';
  readonly digest: ObjectDigest;
  readonly redactionPolicy: VersionRedactionPolicy;
}

export interface VersionShadowMutationObservationRecord {
  readonly schemaVersion: 1;
  readonly recordKind: 'version-shadow-observation';
  readonly observationId: string;
  readonly observedAt: string;
  readonly environmentId: string;
  readonly documentId?: string;
  readonly rolloutStage: VersionRolloutStage;
  readonly captureMode: VersionShadowObservationCaptureMode;
  readonly sampleStatus: VersionShadowSampleStatus;
  readonly operation: {
    readonly command: string;
    readonly operationId?: string;
    readonly operationGroupId?: string;
    readonly kind: VersionOperationKind;
    readonly entrypointIds: readonly string[];
    readonly domainIds: readonly string[];
    readonly sheetIds: readonly string[];
    readonly capturePolicy: CapturePolicy;
    readonly writeAdmissionMode: VersionWriteAdmissionMode;
    readonly domainClass?: VersionDomainClass;
    readonly invocation?: string;
  };
  readonly actor: {
    readonly actorKind?: VersionActorKind | 'unknown';
    readonly redactedAuthorClass: string;
  };
  readonly result: {
    readonly changedCellCount: number;
    readonly directEditCount: number;
    readonly directEditRangeCount: number;
    readonly affectedSheetIds: readonly string[];
    readonly sheetChangeCount: number;
    readonly tableChangeCount: number;
    readonly pivotChangeCount: number;
    readonly chartChangeCount: number;
    readonly validationAnnotationCount: number;
    readonly diagnosticCodes: readonly string[];
  };
  readonly redaction: {
    readonly policy: VersionRedactionPolicy;
    readonly policyDigest?: string;
    readonly omitted: readonly string[];
  };
  readonly sourceArtifactRefs: readonly VersionShadowObservationArtifactRef[];
}

export type VersionShadowObservationRecord = VersionShadowMutationObservationRecord;

export interface VersionShadowObservationSink {
  recordObservation(record: VersionShadowObservationRecord): void | Promise<void>;
}

export const VERSION_REDACTION_KEY_SUBJECTS = Object.freeze([
  'author',
  'session',
  'provider',
  'debug',
] as const);
export type VersionRedactionKeySubject = (typeof VERSION_REDACTION_KEY_SUBJECTS)[number];

export interface VersionRedactionKey {
  readonly keyId: string;
  readonly subject: VersionRedactionKeySubject;
  readonly sourceField: string;
  readonly digest: ObjectDigest;
  readonly policy: VersionRedactionPolicy;
}

export const VERSION_CAPTURE_FAILURE_STAGES = Object.freeze(['admission', 'capture'] as const);
export type VersionCaptureFailureStage = (typeof VERSION_CAPTURE_FAILURE_STAGES)[number];

export const VERSION_CAPTURE_FAILURE_DIAGNOSTIC_CODES = Object.freeze([
  'missing_redaction_key',
  'write_admission_blocked',
  'capture_serialization_failed',
  'diagnostics_sink_unavailable',
] as const);
export type VersionCaptureFailureDiagnosticCode =
  (typeof VERSION_CAPTURE_FAILURE_DIAGNOSTIC_CODES)[number];

export interface VersionCaptureFailureSinkRecord {
  readonly schemaVersion: 1;
  readonly recordKind: 'version-capture-failure';
  readonly diagnosticId: string;
  readonly observedAt: string;
  readonly stage: VersionCaptureFailureStage;
  readonly code: VersionCaptureFailureDiagnosticCode | (string & {});
  readonly severity: VersionVerificationSeverity;
  readonly message: string;
  readonly operationId?: string;
  readonly domainIds?: readonly string[];
  readonly capturePolicy: CapturePolicy;
  readonly writeAdmissionMode: VersionWriteAdmissionMode;
  readonly redactionPolicy: VersionRedactionPolicy;
  readonly redactionKeys?: readonly VersionRedactionKey[];
  readonly missingRedactionFields?: readonly string[];
  readonly debug?: Readonly<Record<string, VersionJsonValue>>;
}

export interface VersionCaptureDiagnosticsSink {
  recordCaptureFailure(record: VersionCaptureFailureSinkRecord): void | Promise<void>;
}

export interface SemanticOperationIntent {
  readonly intentId: string;
  readonly operationKind: VersionOperationKind;
  readonly targetDomainIds: readonly string[];
  readonly userFacing: boolean;
  readonly label?: string;
  readonly reason?: string;
}

export interface VersionOperationGroup {
  readonly groupId: string;
  readonly operations: readonly VersionOperationContext[];
  readonly createdAt: string;
  readonly author: VersionAuthor;
  readonly intent?: SemanticOperationIntent;
}

export interface OpaqueDomainAttachment {
  readonly attachmentId: string;
  readonly domainId: string;
  readonly mediaType: string;
  readonly digest: ObjectDigest;
  readonly redactionPolicy: VersionRedactionPolicy;
  readonly storageRef?: string;
}

export interface VersionMutationSegment {
  readonly segmentId: string;
  readonly domainId: string;
  readonly domainClass: VersionDomainClass;
  readonly capabilityState: VersionDomainCapabilityState;
  readonly operationKind: VersionOperationKind;
  readonly objectIds?: readonly string[];
  readonly beforeDigest?: ObjectDigest;
  readonly afterDigest?: ObjectDigest;
  readonly redactionPolicy: VersionRedactionPolicy;
  readonly attachment?: OpaqueDomainAttachment;
}

export interface VersionHistoryGap {
  readonly gapId: string;
  readonly status: Exclude<VersionHistoryGapStatus, 'none'>;
  readonly domainId?: string;
  readonly fromCommitId?: string;
  readonly toCommitId?: string;
  readonly reason?: string;
}

export interface DomainMutationReceipt {
  readonly receiptId: string;
  readonly domainId: string;
  readonly domainClass: VersionDomainClass;
  readonly operationId: string;
  readonly accepted: boolean;
  readonly capabilityState: VersionDomainCapabilityState;
  readonly capturePolicy: CapturePolicy;
  readonly writeAdmissionMode: VersionWriteAdmissionMode;
  readonly segments: readonly VersionMutationSegment[];
  readonly historyGap?: VersionHistoryGap;
}

export interface SemanticChange {
  readonly changeId: string;
  readonly intent?: SemanticOperationIntent;
  readonly segments: readonly VersionMutationSegment[];
  readonly receipts: readonly DomainMutationReceipt[];
  readonly summary?: string;
}

export type VersionObjectKind =
  | 'workbook-commit'
  | 'mutation-segment'
  | 'domain-receipt'
  | 'opaque-attachment'
  | 'verification-record'
  | 'export-record'
  | 'merge-record'
  | 'revert-record'
  | 'review-record';

export interface VersionObjectHeader {
  readonly objectId: string;
  readonly objectKind: VersionObjectKind;
  readonly schemaVersion: string;
  readonly createdAt: string;
  readonly digest: ObjectDigest;
  readonly redactionPolicy: VersionRedactionPolicy;
  readonly domainId?: string;
}

export interface WorkbookCommitSummary {
  readonly commitId: string;
  readonly workbookId: string;
  readonly parentCommitIds: readonly string[];
  readonly author: VersionAuthor;
  readonly createdAt: string;
  readonly rootDigest: ObjectDigest;
  readonly operationGroupId?: string;
  readonly domainReceipts: readonly DomainMutationReceipt[];
  readonly historyGapStatus: VersionHistoryGapStatus;
  readonly verificationRecordId?: string;
}

export interface WorkbookCommitPersistedShape {
  readonly header: VersionObjectHeader;
  readonly summary: WorkbookCommitSummary;
  readonly mutationSegments?: readonly VersionMutationSegment[];
  readonly opaqueAttachments?: readonly OpaqueDomainAttachment[];
  readonly exportMetadata?: VersionExportMetadataSummary;
  readonly syncProvenance?: VersionSyncProvenanceEnvelope;
}

export type VersionHistoryRootGapPolicy = 'reject' | 'record-gap' | 'allow-opaque-root';

export interface VersionHistoryRootPolicy {
  readonly rootCommitId?: string;
  readonly allowDetachedRoots: boolean;
  readonly gapPolicy: VersionHistoryRootGapPolicy;
}

export interface ReplayEnvironment {
  readonly environmentId: string;
  readonly runtimeKind: ControlPlaneRuntimeKind;
  readonly packageVersions: Readonly<Record<string, string>>;
  readonly featureGates?: readonly VersionCapabilityGate[];
  readonly locale?: string;
  readonly timeZone?: string;
}

export type DerivedOutputPromotionMode =
  | 'never'
  | 'on-verified-replay'
  | 'on-authorized-write'
  | 'always-shadow';

export interface DerivedOutputPromotionPolicy {
  readonly mode: DerivedOutputPromotionMode;
  readonly closureRequired: boolean;
  readonly attachSourceDigests: boolean;
}

export interface FormulaDependencyClosure {
  readonly closureId: string;
  readonly rootFormulaObjectIds: readonly string[];
  readonly dependencyObjectIds: readonly string[];
  readonly includesVolatileFunctions: boolean;
  readonly digest?: ObjectDigest;
}

export type EntityLifecycleState = 'active' | 'tombstoned' | 'purged';
export type TombstoneRetentionPolicy = 'none' | 'until-compacted' | 'forever' | 'policy-defined';

export interface EntityLifecycleAndTombstonePolicy {
  readonly lifecycleStates: readonly EntityLifecycleState[];
  readonly tombstoneRetention: TombstoneRetentionPolicy;
  readonly preserveIds: boolean;
  readonly allowResurrection: boolean;
}

export interface DomainCapabilityPolicyManifest {
  readonly domainPolicyId: string;
  readonly matrixRowId: string;
  readonly domainId: string;
  readonly domainClass: VersionDomainClass;
  readonly capabilityStates: VersionDomainCapabilityStateMap;
  /** @deprecated Use capabilityStates keyed by VersionDomainCapabilityKey. */
  readonly capabilityState?: VersionDomainCapabilityState;
  readonly capturePolicy: CapturePolicy;
  readonly writeAdmissionMode: VersionWriteAdmissionMode;
  readonly rolloutStage: VersionRolloutStage;
  readonly historyAccess: VersionHistoryAccessPolicy;
  readonly redactionPolicy: VersionRedactionPolicy;
  readonly derivedOutputPromotion?: DerivedOutputPromotionPolicy;
  readonly lifecyclePolicy?: EntityLifecycleAndTombstonePolicy;
}

export interface VersionDomainPolicyRegistry {
  readonly schemaVersion: string;
  readonly domains: readonly DomainCapabilityPolicyManifest[];
  readonly defaultHistoryRootPolicy: VersionHistoryRootPolicy;
}

export interface DomainSupportManifest {
  readonly schemaVersion: string;
  readonly generatedAt: string;
  readonly workbookId?: string;
  readonly domains: readonly DomainCapabilityPolicyManifest[];
}

export interface DomainPresenceDetector {
  readonly detectorId: string;
  readonly matrixRowId: string;
  readonly domainId: string;
  readonly domainClass: VersionDomainClass;
  readonly detectsObjectKinds: readonly string[];
  readonly capabilityStatesWhenPresent: VersionDomainCapabilityStateMap;
  /** @deprecated Use capabilityStatesWhenPresent keyed by VersionDomainCapabilityKey. */
  readonly capabilityStateWhenPresent?: VersionDomainCapabilityState;
}

export type VersionVerificationStatus = 'not-run' | 'passed' | 'failed' | 'inconclusive';
export type VersionVerificationSeverity = 'info' | 'warning' | 'error';

export interface VersionVerificationDiagnostic {
  readonly severity: VersionVerificationSeverity;
  readonly code: string;
  readonly message?: string;
  readonly domainId?: string;
}

export interface VersionCommitCreationVerification {
  readonly verificationId: string;
  readonly status: VersionVerificationStatus;
  readonly createdAt: string;
  readonly commitId?: string;
  readonly checks: readonly string[];
  readonly diagnostics?: readonly VersionVerificationDiagnostic[];
}

export interface VersionVerificationRecord {
  readonly recordId: string;
  readonly verification: VersionCommitCreationVerification;
  readonly replayEnvironment: ReplayEnvironment;
  readonly objectDigests: readonly ObjectDigest[];
}

export interface ShadowOnlyObjectAuthority {
  readonly authorityId: string;
  readonly domainId: string;
  readonly objectKinds: readonly string[];
  readonly capabilityState: VersionDomainCapabilityState;
  readonly capturePolicy: Extract<CapturePolicy, 'shadowOnly'>;
  readonly writeAdmissionMode: Extract<VersionWriteAdmissionMode, 'shadowOnly'>;
}

export interface VersionExportMetadataSummary {
  readonly exportId: string;
  readonly format: string;
  readonly createdAt: string;
  readonly includedDomainIds: readonly string[];
  readonly redactionPolicy: VersionRedactionPolicy;
  readonly digest: ObjectDigest;
}

export interface VersionRedactionSummary {
  readonly redactionId: string;
  readonly policy: VersionRedactionPolicy;
  readonly redactedObjectCount: number;
  readonly redactedFieldCount: number;
  readonly preservedDigests: readonly ObjectDigest[];
}

export interface VersionSyncProvenanceEnvelope {
  readonly syncId: string;
  readonly sourceSystem: string;
  readonly importedAt: string;
  readonly sourceVersion?: string;
  readonly mappingDigest?: ObjectDigest;
  readonly domainReceipts: readonly DomainMutationReceipt[];
}

export type VersionJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly VersionJsonValue[]
  | { readonly [key: string]: VersionJsonValue };

export interface VersionMetadataDiagnostic {
  readonly severity: VersionVerificationSeverity;
  readonly code: string;
  readonly message: string;
  readonly domainId?: string;
  readonly data?: Readonly<Record<string, VersionJsonValue>>;
}

export type VersionPendingRemoteSegmentId = `pending-remote-segment:sha256:${string}` & {
  readonly __brand?: 'VersionPendingRemoteSegmentId';
};

export const VERSION_PENDING_REMOTE_PROMOTION_STATUSES = Object.freeze([
  'success',
  'partial',
  'failed',
] as const);
export type VersionPendingRemotePromotionStatus =
  (typeof VERSION_PENDING_REMOTE_PROMOTION_STATUSES)[number];

export const VERSION_PENDING_REMOTE_PROMOTION_SKIP_REASONS = Object.freeze([
  'batch-status-read-failed',
  'batch-status-terminal',
  'completion-failed',
  'graph-ref-unavailable',
  'graph-write-failed',
  'inconsistent-group',
  'ineligible-operation-context',
  'ineligible-state',
  'invalid-required-object',
  'missing-required-object',
  'missing-semantic-change-set',
  'missing-snapshot-root',
  'provider-authority-stale',
  'provider-authority-unknown',
  'provider-read-failed',
] as const);
export type VersionPendingRemotePromotionSkipReason =
  (typeof VERSION_PENDING_REMOTE_PROMOTION_SKIP_REASONS)[number];

export const VERSION_PENDING_REMOTE_PROMOTION_DIAGNOSTIC_CODES = Object.freeze([
  'VERSION_PENDING_REMOTE_PROMOTION_AUTHORITY_BLOCKED',
  'VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED',
  'VERSION_PENDING_REMOTE_PROMOTION_COMPLETION_FAILED',
  'VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED',
  'VERSION_PENDING_REMOTE_PROMOTION_INELIGIBLE',
  'VERSION_PENDING_REMOTE_PROMOTION_OBJECT_READ_FAILED',
  'VERSION_PENDING_REMOTE_PROMOTION_STORE_UNAVAILABLE',
] as const);
export type VersionPendingRemotePromotionDiagnosticCode =
  (typeof VERSION_PENDING_REMOTE_PROMOTION_DIAGNOSTIC_CODES)[number];

export interface VersionPendingRemotePromotionDiagnostic extends VersionMetadataDiagnostic {
  readonly code: VersionPendingRemotePromotionDiagnosticCode | (string & {});
  readonly reason?: VersionPendingRemotePromotionSkipReason;
  readonly segmentId?: VersionPendingRemoteSegmentId;
  readonly commitId?: string;
}

export interface VersionPendingRemotePromotionSkippedSegment {
  readonly segmentId: VersionPendingRemoteSegmentId;
  readonly reason: VersionPendingRemotePromotionSkipReason;
  readonly message: string;
  readonly commitId?: string;
}

export interface VersionPendingRemotePromotionResultMetadata {
  readonly schemaVersion: 1;
  readonly promotionId: string;
  readonly status: VersionPendingRemotePromotionStatus;
  readonly promotedSegmentIds: readonly VersionPendingRemoteSegmentId[];
  readonly commitIds: readonly string[];
  readonly skipped: readonly VersionPendingRemotePromotionSkippedSegment[];
  readonly diagnostics: readonly VersionPendingRemotePromotionDiagnostic[];
  readonly promotedAt: string;
}

export const VERSION_AGENT_PROPOSAL_STATUSES = Object.freeze([
  'draft',
  'workspace_open',
  'committed',
  'verified',
  'ready_for_review',
  'rejected',
  'stale',
  'superseded',
  'merge_conflicted',
  'failed',
  'applied',
] as const);
export type VersionAgentProposalStatus = (typeof VERSION_AGENT_PROPOSAL_STATUSES)[number];

export type VersionAgentProposalId = string & {
  readonly __brand?: 'VersionAgentProposalId';
};

export type VersionAgentProposalAcceptResolutionPolicy =
  | 'fastForwardOnly'
  | 'allowCleanMerge'
  | 'allowResolvedMerge';

export interface VersionProposalVerificationCheck {
  readonly name: string;
  readonly status: 'passed' | 'failed' | 'blocked';
  readonly command?: string;
  readonly artifactRef?: string;
  readonly diagnostics: readonly VersionMetadataDiagnostic[];
}

export interface VersionProposalVerificationSummary {
  readonly status: 'not_run' | 'passed' | 'failed' | 'blocked';
  readonly checks: readonly VersionProposalVerificationCheck[];
  readonly createdAt: string;
  readonly trust?: 'trusted' | 'untrusted' | 'unknown';
  readonly attestationDigest?: ObjectDigest;
}

export interface VersionAgentProposalSummary {
  readonly id: VersionAgentProposalId;
  readonly documentId: string;
  readonly title: string;
  readonly targetRef: string;
  readonly baseCommitId: string;
  readonly targetHeadIdAtCreation: string;
  readonly proposalBranchName: string;
  readonly proposalBranchNameHint?: string;
  readonly proposalCommitId?: string;
  readonly status: VersionAgentProposalStatus;
  readonly revision: number;
  readonly agentRunId: string;
  readonly agent: VersionAuthor;
  readonly updatedAt: string;
}

export type VersionAgentProposalAcceptResult =
  | {
      readonly status: 'fast_forwarded';
      readonly proposalId: VersionAgentProposalId;
      readonly appliedCommitId: string;
      readonly targetRef: string;
      readonly newHeadId: string;
      readonly refUpdateReceiptId: string;
    }
  | {
      readonly status: 'merge_applied';
      readonly proposalId: VersionAgentProposalId;
      readonly mergeCommitId: string;
      readonly targetRef: string;
      readonly newHeadId: string;
      readonly mergePreviewId: string;
      readonly refUpdateReceiptId: string;
    }
  | {
      readonly status: 'merge_conflicted';
      readonly proposalId: VersionAgentProposalId;
      readonly mergePreviewId: string;
      readonly conflictIds: readonly string[];
    }
  | {
      readonly status: 'stale';
      readonly proposalId: VersionAgentProposalId;
      readonly expectedTargetHeadId: string;
      readonly actualTargetHeadId: string;
    };

export interface VersionAgentProposalRecord extends VersionAgentProposalSummary {
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly createdBy: VersionAuthor;
  readonly lastActor?: VersionAuthor;
  readonly workspaceId?: string;
  readonly reviewId?: string;
  readonly verification?: VersionProposalVerificationSummary;
  readonly accepted?: VersionAgentProposalAcceptResult;
  readonly supersededByProposalId?: VersionAgentProposalId;
  readonly rejectionReason?: string;
  readonly failureReason?: string;
  readonly supersedeReason?: string;
  readonly redaction: VersionRedactionSummary;
  readonly diagnostics: readonly VersionMetadataDiagnostic[];
}

export type VersionAgentProposalEvent =
  | {
      readonly kind: 'created';
      readonly clientRequestId: string;
      readonly actor: VersionAuthor;
      readonly title: string;
      readonly targetRef: string;
      readonly baseCommitId: string;
      readonly targetHeadIdAtCreation: string;
      readonly proposalBranchName: string;
      readonly proposalBranchNameHint?: string;
      readonly agentRunId: string;
      readonly agent: VersionAuthor;
      readonly redactionPolicy: VersionRedactionPolicy;
      readonly createdAt: string;
    }
  | {
      readonly kind: 'workspaceStarted';
      readonly clientRequestId: string;
      readonly actor: VersionAuthor;
      readonly workspaceId: string;
      readonly createdAt: string;
    }
  | {
      readonly kind: 'workspaceCommitted';
      readonly clientRequestId: string;
      readonly actor: VersionAuthor;
      readonly proposalCommitId: string;
      readonly verification?: VersionProposalVerificationSummary;
      readonly createdAt: string;
    }
  | {
      readonly kind: 'verificationMarked';
      readonly clientRequestId: string;
      readonly actor: VersionAuthor;
      readonly verification: VersionProposalVerificationSummary;
      readonly createdAt: string;
    }
  | {
      readonly kind: 'reviewOpened';
      readonly clientRequestId: string;
      readonly actor: VersionAuthor;
      readonly reviewId: string;
      readonly createdAt: string;
    }
  | {
      readonly kind: 'acceptIntent';
      readonly clientRequestId: string;
      readonly actor: VersionAuthor;
      readonly targetRef: string;
      readonly expectedTargetHeadId: string;
      readonly proposalCommitId: string;
      readonly resolutionPolicy: VersionAgentProposalAcceptResolutionPolicy;
      readonly createdAt: string;
    }
  | {
      readonly kind: 'accepted';
      readonly clientRequestId: string;
      readonly actor: VersionAuthor;
      readonly result: VersionAgentProposalAcceptResult;
      readonly reviewApplied: boolean;
      readonly createdAt: string;
    }
  | {
      readonly kind: 'rejected';
      readonly clientRequestId: string;
      readonly actor: VersionAuthor;
      readonly reason?: string;
      readonly createdAt: string;
    }
  | {
      readonly kind: 'superseded';
      readonly clientRequestId: string;
      readonly actor: VersionAuthor;
      readonly supersededByProposalId?: VersionAgentProposalId;
      readonly reason?: string;
      readonly createdAt: string;
    }
  | {
      readonly kind: 'failed';
      readonly clientRequestId: string;
      readonly actor: VersionAuthor;
      readonly diagnostics: readonly VersionMetadataDiagnostic[];
      readonly createdAt: string;
    };

export interface VersionAppendAgentProposalEventInput {
  readonly proposalId: VersionAgentProposalId;
  readonly expectedRevision: number;
  readonly event: VersionAgentProposalEvent;
}

export const VERSION_MERGE_PREVIEW_RECORD_STATUSES = Object.freeze([
  'clean',
  'conflicted',
  'applied',
  'superseded',
] as const);
export type VersionMergePreviewRecordStatus =
  (typeof VERSION_MERGE_PREVIEW_RECORD_STATUSES)[number];

export interface VersionMergePreviewRecord {
  readonly schemaVersion: 1;
  readonly mergePreviewId: string;
  readonly documentId: string;
  readonly targetRef?: string;
  readonly baseCommitId: string;
  readonly oursCommitId: string;
  readonly theirsCommitId: string;
  readonly status: VersionMergePreviewRecordStatus;
  readonly revision: number;
  readonly conflictIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resultDigest: ObjectDigest;
  readonly resultObjectRef?: ObjectDigest;
  readonly applyTokenDigest?: ObjectDigest;
  readonly resolutionState?: VersionJsonValue;
  readonly diagnostics: readonly VersionMetadataDiagnostic[];
}

export type VersionMergeRecordStatus = 'planned' | 'applied' | 'rejected' | 'requires-review';
export type VersionRevertRecordStatus = 'planned' | 'applied' | 'rejected' | 'requires-review';
export type VersionReviewRecordStatus = 'pending' | 'approved' | 'rejected' | 'changes-requested';

export interface VersionMergeRecord {
  readonly mergeId: string;
  readonly sourceCommitIds: readonly string[];
  readonly conflictCount: number;
  readonly status: VersionMergeRecordStatus;
  readonly baseCommitId?: string;
  readonly resultCommitId?: string;
  readonly resultId?: string;
  readonly resultDigest?: ObjectDigest;
  readonly reviewId?: string;
  readonly diagnostics?: readonly VersionMetadataDiagnostic[];
}

export interface VersionRevertRecord {
  readonly revertId: string;
  readonly targetCommitId: string;
  readonly status: VersionRevertRecordStatus;
  readonly resultCommitId?: string;
  readonly reason?: string;
}

export interface VersionReviewRecord {
  readonly reviewId: string;
  readonly subjectCommitId: string;
  readonly status: VersionReviewRecordStatus;
  readonly reviewer?: VersionAuthor;
  readonly notes?: string;
  readonly proposalId?: VersionAgentProposalId;
  readonly mergePreviewId?: string;
  readonly revision?: number;
  readonly diagnostics?: readonly VersionMetadataDiagnostic[];
}

export * from './emergency-disable-policy';
export * from './release-artifact-manifest';
export * from './semantic-merge-support';
export type {
  VersionSyncAuthorState,
  VersionSyncBatchStatusState,
  VersionSyncCommitGrouping,
  VersionSyncOperationContext,
  VersionSyncOriginKind,
  VersionSyncSourceKind,
  VersionSyncTrustStatus,
} from './sync-provenance';
export * from './sync-provenance-fixtures';
export * from './xlsx-interop';
export { VERSIONING_CONTRACT_FIXTURES } from './fixtures';
export {
  createPublicVersionDomainSupportManifest,
  PUBLIC_VERSION_DOMAIN_DEFAULT_MANIFEST_MATRIX_ROW_IDS,
  PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS,
  PUBLIC_VERSION_DOMAIN_POLICY_IDS,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_ALL_ROWS,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_REQUIRED_ROWS,
  PUBLIC_VERSION_DOMAIN_POLICY_ROW_COUNT,
  VERSION_DOMAIN_POLICY_ID_PATTERN,
  VERSION_DOMAIN_POLICY_REGISTRY_SCHEMA_VERSION,
} from './domain-policy-registry';
