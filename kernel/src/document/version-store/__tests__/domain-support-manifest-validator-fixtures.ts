import { PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY } from '@mog-sdk/contracts/versioning';
import type {
  DomainCapabilityPolicyManifest,
  DomainSupportManifest,
  VersionDomainCapabilityState,
  VersionDomainCapabilityStateMap,
} from '@mog-sdk/contracts/versioning';
import {
  REQUIRED_FIRST_SLICE_DOMAIN_IDS,
  REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
} from '../domain-support-manifest-validator';

export const NOW = new Date('2026-06-21T00:05:00.000Z');
export const ONE_HOUR_MS = 60 * 60 * 1000;

export function capabilityStates(
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

export function domainRow(
  domainId: string,
  overrides: Partial<DomainCapabilityPolicyManifest> = {},
): DomainCapabilityPolicyManifest {
  return {
    domainPolicyId: overrides.domainPolicyId ?? overrides.matrixRowId ?? domainId,
    matrixRowId: overrides.matrixRowId ?? domainId,
    domainId,
    domainClass: 'authored',
    capabilityStates: capabilityStates(),
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

export function freshManifest(
  overrides: Partial<DomainSupportManifest> = {},
): DomainSupportManifest {
  return {
    schemaVersion: 'domain-support-manifest.v2',
    generatedAt: '2026-06-21T00:00:00.000Z',
    workbookId: 'wb-1',
    domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
    ...overrides,
  };
}

export function registryManifest(
  matrixRowIds: readonly string[] = REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
): DomainSupportManifest {
  const wanted = new Set(matrixRowIds);
  return freshManifest({
    domains: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.filter((row) =>
      wanted.has(row.matrixRowId),
    ),
  });
}
