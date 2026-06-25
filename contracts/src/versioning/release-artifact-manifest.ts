import type {
  ControlPlaneArtifactRuntimeRange,
  ControlPlaneCapabilityGateScope,
  ControlPlaneCapabilityGateStage,
} from '../control-plane';
import type { ObjectDigest, VersionMetadataDiagnostic } from './index';

export const RELEASE_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  'mog.versioning.releaseArtifactManifest.v1' as const;
export type ReleaseArtifactManifestSchemaVersion = typeof RELEASE_ARTIFACT_MANIFEST_SCHEMA_VERSION;

export const RELEASE_ARTIFACT_KINDS = Object.freeze([
  'npm-package',
  'web-bundle',
  'desktop-app',
  'vscode-extension',
  'python-wheel',
  'wasm-package',
  'container-image',
  'metadata',
] as const);
export type ReleaseArtifactKind = (typeof RELEASE_ARTIFACT_KINDS)[number];

export const RELEASE_ARTIFACT_DEPLOYMENT_KINDS = Object.freeze([
  'deploy',
  'channel',
  'marketplace',
  'registry',
] as const);
export type ReleaseArtifactDeploymentKind = (typeof RELEASE_ARTIFACT_DEPLOYMENT_KINDS)[number];

export const RELEASE_ARTIFACT_ROLLBACK_STRATEGIES = Object.freeze([
  'disable-gate',
  'restore-prior-artifact',
  'preserve-or-block-newer-objects',
  'manual',
] as const);
export type ReleaseArtifactRollbackStrategy = (typeof RELEASE_ARTIFACT_ROLLBACK_STRATEGIES)[number];

export const RELEASE_ARTIFACT_RETENTION_CLASSES = Object.freeze([
  'release',
  'candidate',
  'quarantine',
  'ephemeral',
] as const);
export type ReleaseArtifactRetentionClass = (typeof RELEASE_ARTIFACT_RETENTION_CLASSES)[number];

export const RELEASE_ARTIFACT_QUARANTINE_BEHAVIORS = Object.freeze([
  'block-promotion',
  'disable-channel',
  'retain-for-investigation',
] as const);
export type ReleaseArtifactQuarantineBehavior =
  (typeof RELEASE_ARTIFACT_QUARANTINE_BEHAVIORS)[number];

export interface ReleaseArtifactManifestArtifact {
  readonly artifactId: string;
  readonly kind: ReleaseArtifactKind;
  readonly digest: ObjectDigest;
  readonly packageName?: string;
  readonly packageVersion?: string;
  readonly fileName?: string;
  readonly mediaType?: string;
  readonly byteLength?: number;
}

export interface ReleaseArtifactDeploymentTarget {
  readonly deployOrChannelId: string;
  readonly kind: ReleaseArtifactDeploymentKind;
  readonly artifactIds: readonly string[];
  readonly runtimeRange?: ControlPlaneArtifactRuntimeRange;
  readonly digest?: ObjectDigest;
}

export interface ReleaseArtifactCapabilityGateTarget {
  readonly gateId: string;
  readonly targetStage: ControlPlaneCapabilityGateStage;
  readonly scope?: ControlPlaneCapabilityGateScope;
  readonly runtimeRange?: ControlPlaneArtifactRuntimeRange;
  readonly releaseArtifactDigest: ObjectDigest;
}

export interface ReleaseArtifactRollbackTarget {
  readonly strategy: ReleaseArtifactRollbackStrategy;
  readonly targetArtifactId?: string;
  readonly targetDeployOrChannelId?: string;
  readonly targetDigest?: ObjectDigest;
  readonly preserveOrBlockNewerObjects: boolean;
}

export interface ReleaseArtifactRetentionPolicy {
  readonly retentionClass: ReleaseArtifactRetentionClass;
  readonly quarantineBehavior: ReleaseArtifactQuarantineBehavior;
  readonly retainUntil?: string;
}

export interface ReleaseArtifactManifest {
  readonly schemaVersion: ReleaseArtifactManifestSchemaVersion;
  readonly manifestId: string;
  readonly releaseId: string;
  readonly createdAt: string;
  readonly manifestBodyDigest?: ObjectDigest;
  readonly releaseArtifactDigest: ObjectDigest;
  readonly sourceRepoShas: Readonly<Record<string, string>>;
  readonly buildEnvironmentDigest?: ObjectDigest;
  readonly artifacts: readonly ReleaseArtifactManifestArtifact[];
  readonly packageVersions?: Readonly<Record<string, string>>;
  readonly deployments?: readonly ReleaseArtifactDeploymentTarget[];
  readonly testedClientRuntimeRange?: string;
  readonly capabilityGateTargetRuntimeRange?: string;
  readonly capabilityGateTargets?: readonly ReleaseArtifactCapabilityGateTarget[];
  readonly provenanceAttestationDigest?: ObjectDigest;
  readonly rollback: ReleaseArtifactRollbackTarget;
  readonly retention: ReleaseArtifactRetentionPolicy;
  readonly diagnostics?: readonly VersionMetadataDiagnostic[];
}
