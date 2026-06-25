import type { VersionCapabilityDependency, VersionDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import type { SurfaceVersionCapability } from './version-surface-status-service';

export type MaybeVersionRuntimeContext = DocumentContext & {
  readonly featureGates?: unknown;
  readonly hostFeatureGates?: unknown;
  readonly gates?: unknown;
  readonly lowerGateEvidence?: unknown;
  readonly rolloutEvidence?: unknown;
  readonly surfaceStatusEvidence?: unknown;
  readonly surfaceStatusLowerGateEvidence?: unknown;
};

export type CapabilityArea = 'reads' | 'writes';
export type VersionDomainSupportOperation =
  | 'commit'
  | 'checkout'
  | 'merge'
  | 'applyMerge'
  | 'revert';

export type LowerGateIssue = {
  readonly diagnostic: VersionDiagnostic;
};

export type VersionSurfaceCapabilityAvailability = {
  readonly read: boolean;
  readonly diff: boolean;
  readonly commit: boolean;
  readonly branch: boolean;
  readonly checkout: boolean;
  readonly reviewRead: boolean;
  readonly reviewWrite: boolean;
  readonly proposal: boolean;
  readonly mergePreview: boolean;
  readonly mergeApply: boolean;
  readonly refAdmin: boolean;
  readonly revert: boolean;
  readonly provenance: boolean;
  readonly remotePromote: boolean;
};

export type VersionSurfaceCapabilityBlock = {
  readonly dependency: VersionCapabilityDependency;
  readonly reason: string;
  readonly retryable: boolean;
  readonly code: VersionDiagnostic['code'];
  readonly diagnostics?: readonly VersionDiagnostic[];
};

export type VersionSurfaceCapabilityBlocks = Partial<
  Record<SurfaceVersionCapability, VersionSurfaceCapabilityBlock>
>;

export type VersionSurfaceOperationFeatureGates = {
  readonly checkoutEnabled: boolean;
  readonly checkoutDiscovered: boolean;
  readonly revertEnabled: boolean;
  readonly revertDiscovered: boolean;
};
