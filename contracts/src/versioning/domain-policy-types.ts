import type { VersionRedactionPolicy } from './access-policy';

export const VERSION_DOMAIN_POLICY_SURFACE_KINDS = Object.freeze([
  'history',
  'review',
  'merge',
  'persistence',
  'import',
  'export',
  'diagnostics',
  'object-store',
  'support-manifest',
] as const);
export type VersionDomainPolicySurfaceKind = (typeof VERSION_DOMAIN_POLICY_SURFACE_KINDS)[number];

export const VERSION_DOMAIN_POLICY_SURFACE_SENSITIVITIES = Object.freeze([
  'public-metadata',
  'authored-content',
  'opaque-payload',
  'external-target',
  'credential',
  'secret',
] as const);
export type VersionDomainPolicySurfaceSensitivity =
  (typeof VERSION_DOMAIN_POLICY_SURFACE_SENSITIVITIES)[number];

export interface VersionDomainPolicySurfaceRedactionPolicy {
  readonly surfaceKind: VersionDomainPolicySurfaceKind;
  readonly sensitivity: VersionDomainPolicySurfaceSensitivity;
  readonly requiredPolicy: VersionRedactionPolicy;
  readonly sinks: readonly string[];
}
