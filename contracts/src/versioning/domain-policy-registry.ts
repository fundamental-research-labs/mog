import type {
  CapturePolicy,
  DomainCapabilityPolicyManifest,
  DomainSupportManifest,
  VersionDomainCapabilityState,
  VersionDomainCapabilityStateMap,
  VersionDomainClass,
  VersionDomainPolicyRegistry,
  VersionHistoryAccessPolicy,
  VersionRedactionPolicy,
  VersionRolloutStage,
  VersionWriteAdmissionMode,
} from './domain-policy';
import { VERSION_HISTORY_SUMMARY_ONLY_DIAGNOSTIC_PROJECTION_POLICY } from './access-policy';
import type { VersionDomainPolicySurfaceRedactionPolicy } from './domain-policy-types';

export const VERSION_DOMAIN_POLICY_REGISTRY_SCHEMA_VERSION = 'version-domain-policy-registry.v1';
export const VERSION_DOMAIN_POLICY_ID_PATTERN = '^[a-z0-9]+(?:[.-][a-z0-9]+)*$';
export const VERSION_DOMAIN_POLICY_CONTRACT_VERSION = 'version-domain-policy.v2';
export const VERSION_DOMAIN_PUBLIC_DIAGNOSTIC_CODE_PATTERN = '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$';

const VERSION_DOMAIN_CAPABILITY_KEYS = Object.freeze([
  'capture',
  'replay',
  'diff',
  'reviewAccess',
  'checkout',
  'merge',
  'persistence',
  'import',
  'export',
] as const);

type CapabilityOverrides = Partial<
  Record<keyof VersionDomainCapabilityStateMap, VersionDomainCapabilityState>
>;

function capabilityStates(
  defaultState: VersionDomainCapabilityState,
  overrides: CapabilityOverrides = {},
): VersionDomainCapabilityStateMap {
  const entries = VERSION_DOMAIN_CAPABILITY_KEYS.map((key) => [
    key,
    overrides[key] ?? defaultState,
  ]);
  return Object.freeze(Object.fromEntries(entries)) as VersionDomainCapabilityStateMap;
}

const CONTRACTED = capabilityStates('contracted');
const OPAQUE_BLOCKING = capabilityStates('opaque-blocking');
const EXCLUDED = capabilityStates('excluded');
const DERIVED = capabilityStates('derived');
const WORKBOOK_METADATA = capabilityStates('contracted', {
  capture: 'supported',
  replay: 'supported',
  checkout: 'supported',
  merge: 'supported',
  persistence: 'supported',
  export: 'supported',
});
const SHEETS = capabilityStates('contracted', {
  capture: 'supported',
  replay: 'supported',
  diff: 'supported',
  checkout: 'supported',
  merge: 'supported',
  persistence: 'supported',
  export: 'supported',
});
const AUTHORED_GRID = capabilityStates('contracted', {
  capture: 'supported',
  replay: 'supported',
  diff: 'supported',
  checkout: 'supported',
  merge: 'supported',
  persistence: 'supported',
  export: 'supported',
});
const DIRECT_FORMATS = capabilityStates('contracted', {
  merge: 'supported',
});
const STRUCTURED_AUTHORED_NO_MERGE = capabilityStates('supported', {
  merge: 'contracted',
});
const OPAQUE_PRESERVED_PACKAGE = capabilityStates('opaque-preserved', {
  diff: 'opaque-blocking',
  reviewAccess: 'opaque-blocking',
  merge: 'opaque-blocking',
});
const OPAQUE_PRESERVED_EXTERNAL = capabilityStates('opaque-preserved', {
  diff: 'opaque-blocking',
  reviewAccess: 'opaque-blocking',
  merge: 'opaque-blocking',
  export: 'opaque-blocking',
});
const EVAL_ONLY_VERSION_DOMAIN_CAPABILITY_STATES = Object.freeze(['expected-failing'] as const);

