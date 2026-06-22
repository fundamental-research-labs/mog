import type {
  CapturePolicy,
  DomainCapabilityPolicyManifest,
  VersionDomainCapabilityState,
  VersionDomainCapabilityStateMap,
  VersionDomainClass,
  VersionDomainPolicyRegistry,
  VersionHistoryAccessPolicy,
  VersionRedactionPolicy,
  VersionRolloutStage,
  VersionWriteAdmissionMode,
} from './index';

export const VERSION_DOMAIN_POLICY_REGISTRY_SCHEMA_VERSION = 'version-domain-policy-registry.v1';
export const VERSION_DOMAIN_POLICY_ID_PATTERN = '^[a-z0-9]+(?:[.-][a-z0-9]+)*$';

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
  persistence: 'supported',
});
const SHEETS = capabilityStates('contracted', {
  capture: 'supported',
  replay: 'supported',
  diff: 'supported',
  checkout: 'supported',
  persistence: 'supported',
});
const AUTHORED_GRID = capabilityStates('contracted', {
  capture: 'supported',
  replay: 'supported',
  diff: 'supported',
  checkout: 'supported',
  persistence: 'supported',
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

type PolicyInput = {
  readonly matrixRowId: string;
  readonly domainId: string;
  readonly domainClass: VersionDomainClass;
  readonly capturePolicy: CapturePolicy;
  readonly capabilityStates: VersionDomainCapabilityStateMap;
  readonly redactionPolicy?: VersionRedactionPolicy;
};

function domainPolicy(input: PolicyInput): DomainCapabilityPolicyManifest {
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
      return Object.freeze({ readMode: 'full', writeMode: 'full', redactionPolicy });
    case 'derivedOnly':
    case 'shadowOnly':
      return Object.freeze({
        readMode: 'metadata-only',
        writeMode: 'shadow-only',
        redactionPolicy,
      });
    case 'historyGap':
      return Object.freeze({ readMode: 'metadata-only', writeMode: 'gated', redactionPolicy });
    case 'excluded':
      return Object.freeze({ readMode: 'none', writeMode: 'none', redactionPolicy });
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
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'cells.formats.catalogs',
    domainId: 'cells.formats',
    domainClass: 'packageFidelity',
    capturePolicy: 'commitEligible',
    capabilityStates: OPAQUE_BLOCKING,
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
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'tables',
    domainId: 'tables',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
  }),
  domainPolicy({
    matrixRowId: 'pivots',
    domainId: 'pivots',
    domainClass: 'packageFidelity',
    capturePolicy: 'commitEligible',
    capabilityStates: OPAQUE_PRESERVED_PACKAGE,
  }),
  domainPolicy({
    matrixRowId: 'charts.source-range',
    domainId: 'charts',
    domainClass: 'authored',
    capturePolicy: 'commitEligible',
    capabilityStates: CONTRACTED,
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
    capabilityStates: CONTRACTED,
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
    capabilityStates: CONTRACTED,
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
  }),
  domainPolicy({
    matrixRowId: 'external-links',
    domainId: 'external-links',
    domainClass: 'external',
    capturePolicy: 'commitEligible',
    capabilityStates: OPAQUE_PRESERVED_EXTERNAL,
  }),
  domainPolicy({
    matrixRowId: 'ooxml-sidecars',
    domainId: 'ooxml-sidecars',
    domainClass: 'packageFidelity',
    capturePolicy: 'commitEligible',
    capabilityStates: OPAQUE_PRESERVED_PACKAGE,
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

export const PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY = Object.freeze({
  schemaVersion: VERSION_DOMAIN_POLICY_REGISTRY_SCHEMA_VERSION,
  domains: DOMAINS,
  defaultHistoryRootPolicy: Object.freeze({
    allowDetachedRoots: false,
    gapPolicy: 'reject',
  }),
} satisfies VersionDomainPolicyRegistry);

export const PUBLIC_VERSION_DOMAIN_POLICY_IDS = Object.freeze(
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.map((row) => row.domainPolicyId),
);
export const PUBLIC_VERSION_DOMAIN_POLICY_ROW_COUNT =
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.length;
