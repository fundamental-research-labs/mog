import type { ControlPlaneCapabilityGateScope } from '../control-plane';
import type {
  ObjectDigest,
  VersionMetadataDiagnostic,
  VersionRedactionPolicy,
  VersionRolloutStage,
} from './index';

export const EMERGENCY_DISABLE_POLICY_SCHEMA_VERSION =
  'mog.versioning.emergencyDisablePolicy.v1' as const;
export type EmergencyDisablePolicySchemaVersion = typeof EMERGENCY_DISABLE_POLICY_SCHEMA_VERSION;

export const EMERGENCY_DISABLE_AUTHORITY_KINDS = Object.freeze([
  'user',
  'service',
  'security',
  'release-operator',
  'system',
] as const);
export type EmergencyDisableAuthorityKind = (typeof EMERGENCY_DISABLE_AUTHORITY_KINDS)[number];

export const EMERGENCY_DISABLE_INCIDENT_CATEGORIES = Object.freeze([
  'security',
  'privacy',
  'integrity',
  'availability',
  'release',
  'operator-request',
] as const);
export type EmergencyDisableIncidentCategory =
  (typeof EMERGENCY_DISABLE_INCIDENT_CATEGORIES)[number];

export const EMERGENCY_DISABLE_SIGNATURE_ALGORITHMS = Object.freeze([
  'ed25519',
  'ecdsa-p256',
  'opaque',
] as const);
export type EmergencyDisableSignatureAlgorithm =
  (typeof EMERGENCY_DISABLE_SIGNATURE_ALGORITHMS)[number];

export const EMERGENCY_DISABLE_DISTRIBUTION_CHANNEL_KINDS = Object.freeze([
  'config',
  'release-channel',
  'control-plane',
  'offline-signed-material',
  'other',
] as const);
export type EmergencyDisableDistributionChannelKind =
  (typeof EMERGENCY_DISABLE_DISTRIBUTION_CHANNEL_KINDS)[number];

export const EMERGENCY_DISABLE_IN_FLIGHT_TRANSITIONS = Object.freeze([
  'finalize-if-committed',
  'abort-before-mutation',
  'record-history-gap',
  'quarantine-provider-update',
  'create-reconcile-root',
] as const);
export type EmergencyDisableInFlightTransition =
  (typeof EMERGENCY_DISABLE_IN_FLIGHT_TRANSITIONS)[number];

export const EMERGENCY_DISABLE_DRILL_CHECKS = Object.freeze([
  'enabled-clients-observe-disable',
  'stale-gate-cache-overridden',
  'normal-config-channel-impaired',
  'offline-version-apis-fail-closed',
  'in-flight-transition-reconciled',
] as const);
export type EmergencyDisableDrillCheck = (typeof EMERGENCY_DISABLE_DRILL_CHECKS)[number];

export const EMERGENCY_DISABLE_AUDIT_RECORD_FIELDS = Object.freeze([
  'recordKind',
  'incidentId',
  'policyId',
  'scopeDigest',
  'category',
  'createdAt',
  'expiresAt',
  'signerKeyIds',
  'signalDigest',
  'decisionDigest',
  'reconciliationStatus',
] as const);
export type EmergencyDisableAuditRecordField =
  (typeof EMERGENCY_DISABLE_AUDIT_RECORD_FIELDS)[number];

export interface EmergencyDisableAuthorityRef {
  readonly authorityId: string;
  readonly kind: EmergencyDisableAuthorityKind;
  readonly displayName?: string;
}

export interface EmergencyDisableAuthorityPolicy {
  readonly authorities: readonly EmergencyDisableAuthorityRef[];
  readonly requiredApprovalCount: number;
  readonly minimumDistinctAuthorityKinds?: number;
  readonly allowedIncidentCategories: readonly EmergencyDisableIncidentCategory[];
  readonly authorizedScopes?: readonly ControlPlaneCapabilityGateScope[];
}

export interface EmergencyDisableSignaturePolicy {
  readonly acceptedPublicKeyIds: readonly string[];
  readonly signatureAlgorithm: EmergencyDisableSignatureAlgorithm;
  readonly keyCustodyDigest?: ObjectDigest;
}

export interface EmergencyDisableDistributionChannel {
  readonly channelId: string;
  readonly kind: EmergencyDisableDistributionChannelKind;
  readonly independentOfNormalConfig: boolean;
  readonly scope?: ControlPlaneCapabilityGateScope;
}

export interface EmergencyDisableDistributionPolicy {
  readonly channels: readonly EmergencyDisableDistributionChannel[];
  readonly maxPropagationMinutes: number;
  readonly configRefreshIntervalMinutes?: number;
}

export interface EmergencyDisableReplayProtectionPolicy {
  readonly monotonicIncidentIdRequired: boolean;
  readonly expiryRequired: boolean;
  readonly nonceRequired: boolean;
  readonly maxSignalAgeMinutes?: number;
  readonly clockSkewAllowanceMinutes?: number;
}

export interface EmergencyDisableOfflineBehaviorPolicy {
  readonly versionApis: 'fail-closed';
  readonly metadataImportExport: 'fail-closed';
  readonly staleGateCache: 'override-with-break-glass' | 'fail-closed';
}

export interface EmergencyDisableInFlightPolicy {
  readonly defaultTransition: EmergencyDisableInFlightTransition;
  readonly allowedTransitions: readonly EmergencyDisableInFlightTransition[];
}

export interface EmergencyDisableAuditPolicy {
  readonly recordKind: 'version-emergency-disable';
  readonly requiredFields: readonly EmergencyDisableAuditRecordField[];
  readonly redactionPolicy: VersionRedactionPolicy;
}

export interface EmergencyDisableDrillRequirements {
  readonly requiredCadenceDays: number;
  readonly maxObservedPropagationMinutes: number;
  readonly requiredChecks: readonly EmergencyDisableDrillCheck[];
}

export interface EmergencyDisablePolicy {
  readonly schemaVersion: EmergencyDisablePolicySchemaVersion;
  readonly policyId: string;
  readonly policyDigest?: ObjectDigest;
  readonly createdAt: string;
  readonly appliesTo: ControlPlaneCapabilityGateScope;
  readonly rolloutStages: readonly VersionRolloutStage[];
  readonly authority: EmergencyDisableAuthorityPolicy;
  readonly signature: EmergencyDisableSignaturePolicy;
  readonly distribution: EmergencyDisableDistributionPolicy;
  readonly replayProtection: EmergencyDisableReplayProtectionPolicy;
  readonly offlineBehavior: EmergencyDisableOfflineBehaviorPolicy;
  readonly inFlight: EmergencyDisableInFlightPolicy;
  readonly audit: EmergencyDisableAuditPolicy;
  readonly drill: EmergencyDisableDrillRequirements;
  readonly diagnostics?: readonly VersionMetadataDiagnostic[];
}
