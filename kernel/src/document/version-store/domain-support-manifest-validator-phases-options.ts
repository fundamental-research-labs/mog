import type { VersionDomainCapabilityKey } from '@mog-sdk/contracts/versioning';

import { REQUIRED_CAPABILITY_KEYS_BY_OPERATION } from './domain-support-manifest-validator-constants';
import type { DomainSupportManifestValidationOptions } from './domain-support-manifest-validator-types';

export function requiredCapabilityKeysForOptions(
  options: DomainSupportManifestValidationOptions,
): readonly VersionDomainCapabilityKey[] {
  if (options.requiredCapabilityKeys) return options.requiredCapabilityKeys;
  if (options.operation) return REQUIRED_CAPABILITY_KEYS_BY_OPERATION[options.operation];
  return [];
}
