import type {
  DomainCapabilityPolicyManifest,
  DomainSupportManifest,
  VersionDomainCapabilityState,
  VersionDomainCapabilityStateMap,
  VersionDomainPolicyRegistry,
} from '@mog-sdk/contracts/versioning';
import type { Workbook } from '@mog-sdk/contracts/api';
import { PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY } from '@mog-sdk/contracts/versioning';

import {
  REQUIRED_FIRST_SLICE_DOMAIN_IDS,
  type DomainSupportManifestValidationOptions,
} from '../../../document/version-store/domain-support-manifest-validator';
import type { DocumentContext } from '../../../context';
import type { DocumentHandleInternal } from '../../document/document-handle-types';

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

export function installVersionDomainDetectorNoopsOnHandles(
  ...handles: readonly unknown[]
): void {
  for (const handle of handles) {
    installVersionDomainDetectorNoopsOnBridge(
      ((handle as Partial<DocumentHandleInternal>).context as DocumentContext | undefined)
        ?.computeBridge,
    );
  }
}

export function installVersionDomainDetectorNoopsOnWorkbook(wb: Pick<Workbook, 'version'>): void {
  const version = wb.version as unknown as {
    ctx?: DocumentContext;
    versionContext?: DocumentContext;
  };
  installVersionDomainDetectorNoopsOnBridge(
    (version.ctx ?? version.versionContext)?.computeBridge,
  );
}

function installVersionDomainDetectorNoopsOnBridge(bridge: unknown): void {
  if (!isMutableRecord(bridge)) return;
  bridge.namedRangeCount = async () => 0;
  bridge.getAllNamedRangesWire = async () => [];
  bridge.getHyperlinks = async () => [];
  bridge.getRangeSchemasForSheet = async () => [];
}

function isMutableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
