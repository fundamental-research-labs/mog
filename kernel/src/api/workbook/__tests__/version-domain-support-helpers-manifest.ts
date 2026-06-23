import type {
  DomainCapabilityPolicyManifest,
  DomainSupportManifest,
  VersionDomainCapabilityState,
  VersionDomainCapabilityStateMap,
  VersionDomainPolicyRegistry,
} from '@mog-sdk/contracts/versioning';
import { PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY } from '@mog-sdk/contracts/versioning';

import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_CREATED_AT } from './version-domain-support-helpers-constants';

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

function cloneDomainPolicyManifest(
  row: DomainCapabilityPolicyManifest,
): DomainCapabilityPolicyManifest {
  return {
    ...row,
    capabilityStates: { ...row.capabilityStates },
    historyAccess: { ...row.historyAccess },
  };
}

const PUBLIC_POLICY_ROWS_BY_MATRIX_ROW_ID = new Map(
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.map((row) => [row.matrixRowId, row]),
);

export function versionDomainSupportManifestRow(
  domainId: string,
  overrides: Partial<DomainCapabilityPolicyManifest> = {},
): DomainCapabilityPolicyManifest {
  const matrixRowId = overrides.matrixRowId ?? domainId;
  const registryRow = PUBLIC_POLICY_ROWS_BY_MATRIX_ROW_ID.get(matrixRowId);
  if (registryRow) {
    return {
      ...cloneDomainPolicyManifest(registryRow),
      ...overrides,
    };
  }

  return selfPromotedVersionDomainSupportManifestRow(domainId, overrides);
}

export function selfPromotedVersionDomainSupportManifestRow(
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

export function selfPromotedVersionDomainSupportManifest(
  overrides: Partial<DomainSupportManifest> = {},
): DomainSupportManifest {
  return {
    schemaVersion: 'domain-support-manifest.v2',
    generatedAt: VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_CREATED_AT,
    workbookId: 'wb-1',
    domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
      selfPromotedVersionDomainSupportManifestRow(id),
    ),
    ...overrides,
  };
}

export function exportSupportedVersionDomainSupportManifest(
  overrides: Partial<DomainSupportManifest> = {},
): DomainSupportManifest {
  return freshVersionDomainSupportManifest({
    domains: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.map((row) => {
      return {
        ...cloneDomainPolicyManifest(row),
        capabilityStates: {
          ...row.capabilityStates,
          export: 'supported',
        },
      };
    }),
    ...overrides,
  });
}

export function exportSupportedVersionDomainPolicyRegistry(
  manifest: DomainSupportManifest,
): VersionDomainPolicyRegistry {
  return {
    schemaVersion: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.schemaVersion,
    domains: manifest.domains,
    defaultHistoryRootPolicy: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.defaultHistoryRootPolicy,
  };
}
