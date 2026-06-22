import type {
  ControlPlaneCapabilityGateRolloutStage,
  ControlPlaneCapabilityGateScope,
  ControlPlaneCasToken,
  ControlPlaneRuntimeKind,
  GateEvidencePreflightDigest,
} from '../control-plane';

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

export const VERSION_REDACTION_POLICIES = Object.freeze([
  'none',
  'metadata-only',
  'content-redacted',
  'opaque-digest-only',
  'drop',
] as const);
export type VersionRedactionPolicy = (typeof VERSION_REDACTION_POLICIES)[number];

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

export type VersionSyncSourceKind =
  | 'providerReplay'
  | 'providerLiveInbound'
  | 'providerMixedInbound'
  | 'collaborationHydration'
  | 'collaborationLiveRemote'
  | 'collaborationMixedRemote'
  | 'importHydration'
  | 'systemRepair'
  | 'legacyRawUnknown';

export type VersionSyncOriginKind = 'provider' | 'room' | 'import' | 'system' | 'legacyRaw';
export type VersionSyncTrustStatus = 'verified' | 'trustedLocalSystem' | 'unverified' | 'legacyRaw';
export type VersionSyncAuthorState = 'singleRemote' | 'mixedRemote' | 'unknown' | 'agent' | 'system';
export type VersionSyncCommitGrouping =
  | 'none'
  | 'pendingRemote'
  | 'excludedLifecycle'
  | 'blockedMissingRedactionKey'
  | 'blockedMixedRemote'
  | 'blockedUnknownRemote'
  | 'blockedUnverified';

export interface VersionSyncOperationContext {
  readonly sourceKind: VersionSyncSourceKind;
  readonly originKind: VersionSyncOriginKind;
  readonly stableOriginId?: string;
  readonly providerId?: string;
  readonly providerKind?: string;
  readonly authorityRef?: string;
  readonly roomId?: string;
  readonly epoch?: string;
  readonly updateId?: string;
  readonly sequence?: string;
  readonly payloadHash: string;
  readonly provenancePayloadHash?: string;
  readonly trustStatus: VersionSyncTrustStatus;
  readonly authorState: VersionSyncAuthorState;
  readonly remoteSessionId?: string;
  readonly correlationId?: string;
  readonly causationIds?: readonly string[];
  readonly replay: boolean;
  readonly system: boolean;
  readonly commitGrouping: VersionSyncCommitGrouping;
  readonly validationDiagnosticCount: number;
  readonly exclusionReason?: string;
  readonly exclusionSubreason?: string;
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

export type VersionHistoryReadMode = 'none' | 'metadata-only' | 'full';
export type VersionHistoryWriteMode = 'none' | 'shadow-only' | 'gated' | 'full';

export interface VersionHistoryAccessPolicy {
  readonly readMode: VersionHistoryReadMode;
  readonly writeMode: VersionHistoryWriteMode;
  readonly redactionPolicy: VersionRedactionPolicy;
  readonly allowedDomainIds?: readonly string[];
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
  readonly domainId: string;
  readonly domainClass: VersionDomainClass;
  readonly capabilityState: VersionDomainCapabilityState;
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
  readonly domainId: string;
  readonly domainClass: VersionDomainClass;
  readonly detectsObjectKinds: readonly string[];
  readonly capabilityStateWhenPresent: VersionDomainCapabilityState;
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
}

export { VERSIONING_CONTRACT_FIXTURES } from './fixtures';