type PolicyInput = {
  readonly matrixRowId: string;
  readonly domainId: string;
  readonly domainClass: VersionDomainClass;
  readonly capturePolicy: CapturePolicy;
  readonly capabilityStates: VersionDomainCapabilityStateMap;
  readonly redactionPolicy?: VersionRedactionPolicy;
  readonly publicDiagnosticCodes?: readonly string[];
  readonly surfaceRedactionPolicies?: readonly VersionDomainPolicySurfaceRedactionPolicy[];
};

export type PublicDomainCapabilityPolicyManifest = DomainCapabilityPolicyManifest & {
  readonly policyContractVersion: typeof VERSION_DOMAIN_POLICY_CONTRACT_VERSION;
  readonly publicDiagnosticCodes: readonly string[];
  readonly surfaceRedactionPolicies: readonly VersionDomainPolicySurfaceRedactionPolicy[];
};

type PublicVersionDomainPolicyRegistry = Omit<VersionDomainPolicyRegistry, 'domains'> & {
  readonly domains: readonly PublicDomainCapabilityPolicyManifest[];
};

function domainPolicy(input: PolicyInput): PublicDomainCapabilityPolicyManifest {
  const redactionPolicy = input.redactionPolicy ?? redactionPolicyFor(input.domainClass);
  const writeAdmissionMode = writeAdmissionFor(input.capturePolicy);
  return Object.freeze({
    domainPolicyId: input.matrixRowId,
    matrixRowId: input.matrixRowId,
    domainId: input.domainId,
    domainClass: input.domainClass,
    capabilityStates: input.capabilityStates,
    capturePolicy: input.capturePolicy,
    writeAdmissionMode,
    rolloutStage: rolloutStageFor(input.capturePolicy),
    historyAccess: historyAccessFor(input.capturePolicy, redactionPolicy),
    redactionPolicy,
    policyContractVersion: VERSION_DOMAIN_POLICY_CONTRACT_VERSION,
    publicDiagnosticCodes: freezePublicDiagnosticCodes(input.publicDiagnosticCodes),
    surfaceRedactionPolicies: freezeSurfaceRedactionPolicies(input.surfaceRedactionPolicies),
  });
}

function freezePublicDiagnosticCodes(input: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...(input ?? [])]);
}

function freezeSurfaceRedactionPolicies(
  input: readonly VersionDomainPolicySurfaceRedactionPolicy[] | undefined,
): readonly VersionDomainPolicySurfaceRedactionPolicy[] {
  return Object.freeze(
    (input ?? []).map((policy) =>
      Object.freeze({
        surfaceKind: policy.surfaceKind,
        sensitivity: policy.sensitivity,
        requiredPolicy: policy.requiredPolicy,
        sinks: Object.freeze([...policy.sinks]),
      }),
    ),
  );
}

function surfaceRedactionPolicy(
  input: VersionDomainPolicySurfaceRedactionPolicy,
): VersionDomainPolicySurfaceRedactionPolicy {
  return Object.freeze({
    ...input,
    sinks: Object.freeze([...input.sinks]),
  });
}

function writeAdmissionFor(capturePolicy: CapturePolicy): VersionWriteAdmissionMode {
  switch (capturePolicy) {
    case 'commitEligible':
    case 'rootCreation':
      return 'capture';
    case 'derivedOnly':
    case 'shadowOnly':
      return 'shadowOnly';
    case 'historyGap':
      return 'captureSuspendedWithGap';
    case 'excluded':
      return 'captureDisabledNoHistory';
  }
}

function rolloutStageFor(capturePolicy: CapturePolicy): VersionRolloutStage {
  return capturePolicy === 'excluded' ? 'disabled' : 'headless-local';
}

