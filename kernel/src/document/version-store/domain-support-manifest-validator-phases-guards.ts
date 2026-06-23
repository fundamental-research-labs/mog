import {
  VERSION_DOMAIN_CAPABILITY_STATES,
  VERSION_DOMAIN_CLASSES,
  type VersionDomainCapabilityState,
  type VersionDomainClass,
} from '@mog-sdk/contracts/versioning';

const CLASS_SET: ReadonlySet<string> = new Set(VERSION_DOMAIN_CLASSES);
const STATE_SET: ReadonlySet<string> = new Set(VERSION_DOMAIN_CAPABILITY_STATES);

export function isVersionDomainClass(value: unknown): value is VersionDomainClass {
  return typeof value === 'string' && CLASS_SET.has(value);
}

export function isVersionDomainCapabilityState(
  value: unknown,
): value is VersionDomainCapabilityState {
  return typeof value === 'string' && STATE_SET.has(value);
}

export function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
