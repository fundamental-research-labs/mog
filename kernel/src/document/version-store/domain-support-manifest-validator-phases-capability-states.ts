import {
  VERSION_DOMAIN_CAPABILITY_KEYS,
  type VersionDomainCapabilityKey,
  type VersionDomainCapabilityState,
  type VersionDomainClass,
} from '@mog-sdk/contracts/versioning';

import type { DomainSupportManifestDiagnostic } from './domain-support-manifest-validator-types';
import {
  isPlainRecord,
  isVersionDomainCapabilityState,
} from './domain-support-manifest-validator-phases-guards';

const CAPABILITY_KEY_SET: ReadonlySet<string> = new Set(VERSION_DOMAIN_CAPABILITY_KEYS);

export function validateCapabilityStates(
  matrixRowId: string,
  domainId: string,
  capabilityStates: unknown,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  if (!isPlainRecord(capabilityStates)) {
    diagnostics.push({
      code: 'capability-states-missing',
      message: `Matrix row "${matrixRowId}" for domain "${domainId}" must provide capabilityStates keyed by version capability.`,
      matrixRowId,
      domainId,
    });
    return;
  }

  for (const key of Object.keys(capabilityStates)) {
    if (!CAPABILITY_KEY_SET.has(key)) {
      diagnostics.push({
        code: 'unknown-capability-key',
        message: `Matrix row "${matrixRowId}" for domain "${domainId}" references unknown capability key "${key}".`,
        matrixRowId,
        domainId,
      });
    }
  }

  for (const key of VERSION_DOMAIN_CAPABILITY_KEYS) {
    const state = capabilityStates[key];
    if (state === undefined) {
      diagnostics.push({
        code: 'capability-state-missing',
        message: `Matrix row "${matrixRowId}" for domain "${domainId}" is missing capability state for "${key}".`,
        matrixRowId,
        domainId,
      });
      continue;
    }
    if (!isVersionDomainCapabilityState(state)) {
      diagnostics.push({
        code: 'unknown-capability-state',
        message: `Matrix row "${matrixRowId}" for domain "${domainId}" capability "${key}" references an unknown state.`,
        matrixRowId,
        domainId,
        capabilityKey: key,
      });
    }
  }
}

export function validateRequiredCapabilityState(
  matrixRowId: string,
  domainId: string,
  domainClass: VersionDomainClass,
  capabilityStates: unknown,
  requiredCapabilityKeys: readonly VersionDomainCapabilityKey[],
  allowOpaquePreserved: boolean,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  if (requiredCapabilityKeys.length === 0 || !isPlainRecord(capabilityStates)) return;

  for (const capabilityKey of requiredCapabilityKeys) {
    const state = capabilityStates[capabilityKey];
    if (!isVersionDomainCapabilityState(state)) continue;
    if (isCapabilityStateAllowedForOperation(domainClass, state, allowOpaquePreserved)) continue;

    diagnostics.push({
      code: 'capability-state-blocked',
      message: `Matrix row "${matrixRowId}" for domain "${domainId}" has state "${state}" for capability "${capabilityKey}", which is not allowed for this durable operation.`,
      matrixRowId,
      domainId,
      capabilityKey,
      capabilityState: state,
    });
  }
}

function isCapabilityStateAllowedForOperation(
  domainClass: VersionDomainClass,
  state: VersionDomainCapabilityState,
  allowOpaquePreserved: boolean,
): boolean {
  switch (state) {
    case 'supported':
      return true;
    case 'derived':
      return domainClass === 'derived';
    case 'excluded':
      return domainClass === 'transient';
    case 'opaque-preserved':
      return allowOpaquePreserved;
    case 'not-started':
    case 'contracted':
    case 'opaque-blocking':
      return false;
  }
}
