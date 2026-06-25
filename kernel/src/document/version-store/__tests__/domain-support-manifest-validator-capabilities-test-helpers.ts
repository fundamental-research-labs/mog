import type {
  DomainCapabilityPolicyManifest,
  DomainSupportManifest,
} from '@mog-sdk/contracts/versioning';

import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../domain-support-manifest-validator';
import { domainRow, freshManifest } from './domain-support-manifest-validator-fixtures';

export function manifestWithAdditionalDomain(
  row: DomainCapabilityPolicyManifest,
): DomainSupportManifest {
  return freshManifest({
    domains: [...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)), row],
  });
}
