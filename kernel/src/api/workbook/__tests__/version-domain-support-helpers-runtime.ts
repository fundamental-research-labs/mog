import type { DomainSupportManifest } from '@mog-sdk/contracts/versioning';

import type { DomainSupportManifestValidationOptions } from '../../../document/version-store/domain-support-manifest-validator';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS,
} from './version-domain-support-helpers-constants';
import {
  exportSupportedVersionDomainPolicyRegistry,
  exportSupportedVersionDomainSupportManifest,
  freshVersionDomainSupportManifest,
} from './version-domain-support-helpers-manifest';

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

export function versionDomainExportSupportedManifestRuntime(
  input: {
    readonly manifest?: Partial<DomainSupportManifest>;
    readonly options?: DomainSupportManifestValidationOptions;
  } = {},
) {
  const domainSupportManifest = exportSupportedVersionDomainSupportManifest(input.manifest);
  return {
    domainSupportManifest,
    domainSupportManifestOptions: versionDomainSupportManifestOptions({
      domainPolicyRegistry: exportSupportedVersionDomainPolicyRegistry(domainSupportManifest),
      ...input.options,
    }),
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

export function versioningWithExportSupportedDomainSupportManifest<
  T extends Record<string, unknown>,
>(versioning: T): T & ReturnType<typeof versionDomainExportSupportedManifestRuntime> {
  return {
    ...versionDomainExportSupportedManifestRuntime(),
    ...versioning,
  };
}

export const withVersionManifest = versioningWithDomainSupportManifest;
export const withExportSupportedVersionManifest =
  versioningWithExportSupportedDomainSupportManifest;