function historyAccessFor(
  capturePolicy: CapturePolicy,
  redactionPolicy: VersionRedactionPolicy,
): VersionHistoryAccessPolicy {
  switch (capturePolicy) {
    case 'commitEligible':
    case 'rootCreation':
      return Object.freeze({
        readMode: 'full',
        writeMode: 'full',
        redactionPolicy,
        diagnosticProjection: VERSION_HISTORY_SUMMARY_ONLY_DIAGNOSTIC_PROJECTION_POLICY,
      });
    case 'derivedOnly':
    case 'shadowOnly':
      return Object.freeze({
        readMode: 'metadata-only',
        writeMode: 'shadow-only',
        redactionPolicy,
        diagnosticProjection: VERSION_HISTORY_SUMMARY_ONLY_DIAGNOSTIC_PROJECTION_POLICY,
      });
    case 'historyGap':
      return Object.freeze({
        readMode: 'metadata-only',
        writeMode: 'gated',
        redactionPolicy,
        diagnosticProjection: VERSION_HISTORY_SUMMARY_ONLY_DIAGNOSTIC_PROJECTION_POLICY,
      });
    case 'excluded':
      return Object.freeze({
        readMode: 'none',
        writeMode: 'none',
        redactionPolicy,
        diagnosticProjection: VERSION_HISTORY_SUMMARY_ONLY_DIAGNOSTIC_PROJECTION_POLICY,
      });
  }
}

function redactionPolicyFor(domainClass: VersionDomainClass): VersionRedactionPolicy {
  switch (domainClass) {
    case 'secret':
      return 'content-redacted';
    case 'packageFidelity':
    case 'external':
      return 'metadata-only';
    case 'transient':
      return 'drop';
    case 'authored':
    case 'derived':
      return 'none';
  }
}

