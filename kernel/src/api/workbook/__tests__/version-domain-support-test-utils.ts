import type {
  DomainCapabilityPolicyManifest,
  DomainSupportManifest,
  VersionDomainCapabilityState,
  VersionDomainCapabilityStateMap,
} from '@mog-sdk/contracts/versioning';

import {
  REQUIRED_FIRST_SLICE_DOMAIN_IDS,
  type DomainSupportManifestValidationOptions,
} from '../../../document/version-store/domain-support-manifest-validator';

export const VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_CREATED_AT = '2026-06-21T00:00:00.000Z';
export const VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW = new Date('2026-06-21T00:05:00.000Z');
export const VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_ONE_MINUTE_MS = 60 * 1000;
export const VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS =
  10 * VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_ONE_MINUTE_MS;

export function versionDomainCapabilityStates(
  state: VersionDomainCapabilityState = 'supported',
): VersionDomainCapabilityStateMap {
  return {
    capture: state,
    replay: state,
    diff: state,
    reviewAccess: state,
    checkout: state,
    merge: state,
    persistence: state,
    import: state,
    export: state,
  };
}

export function versionDomainSupportManifestRow(
  domainId: string,
  overrides: Partial<DomainCapabilityPolicyManifest> = {},
): DomainCapabilityPolicyManifest {
  return {
    domainPolicyId: overrides.domainPolicyId ?? overrides.matrixRowId ?? domainId,
    matrixRowId: overrides.matrixRowId ?? domainId,
    domainId,
    domainClass: 'authored',
    capabilityStates: versionDomainCapabilityStates(),
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    rolloutStage: 'headless-local',
    historyAccess: {
      readMode: 'full',
      writeMode: 'full',
      redactionPolicy: 'none',
    },
    redactionPolicy: 'none',
    ...overrides,
  };
}

export function freshVersionDomainSupportManifest(
  overrides: Partial<DomainSupportManifest> = {},
): DomainSupportManifest {
  return {
    schemaVersion: 'domain-support-manifest.v2',
    generatedAt: VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_CREATED_AT,
    workbookId: 'wb-1',
    domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => versionDomainSupportManifestRow(id)),
    ...overrides,
  };
}

export function versionDomainSupportManifestOptions(
  overrides: DomainSupportManifestValidationOptions = {},
): DomainSupportManifestValidationOptions {
  return {
    now: VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW,
    maxAgeMs: VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS,
    ...overrides,
  };
}

export function versionDomainSupportManifestRuntime(
  input: {
    readonly manifest?: Partial<DomainSupportManifest>;
    readonly options?: DomainSupportManifestValidationOptions;
  } = {},
) {
  return {
    domainSupportManifest: freshVersionDomainSupportManifest(input.manifest),
    domainSupportManifestOptions: versionDomainSupportManifestOptions(input.options),
  };
}

export function versioningWithDomainSupportManifest<T extends Record<string, unknown>>(
  versioning: T,
): T & ReturnType<typeof versionDomainSupportManifestRuntime> {
  return {
    ...versionDomainSupportManifestRuntime(),
    ...versioning,
  };
}

export const withVersionManifest = versioningWithDomainSupportManifest;