const PIVOT_PUBLIC_DIAGNOSTIC_CODES = Object.freeze([
  'version.domain.pivots.opaque-preserved',
  'version.domain.pivots.review-blocked',
  'version.domain.pivots.merge-blocked',
] as const);
const PIVOT_SURFACE_REDACTION_POLICIES = Object.freeze([
  surfaceRedactionPolicy({
    surfaceKind: 'diagnostics',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'metadata-only',
    sinks: ['version-history', 'domain-support-manifest'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'review',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'metadata-only',
    sinks: ['version-review', 'merge-preview'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'merge',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'metadata-only',
    sinks: ['merge-preview'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'object-store',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'opaque-digest-only',
    sinks: ['version-object-store'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'export',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'metadata-only',
    sinks: ['xlsx-export-metadata'],
  }),
] as const);

const STYLE_CATALOG_PUBLIC_DIAGNOSTIC_CODES = Object.freeze([
  'version.domain.cells.formats.catalogs.blocked',
  'version.domain.cells.formats.catalogs.redacted',
] as const);
const STYLE_CATALOG_SURFACE_REDACTION_POLICIES = Object.freeze([
  surfaceRedactionPolicy({
    surfaceKind: 'diagnostics',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'metadata-only',
    sinks: ['version-history', 'domain-support-manifest'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'review',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'metadata-only',
    sinks: ['version-review', 'merge-preview'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'merge',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'metadata-only',
    sinks: ['merge-preview'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'export',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'metadata-only',
    sinks: ['xlsx-export-metadata'],
  }),
] as const);

const CHART_PUBLIC_DIAGNOSTIC_CODES = Object.freeze([
  'version.domain.charts.unsupported-sidecar-redacted',
  'version.domain.charts.opaque-payload-blocked',
] as const);
const CHART_SURFACE_REDACTION_POLICIES = Object.freeze([
  surfaceRedactionPolicy({
    surfaceKind: 'diagnostics',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'metadata-only',
    sinks: ['version-history', 'domain-support-manifest'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'review',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'metadata-only',
    sinks: ['version-review', 'merge-preview'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'export',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'metadata-only',
    sinks: ['xlsx-export-metadata'],
  }),
] as const);

const PROTECTION_PUBLIC_DIAGNOSTIC_CODES = Object.freeze([
  'version.domain.protection.blocked',
  'version.domain.protection.redacted',
] as const);
const PROTECTION_SURFACE_REDACTION_POLICIES = Object.freeze([
  surfaceRedactionPolicy({
    surfaceKind: 'diagnostics',
    sensitivity: 'secret',
    requiredPolicy: 'content-redacted',
    sinks: ['version-history', 'domain-support-manifest'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'review',
    sensitivity: 'secret',
    requiredPolicy: 'content-redacted',
    sinks: ['version-review', 'merge-preview'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'merge',
    sensitivity: 'secret',
    requiredPolicy: 'content-redacted',
    sinks: ['merge-preview'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'export',
    sensitivity: 'secret',
    requiredPolicy: 'content-redacted',
    sinks: ['xlsx-export-metadata'],
  }),
] as const);

const EXTERNAL_LINK_PUBLIC_DIAGNOSTIC_CODES = Object.freeze([
  'version.domain.external-links.opaque-preserved',
  'version.domain.external-links.review-blocked',
  'version.domain.external-links.export-blocked',
  'version.domain.external-links.redacted-target',
] as const);
const EXTERNAL_LINK_SURFACE_REDACTION_POLICIES = Object.freeze([
  surfaceRedactionPolicy({
    surfaceKind: 'diagnostics',
    sensitivity: 'external-target',
    requiredPolicy: 'content-redacted',
    sinks: ['version-history', 'domain-support-manifest'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'review',
    sensitivity: 'external-target',
    requiredPolicy: 'content-redacted',
    sinks: ['version-review', 'merge-preview'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'merge',
    sensitivity: 'external-target',
    requiredPolicy: 'content-redacted',
    sinks: ['merge-preview'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'object-store',
    sensitivity: 'credential',
    requiredPolicy: 'opaque-digest-only',
    sinks: ['version-object-store'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'export',
    sensitivity: 'external-target',
    requiredPolicy: 'content-redacted',
    sinks: ['xlsx-export-metadata'],
  }),
] as const);

const OOXML_SIDECAR_PUBLIC_DIAGNOSTIC_CODES = Object.freeze([
  'version.domain.ooxml-sidecars.opaque-preserved',
  'version.domain.ooxml-sidecars.active-content-blocked',
  'version.domain.ooxml-sidecars.owner-conflict',
] as const);
const OOXML_SIDECAR_SURFACE_REDACTION_POLICIES = Object.freeze([
  surfaceRedactionPolicy({
    surfaceKind: 'diagnostics',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'metadata-only',
    sinks: ['version-history', 'domain-support-manifest'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'review',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'metadata-only',
    sinks: ['version-review', 'merge-preview'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'merge',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'metadata-only',
    sinks: ['merge-preview'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'object-store',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'opaque-digest-only',
    sinks: ['version-object-store'],
  }),
  surfaceRedactionPolicy({
    surfaceKind: 'export',
    sensitivity: 'opaque-payload',
    requiredPolicy: 'metadata-only',
    sinks: ['xlsx-export-metadata'],
  }),
] as const);

const DOMAINS = Object.freeze([
  domainPolicy({
    matrixRowId: 'workbook-metadata',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: WORKBOOK_METADATA,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-object-digests',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-merge-capability-gate',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'derivedOnly',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-fast-forward-ref-cas-proof',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'derivedOnly',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-object-store',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-commit-store',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-graph-store',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-graph-read-list',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-public-read-api',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'derivedOnly',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-public-commit-api',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-commit-service-wiring',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-public-diff-api',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'derivedOnly',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-graph-registry',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-store-provider',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-durable-snapshot-provider-foundation',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'historyGap',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-indexeddb-provider-foundation',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'historyGap',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-ref-lifecycle',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-branch-service',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'workbook-metadata.version-checkout-materialization-planning',
    domainId: 'workbook-metadata',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'sheets',
    domainId: 'sheets',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: SHEETS,
  }),
  domainPolicy({
    matrixRowId: 'cells.values',
    domainId: 'cells.values',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: AUTHORED_GRID,
  }),
  domainPolicy({
    matrixRowId: 'cells.formulas',
    domainId: 'cells.formulas',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: AUTHORED_GRID,
  }),
  domainPolicy({
    matrixRowId: 'cells.formats.direct',
    domainId: 'cells.formats',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: DIRECT_FORMATS,
  }),
  domainPolicy({
    matrixRowId: 'cells.formats.catalogs',
    domainId: 'cells.formats',
    domainClass: 'packageFidelity',
    capturePolicy: 'commitEligible',
    capabilityStates: OPAQUE_BLOCKING,
    publicDiagnosticCodes: STYLE_CATALOG_PUBLIC_DIAGNOSTIC_CODES,
    surfaceRedactionPolicies: STYLE_CATALOG_SURFACE_REDACTION_POLICIES,
  }),
  domainPolicy({
    matrixRowId: 'rows-columns',
    domainId: 'rows-columns',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: AUTHORED_GRID,
  }),
  domainPolicy({
    matrixRowId: 'named-ranges',
    domainId: 'named-ranges',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: STRUCTURED_AUTHORED_NO_MERGE,
  }),
  domainPolicy({
    matrixRowId: 'tables',
    domainId: 'tables',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: STRUCTURED_AUTHORED_NO_MERGE,
  }),
  domainPolicy({
    matrixRowId: 'pivots',
    domainId: 'pivots',
    domainClass: 'packageFidelity',
    capturePolicy: 'commitEligible',
    capabilityStates: OPAQUE_PRESERVED_PACKAGE,
    publicDiagnosticCodes: PIVOT_PUBLIC_DIAGNOSTIC_CODES,
    surfaceRedactionPolicies: PIVOT_SURFACE_REDACTION_POLICIES,
  }),
  domainPolicy({
    matrixRowId: 'charts.source-range',
    domainId: 'charts',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
    publicDiagnosticCodes: CHART_PUBLIC_DIAGNOSTIC_CODES,
    surfaceRedactionPolicies: CHART_SURFACE_REDACTION_POLICIES,
  }),
  domainPolicy({
    matrixRowId: 'floating-objects.anchors',
    domainId: 'floating-objects',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'data-validation',
    domainId: 'data-validation',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: STRUCTURED_AUTHORED_NO_MERGE,
  }),
  domainPolicy({
    matrixRowId: 'conditional-formatting',
    domainId: 'conditional-formatting',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'filters.auto-filter',
    domainId: 'filters',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: STRUCTURED_AUTHORED_NO_MERGE,
  }),
  domainPolicy({
    matrixRowId: 'sorts',
    domainId: 'sorts',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'comments-notes',
    domainId: 'comments-notes',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'protection',
    domainId: 'protection',
    domainClass: 'secret',
    capturePolicy: 'commitEligible',
    capabilityStates: OPAQUE_BLOCKING,
    publicDiagnosticCodes: PROTECTION_PUBLIC_DIAGNOSTIC_CODES,
    surfaceRedactionPolicies: PROTECTION_SURFACE_REDACTION_POLICIES,
  }),
  domainPolicy({
    matrixRowId: 'external-links',
    domainId: 'external-links',
    domainClass: 'external',
    capturePolicy: 'commitEligible',
    capabilityStates: OPAQUE_PRESERVED_EXTERNAL,
    publicDiagnosticCodes: EXTERNAL_LINK_PUBLIC_DIAGNOSTIC_CODES,
    surfaceRedactionPolicies: EXTERNAL_LINK_SURFACE_REDACTION_POLICIES,
  }),
  domainPolicy({
    matrixRowId: 'ooxml-sidecars',
    domainId: 'ooxml-sidecars',
    domainClass: 'packageFidelity',
    capturePolicy: 'commitEligible',
    capabilityStates: OPAQUE_PRESERVED_PACKAGE,
    publicDiagnosticCodes: OOXML_SIDECAR_PUBLIC_DIAGNOSTIC_CODES,
    surfaceRedactionPolicies: OOXML_SIDECAR_SURFACE_REDACTION_POLICIES,
  }),
  domainPolicy({
    matrixRowId: 'view-state.selection-scroll',
    domainId: 'view-state',
    domainClass: 'transient',
    capturePolicy: 'excluded',
    capabilityStates: EXCLUDED,
  }),
  domainPolicy({
    matrixRowId: 'recalc-caches',
    domainId: 'recalc-caches',
    domainClass: 'derived',
    capturePolicy: 'derivedOnly',
    capabilityStates: DERIVED,
  }),
  domainPolicy({
    matrixRowId: 'runtime-diagnostics.runtime-cache',
    domainId: 'runtime-diagnostics',
    domainClass: 'transient',
    capturePolicy: 'excluded',
    capabilityStates: EXCLUDED,
  }),
  domainPolicy({
    matrixRowId: 'runtime-diagnostics.version-status-facade',
    domainId: 'runtime-diagnostics',
    domainClass: 'transient',
    capturePolicy: 'derivedOnly',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'runtime-diagnostics.sync-provenance',
    domainId: 'runtime-diagnostics',
    domainClass: 'external',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'runtime-diagnostics.sync-provider-admission',
    domainId: 'runtime-diagnostics',
    domainClass: 'external',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
]);

function assertNoEvalOnlyCapabilityStates(
  domains: readonly DomainCapabilityPolicyManifest[],
): void {
  for (const row of domains) {
    for (const state of Object.values(row.capabilityStates)) {
      if ((EVAL_ONLY_VERSION_DOMAIN_CAPABILITY_STATES as readonly string[]).includes(state)) {
        throw new Error(
          `Public version domain policy registry cannot expose eval-only capability state for "${row.domainPolicyId}".`,
        );
      }
    }
  }
}

assertNoEvalOnlyCapabilityStates(DOMAINS);

export const PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY = Object.freeze({
  schemaVersion: VERSION_DOMAIN_POLICY_REGISTRY_SCHEMA_VERSION,
  domains: DOMAINS,
  defaultHistoryRootPolicy: Object.freeze({
    allowDetachedRoots: false,
    gapPolicy: 'reject',
  }),
} satisfies PublicVersionDomainPolicyRegistry);

export const PUBLIC_VERSION_DOMAIN_POLICY_IDS = Object.freeze(
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.map((row) => row.domainPolicyId),
);
export const PUBLIC_VERSION_DOMAIN_POLICY_ROW_COUNT =
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.length;

export const PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS = Object.freeze([
  'workbook-metadata',
  'sheets',
  'rows-columns',
  'cells.values',
  'cells.formulas',
  'recalc-caches',
] as const);

export const PUBLIC_VERSION_DOMAIN_DEFAULT_MANIFEST_MATRIX_ROW_IDS = Object.freeze([
  ...PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS,
  'tables',
  'filters.auto-filter',
  'named-ranges',
  'data-validation',
  'external-links',
] as const);

const PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_ID_SET = new Set<string>(
  PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS,
);

export const PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_ALL_ROWS =
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.every(
    (row) => row.capabilityStates.export === 'supported',
  );
export const PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_REQUIRED_ROWS =
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains
    .filter((row) => PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_ID_SET.has(row.matrixRowId))
    .every(
      (row) =>
        row.capabilityStates.export === 'supported' || row.capabilityStates.export === 'derived',
    );

type PublicDomainSupportManifestOptions = {
  readonly workbookId?: string;
  readonly generatedAt?: string;
};

export function createPublicVersionDomainSupportManifest(
  options: PublicDomainSupportManifestOptions = {},
): DomainSupportManifest {
  const rowsByMatrixRowId = new Map(
    PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.map((row) => [row.matrixRowId, row]),
  );
  const domains = PUBLIC_VERSION_DOMAIN_DEFAULT_MANIFEST_MATRIX_ROW_IDS.map((matrixRowId) => {
    const row = rowsByMatrixRowId.get(matrixRowId);
    if (!row) throw new Error(`Missing public version domain policy row: ${matrixRowId}`);
    return row;
  });

  return {
    schemaVersion: 'domain-support-manifest.v2',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ...(options.workbookId ? { workbookId: options.workbookId } : {}),
    domains,
  };
}
